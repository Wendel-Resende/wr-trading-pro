import { z } from 'zod';
import { prisma } from '../../../../../lib/prisma';
import { createReadModelV1Service } from '../../../../../application/read-models-v1';
import {
  CivilDateSchema,
  CvmDocumentTypeSchema,
  IssuerIdSchema,
  QuantityTypeSchema,
  ShareClassSchema,
  TimestampSchema,
} from '../../../../../adapters/prisma/cvm';
import { decimalIntegerString, extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';

export const dynamic = 'force-dynamic';

const QuerySchema = z
  .object({
    issuerId: IssuerIdSchema,
    documentType: CvmDocumentTypeSchema,
    referenceDate: CivilDateSchema,
    decisionTime: TimestampSchema,
    knowledgeTime: TimestampSchema,
    limit: decimalIntegerString(1, 1000),
    offset: decimalIntegerString(0, 1_000_000),
    shareClass: ShareClassSchema.optional(),
    quantityType: QuantityTypeSchema.optional(),
  })
  .strict();

const ALLOWED_KEYS = [
  'issuerId',
  'documentType',
  'referenceDate',
  'decisionTime',
  'knowledgeTime',
  'limit',
  'offset',
  'shareClass',
  'quantityType',
] as const;

export async function GET(request: Request): Promise<Response> {
  try {
    const raw = extractStrictQuery(request, ALLOWED_KEYS);
    const query = parseWithSchema(QuerySchema, raw);
    const service = createReadModelV1Service(prisma);
    const { shareCapital, effectiveFiling } = await service.getShareCapital(query);
    return jsonSuccess(shareCapital, { effectiveFiling, limit: query.limit, offset: query.offset, count: shareCapital.length });
  } catch (error) {
    return jsonError(error);
  }
}
