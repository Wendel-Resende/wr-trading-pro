import { z } from 'zod';
import { prisma } from '../../../../../lib/prisma';
import { createFeatureValueService } from '../../../../../application/feature-value';
import { FeatureIdSchema, SubjectIdSchema, TimestampSchema } from '../../../../../adapters/prisma/feature-value';
import { decimalIntegerString, extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';

export const dynamic = 'force-dynamic';

const QuerySchema = z
  .object({
    featureId: FeatureIdSchema.optional(),
    subjectId: SubjectIdSchema.optional(),
    decisionTime: TimestampSchema.optional(),
    knowledgeTime: TimestampSchema.optional(),
    from: TimestampSchema.optional(),
    to: TimestampSchema.optional(),
    limit: decimalIntegerString(1, 5000).optional(),
    offset: decimalIntegerString(0, Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();

const ALLOWED_KEYS = ['featureId', 'subjectId', 'decisionTime', 'knowledgeTime', 'from', 'to', 'limit', 'offset'] as const;

export async function GET(request: Request): Promise<Response> {
  try {
    const raw = extractStrictQuery(request, ALLOWED_KEYS);
    const query = parseWithSchema(QuerySchema, raw);
    const service = createFeatureValueService(prisma);
    const values = await service.getValues(query);
    return jsonSuccess(values, { count: values.length });
  } catch (error) {
    return jsonError(error);
  }
}
