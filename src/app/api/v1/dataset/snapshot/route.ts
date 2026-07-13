import { z } from 'zod';
import { prisma } from '../../../../../lib/prisma';
import { createDatasetSnapshotService } from '../../../../../application/dataset-snapshot';
import { TimestampSchema } from '../../../../../adapters/prisma/dataset-snapshot';
import { decimalIntegerString, extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';

export const dynamic = 'force-dynamic';

const QuerySchema = z
  .object({
    decisionTime: TimestampSchema,
    knowledgeTime: TimestampSchema.optional(),
    from: TimestampSchema.optional(),
    to: TimestampSchema.optional(),
    limit: decimalIntegerString(1, 5000).optional(),
    offset: decimalIntegerString(0, Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();

const ALLOWED_KEYS = ['decisionTime', 'knowledgeTime', 'from', 'to', 'limit', 'offset'] as const;

export async function GET(request: Request): Promise<Response> {
  try {
    const raw = extractStrictQuery(request, ALLOWED_KEYS);
    const query = parseWithSchema(QuerySchema, raw);
    const service = createDatasetSnapshotService(prisma);
    const snapshots = await service.getSnapshots(query);
    return jsonSuccess(snapshots, { count: snapshots.length });
  } catch (error) {
    return jsonError(error);
  }
}
