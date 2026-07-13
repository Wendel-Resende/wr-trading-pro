import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { createReadModelV1Service } from '../../../../application/read-models-v1';
import {
  InstrumentVersionIdSchema,
  SourceKeySchema,
  TimeframeSchema,
  TimestampSchema,
} from '../../../../adapters/prisma/market-bar';
import { decimalIntegerString, extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../_shared/http';

export const dynamic = 'force-dynamic';

const QuerySchema = z
  .object({
    instrumentVersionId: InstrumentVersionIdSchema,
    sourceKey: SourceKeySchema,
    timeframe: TimeframeSchema,
    from: TimestampSchema,
    to: TimestampSchema,
    decisionTime: TimestampSchema,
    knowledgeTime: TimestampSchema,
    limit: decimalIntegerString(1, 5000),
  })
  .strict();

const ALLOWED_KEYS = [
  'instrumentVersionId',
  'sourceKey',
  'timeframe',
  'from',
  'to',
  'decisionTime',
  'knowledgeTime',
  'limit',
] as const;

export async function GET(request: Request): Promise<Response> {
  try {
    const raw = extractStrictQuery(request, ALLOWED_KEYS);
    const query = parseWithSchema(QuerySchema, raw);
    const service = createReadModelV1Service(prisma);
    const bars = await service.getMarketBars(query);
    return jsonSuccess(bars, { limit: query.limit, count: bars.length });
  } catch (error) {
    return jsonError(error);
  }
}
