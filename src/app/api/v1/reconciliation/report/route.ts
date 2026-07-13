import { z } from 'zod';
import { prisma } from '../../../../../lib/prisma';
import { createReconciliationService } from '../../../../../application/reconciliation';
import { ReconciliationDomainSchema, TimestampSchema } from '../../../../../adapters/prisma/reconciliation';
import { extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';

export const dynamic = 'force-dynamic';

const QuerySchema = z
  .object({
    decisionTime: TimestampSchema,
    knowledgeTime: TimestampSchema.optional(),
    from: TimestampSchema.optional(),
    to: TimestampSchema.optional(),
    domain: ReconciliationDomainSchema.optional(),
  })
  .strict();

const ALLOWED_KEYS = ['decisionTime', 'knowledgeTime', 'from', 'to', 'domain'] as const;

/**
 * GET /api/v1/reconciliation/report — read-only. Rejects when
 * `knowledgeTime > decisionTime` (lookahead protection). Never mutates
 * legacy data; no write method exists anywhere in this call path.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const raw = extractStrictQuery(request, ALLOWED_KEYS);
    const query = parseWithSchema(QuerySchema, raw);
    const service = createReconciliationService(prisma);
    const report = await service.getReport(query);
    return jsonSuccess(report);
  } catch (error) {
    return jsonError(error);
  }
}
