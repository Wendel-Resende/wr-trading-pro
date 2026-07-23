import { z } from 'zod';
import { prisma } from '../../../../../lib/prisma';
import { createModelVersionService } from '../../../../../application/model-version';
import { ModelVersionKindSchema } from '../../../../../adapters/prisma/model-version';
import { extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';
import { toModelVersionPublicDTO } from './_dto';

export const dynamic = 'force-dynamic';

/**
 * Bloqueador 1 (revisão final do Guardião, 2026-07-22): leitura read-only
 * allowlist específica para a visão pública de ML — nunca `hyperparametersJson`
 * ou `trainingEvidenceJson` brutos (que carregam `artifact.path` local).
 * Reaproveita `ModelVersionService.listByKind` (mesma camada de aplicação da
 * rota `/api/v1/model-versions`), mas mapeia por `toModelVersionPublicDTO`
 * antes de responder.
 */
const ListQuerySchema = z
  .object({
    kind: ModelVersionKindSchema,
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(64).optional(),
  })
  .strict();

/**
 * Achado alto 3 (auditoria final do Guardião, 2026-07-22): paginação
 * server-side (`limit+1`/cursor, ordenação `asOf desc, createdAt desc,
 * modelVersion desc` — mesma política canônica de desempate usada por
 * `MlHybridService.predictLive` e pela UI) — a UI nunca mais baixa a
 * coleção inteira de ModelVersion de uma vez.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const raw = extractStrictQuery(request, ['kind', 'limit', 'cursor'] as const);
    const query = parseWithSchema(ListQuerySchema, raw);
    const limit = query.limit ?? 20;

    const service = createModelVersionService(prisma);
    const versions = await service.listByKindPaginated(query.kind, limit + 1, query.cursor);
    const hasNext = versions.length > limit;
    const page = hasNext ? versions.slice(0, limit) : versions;
    const nextCursor = hasNext ? page[page.length - 1].modelVersion : null;

    const dtos = page.map(toModelVersionPublicDTO);
    return jsonSuccess(dtos, { count: dtos.length, nextCursor });
  } catch (error) {
    return jsonError(error);
  }
}
