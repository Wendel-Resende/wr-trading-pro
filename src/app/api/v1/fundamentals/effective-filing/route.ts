import { z } from 'zod';
import { prisma } from '../../../../../lib/prisma';
import { createReadModelV1Service } from '../../../../../application/read-models-v1';
import { CivilDateSchema, CvmDocumentTypeSchema, IssuerIdSchema, TimestampSchema } from '../../../../../adapters/prisma/cvm';
import { extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';

export const dynamic = 'force-dynamic';

const QuerySchema = z
  .object({
    issuerId: IssuerIdSchema,
    documentType: CvmDocumentTypeSchema,
    referenceDate: CivilDateSchema,
    decisionTime: TimestampSchema,
    knowledgeTime: TimestampSchema,
  })
  .strict();

const ALLOWED_KEYS = ['issuerId', 'documentType', 'referenceDate', 'decisionTime', 'knowledgeTime'] as const;

export async function GET(request: Request): Promise<Response> {
  try {
    const raw = extractStrictQuery(request, ALLOWED_KEYS);
    const query = parseWithSchema(QuerySchema, raw);
    const service = createReadModelV1Service(prisma);
    const filing = await service.getEffectiveFiling(query);
    return jsonSuccess(filing, {});
  } catch (error) {
    return jsonError(error);
  }
}
