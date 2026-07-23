import { z } from 'zod';
import { prisma } from '../../../../../lib/prisma';
import { createBackfillRunService } from '../../../../../application/backfill-run';
import { extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';
import { toBackfillRunPublicDTO } from './_dto';

export const dynamic = 'force-dynamic';

const QuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

/**
 * Item B (bloqueador crítico 1, auditoria final do Guardião, 2026-07-22):
 * hidrata a UI com o último relatório de backfill persistido — nunca
 * `nunca executado` só porque a página foi recarregada. `failuresPage` é
 * paginada no servidor (`offset`/`limit`), nunca a lista inteira de uma vez.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const raw = extractStrictQuery(request, ['limit', 'offset'] as const);
    const query = parseWithSchema(QuerySchema, raw);
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const service = createBackfillRunService(prisma);
    const latest = await service.getLatest();
    if (!latest) return jsonSuccess(null, { count: 0 });

    return jsonSuccess(toBackfillRunPublicDTO(latest, limit, offset));
  } catch (error) {
    return jsonError(error);
  }
}
