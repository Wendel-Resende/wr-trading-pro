import { z } from 'zod';
import { prisma } from '../../../../../../lib/prisma';
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
 * Somente leitura, autenticada (qualquer principal conhecido) e paginada
 * server-side.
 *
 * NÃO existe POST aqui: treinar é `POST /api/v1/ml/training-runs` (Item C),
 * que cria um `MlTrainingRun`, responde 202 na hora e roda o job Python em
 * processo separado — cancelável de verdade. Um POST síncrono nesta rota
 * seguraria a conexão por minutos e não teria como ser cancelado, que é
 * exatamente o bug que o Item C existe para não repetir.
 */

const ListQuerySchema = z
  .object({
    status: z.enum(['ACTIVE', 'FAILED', 'SUPERSEDED']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().regex(/^[a-f0-9]{64}$/).optional(),
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
