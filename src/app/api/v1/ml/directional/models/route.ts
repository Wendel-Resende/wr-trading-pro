import { z } from 'zod';
import { prisma } from '../../../../../../lib/prisma';
import { isAdmin } from '../../../../../../lib/auth/admin';
import { isB3Ticker } from '../../../../../../lib/b3-ticker';
import {
  createDirectionalService,
  createHttpDirectionalMlApiPort,
  toDirectionalModelVersionPublicDTO,
} from '../../../../../../application/ml-directional';
import { ReadModelError } from '../../../../../../application/read-models-v1';
import { extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../../../_shared/http';
import { resolveRequestedBy } from '../../../agent-runs/_requested-by';

export const dynamic = 'force-dynamic';

/**
 * Item D (§4.5) — versões do classificador direcional.
 *
 * GET: leitura autenticada (qualquer principal conhecido), paginada
 * server-side. POST: dispara um treino novo — criação, portanto restrita à
 * allowlist de admin (`isAdmin`, fail-closed), mesmo gate já usado por
 * `BacktestCostProfile`.
 */

const ListQuerySchema = z
  .object({
    status: z.enum(['ACTIVE', 'FAILED', 'SUPERSEDED']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .strict();

const TrainBodySchema = z
  .object({
    costProfileId: z.string().min(1).max(64),
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

/** Fail-closed: sem identidade resolvida, nenhuma leitura nem escrita. */
function requireKnownPrincipal(requestedBy: string): string {
  if (requestedBy === 'unknown' || requestedBy.length === 0) {
    throw new ReadModelError('UNAUTHENTICATED', 'sessão inválida ou ausente — nenhuma identidade resolvida');
  }
  return requestedBy;
}

export async function GET(request: Request): Promise<Response> {
  try {
    requireKnownPrincipal(await resolveRequestedBy(request));

    const raw = extractStrictQuery(request, ['status', 'limit', 'cursor'] as const);
    const query = parseWithSchema(ListQuerySchema, raw);
    const limit = query.limit ?? 20;

    const service = createDirectionalService({ prisma, mlApi: createHttpDirectionalMlApiPort(mlApiBaseUrl()) });
    const models = await service.listModels({ status: query.status, limit: limit + 1, cursor: query.cursor });

    const hasNext = models.length > limit;
    const page = hasNext ? models.slice(0, limit) : models;
    const nextCursor = hasNext ? page[page.length - 1].modelVersion : null;

    const dtos = page.map(toDirectionalModelVersionPublicDTO);
    return jsonSuccess(dtos, { count: dtos.length, nextCursor });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const requestedBy = requireKnownPrincipal(await resolveRequestedBy(request));
    if (!isAdmin(requestedBy)) {
      throw new ReadModelError('FORBIDDEN', 'apenas um admin pode treinar um novo modelo direcional');
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new ReadModelError('INVALID_BODY', 'corpo da requisição não é um JSON válido');
    }
    const body = parseWithSchema(TrainBodySchema, raw);

    const service = createDirectionalService({ prisma, mlApi: createHttpDirectionalMlApiPort(mlApiBaseUrl()) });
    const result = await service.runTraining(requestedBy, body.costProfileId, body.symbols);

    // Um treino reprovado no gate NÃO é um erro de requisição: é um resultado
    // científico legítimo, devolvido com 200 e o veredito completo para a UI
    // poder mostrar exatamente qual gate falhou.
    return jsonSuccess(
      {
        researchRunId: result.researchRunId,
        modelVersion: result.modelVersion,
        status: result.status,
        gateApproved: result.gate.approved,
        gateFailures: result.gate.failures,
        model: toDirectionalModelVersionPublicDTO(result.model),
      },
      {},
      201,
    );
  } catch (error) {
    return jsonError(error);
  }
}
