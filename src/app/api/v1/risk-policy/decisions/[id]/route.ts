import { prisma } from '../../../../../../lib/prisma';
import { createRiskPolicyService } from '../../../../../../application/risk-policy';
import { jsonError, jsonSuccess } from '../../../_shared/http';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const service = createRiskPolicyService(prisma);
    const decision = await service.getDecision(id);
    return jsonSuccess(decision);
  } catch (error) {
    return jsonError(error);
  }
}
