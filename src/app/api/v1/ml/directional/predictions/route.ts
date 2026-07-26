import { z } from 'zod';
import { prisma } from '../../../../../../lib/prisma';
import { isAdmin } from '../../../../../../lib/auth/admin';
import { isB3Ticker } from '../../../../../../lib/b3-ticker';
import {
  createDirectionalService,
  createHttpDirectionalMlApiPort,
  toDirectionalPredictionPublicDTO,
} from '../../../../../../application/ml-directional';
import { ReadModelError } from '../../../../../../application/read-models-v1';
import { extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../../../_shared/http';
import { resolveRequestedBy } from '../../../agent-runs/_requested-by';

export const dynamic = 'force-dynamic';

/**
 * Item D (§4.5) — sinais do classificador direcional.
 *
 * POST dispara uma geração nova (criação ⇒ allowlist de admin); GET lê a
 * última geração persistida daquela versão. O gate de status (`ACTIVE`) é
 * aplicado no serviço, não aqui: uma chamada direta à API nunca contorna o
 * gate de confiança pedindo sinais de um modelo reprovado.
 */

const MODEL_VERSION = z.string().regex(/^[a-f0-9]{64}$/);

const ListQuerySchema = z.object({ modelVersion: MODEL_VERSION }).strict();

const GenerateBodySchema = z
  .object({
    modelVersion: MODEL_VERSION,
    symbols: z
      .array(
        z
          .string()
          .min(1)
          .max(20)
          .transform((s) => s.trim().toUpperCase())
          .refine(isB3Ticker, { message: 'ticker fora do formato B3' }),
      )
      .min(1)
      .max(1000)
      .optional()
      .transform((syms) => (syms ? Array.from(new Set(syms)) : syms)),
  })
  .strict();

function mlApiBaseUrl(): string {
  return process.env.WR_ML_API_URL ?? 'http://127.0.0.1:5560';
}

function requireKnownPrincipal(requestedBy: string): string {
  if (requestedBy === 'unknown' || requestedBy.length === 0) {
    throw new ReadModelError('UNAUTHENTICATED', 'sessão inválida ou ausente — nenhuma identidade resolvida');
  }
  return requestedBy;
}

export async function GET(request: Request): Promise<Response> {
  try {
    requireKnownPrincipal(await resolveRequestedBy(request));

    const raw = extractStrictQuery(request, ['modelVersion'] as const);
    const query = parseWithSchema(ListQuerySchema, raw);

    const service = createDirectionalService({ prisma, mlApi: createHttpDirectionalMlApiPort(mlApiBaseUrl()) });
    const predictions = await service.listPredictions(query.modelVersion);
    const dtos = predictions.map(toDirectionalPredictionPublicDTO);

    const highConfidence = dtos.filter((p) => p.signal !== 'NEUTRO').length;
    return jsonSuccess(dtos, {
      count: dtos.length,
      highConfidence,
      generatedAt: dtos[0]?.generatedAt ?? null,
      universeDigest: dtos[0]?.universeDigest ?? null,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const requestedBy = requireKnownPrincipal(await resolveRequestedBy(request));
    if (!isAdmin(requestedBy)) {
      throw new ReadModelError('FORBIDDEN', 'apenas um admin pode gerar novas previsões direcionais');
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new ReadModelError('INVALID_BODY', 'corpo da requisição não é um JSON válido');
    }
    const body = parseWithSchema(GenerateBodySchema, raw);

    const service = createDirectionalService({ prisma, mlApi: createHttpDirectionalMlApiPort(mlApiBaseUrl()) });
    const result = await service.generatePredictions(body.modelVersion, body.symbols);
    const dtos = result.predictions.map(toDirectionalPredictionPublicDTO);

    return jsonSuccess(dtos, {
      count: dtos.length,
      highConfidence: dtos.filter((p) => p.signal !== 'NEUTRO').length,
      saved: result.saved,
      excludedFromUniverse: result.excludedFromUniverse,
      generatedAt: result.generatedAt,
      universeDigest: result.universeDigest,
      modelVersion: result.modelVersion,
    }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
