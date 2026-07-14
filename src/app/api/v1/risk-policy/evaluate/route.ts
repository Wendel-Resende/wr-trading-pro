import { RiskEvaluateBodySchema } from '../../../../../adapters/prisma/risk-policy';
import { createRiskPolicyService, resolveRiskPolicyConfigFromEnv } from '../../../../../application/risk-policy';
import { prisma } from '../../../../../lib/prisma';
import { ReadModelError } from '../../../../../application/read-models-v1';
import { jsonError, jsonSuccess } from '../../_shared/http';
import { resolveRequestedBy } from '../../agent-runs/_requested-by';

export const dynamic = 'force-dynamic';

async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ReadModelError('INVALID_BODY', 'corpo da requisição não é um JSON válido');
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const raw = await parseBody(request);
    const parsed = RiskEvaluateBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ReadModelError('INVALID_BODY', 'corpo inválido: ' + parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`).join('; '));
    }
    const body = parsed.data;
    const requestedBy = await resolveRequestedBy(request);

    const service = createRiskPolicyService(prisma);
    const config = resolveRiskPolicyConfigFromEnv();

    const result = await service.evaluate(
      {
        runId: body.runId,
        requestedBy,
        proposal: body.proposal,
        context: body.context,
        decisionTime: body.decisionTime,
      },
      config,
    );

    return jsonSuccess(result);
  } catch (error) {
    return jsonError(error);
  }
}
