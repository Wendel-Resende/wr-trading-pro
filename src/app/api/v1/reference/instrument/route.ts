import { z } from 'zod';
import { prisma } from '../../../../../lib/prisma';
import { createReadModelV1Service } from '../../../../../application/read-models-v1';
import { ExchangeSchema, SymbolSchema, TimestampSchema } from '../../../../../adapters/prisma/reference-data';
import { extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';

export const dynamic = 'force-dynamic';

const QuerySchema = z
  .object({
    symbol: SymbolSchema,
    exchange: ExchangeSchema,
    asOf: TimestampSchema,
    knowledgeTime: TimestampSchema,
  })
  .strict();

const ALLOWED_KEYS = ['symbol', 'exchange', 'asOf', 'knowledgeTime'] as const;

export async function GET(request: Request): Promise<Response> {
  try {
    const raw = extractStrictQuery(request, ALLOWED_KEYS);
    const query = parseWithSchema(QuerySchema, raw);
    const service = createReadModelV1Service(prisma);
    const instrument = await service.getInstrument(query);
    return jsonSuccess(instrument, {});
  } catch (error) {
    return jsonError(error);
  }
}
