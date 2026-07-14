import { prisma } from '../../../../../lib/prisma';
import { createRiskPolicyService } from '../../../../../application/risk-policy';
import { ReadModelError } from '../../../../../application/read-models-v1';
import { jsonError, jsonSuccess } from '../../_shared/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const allowedKeys = ['runId'] as const;
    for (const key of url.searchParams.keys()) {
      if (!allowedKeys.includes(key as (typeof allowedKeys)[number])) {
        throw new ReadModelError('INVALID_QUERY', `parâmetro de query desconhecido: ${key}`);
      }
    }
    const runId = url.searchParams.get('runId');
    if (!runId) {
      throw new ReadModelError('INVALID_QUERY', 'parâmetro obrigatório ausente: runId');
    }

    const service = createRiskPolicyService(prisma);
    const decisions = await service.listByRunId(runId);
    return jsonSuccess(decisions, { count: decisions.length });
  } catch (error) {
    return jsonError(error);
  }
}
