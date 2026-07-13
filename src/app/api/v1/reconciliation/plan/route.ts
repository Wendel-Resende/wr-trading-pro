import { z } from 'zod';
import { prisma } from '../../../../../lib/prisma';
import { createReconciliationService } from '../../../../../application/reconciliation';
import { ReconciliationDomainSchema, SubjectIdSchema, TimestampSchema } from '../../../../../adapters/prisma/reconciliation';
import { decimalIntegerString, extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';

export const dynamic = 'force-dynamic';

const QuerySchema = z
  .object({
    decisionTime: TimestampSchema,
    knowledgeTime: TimestampSchema.optional(),
    domain: ReconciliationDomainSchema.optional(),
    subjectId: SubjectIdSchema.optional(),
    limit: decimalIntegerString(1, 1000).optional(),
    offset: decimalIntegerString(0, Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();

const ALLOWED_KEYS = ['decisionTime', 'knowledgeTime', 'domain', 'subjectId', 'limit', 'offset'] as const;

/**
 * GET /api/v1/reconciliation/plan — read-only. Rejects when
 * `knowledgeTime > decisionTime` (lookahead protection). Never mutates
 * legacy data; no write method exists anywhere in this call path.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const raw = extractStrictQuery(request, ALLOWED_KEYS);
    const query = parseWithSchema(QuerySchema, raw);
    const service = createReconciliationService(prisma);
    const rows = await service.getPlan(query);
    return jsonSuccess(rows, { count: rows.length });
  } catch (error) {
    return jsonError(error);
  }
}
