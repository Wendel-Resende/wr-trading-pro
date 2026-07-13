import { z } from 'zod';
import { prisma } from '../../../../../lib/prisma';
import { createReadModelV1Service } from '../../../../../application/read-models-v1';
import {
  AccountCodeSchema,
  CivilDateSchema,
  CvmDocumentTypeSchema,
  IssuerIdSchema,
  ScopeSchema,
  StatementTypeSchema,
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
    statementType: StatementTypeSchema.optional(),
    scope: ScopeSchema.optional(),
    accountCode: AccountCodeSchema.optional(),
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
  'statementType',
  'scope',
  'accountCode',
] as const;

export async function GET(request: Request): Promise<Response> {
  try {
    const raw = extractStrictQuery(request, ALLOWED_KEYS);
    const query = parseWithSchema(QuerySchema, raw);
    const service = createReadModelV1Service(prisma);
    const { facts, effectiveFiling } = await service.getFacts(query);
    return jsonSuccess(facts, { effectiveFiling, limit: query.limit, offset: query.offset, count: facts.length });
  } catch (error) {
    return jsonError(error);
  }
}
