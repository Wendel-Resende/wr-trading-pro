import { createBacktestCostProfileService } from '../../../../../../../application/backtest-cost-profile';
import { jsonError, jsonSuccess } from '../../../../_shared/http';
import { resolveRequestedBy } from '../../../../agent-runs/_requested-by';
import { prisma } from '../../../../../../../lib/prisma';

export const dynamic = 'force-dynamic';

/** Item A / D5: arquiva um BacktestCostProfile. Admin-only; `archivedBy`
 *  vem sempre da sessão autenticada. Append-only — nunca deleta a linha. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const requestedBy = await resolveRequestedBy(request);

    const service = createBacktestCostProfileService(prisma);
    const profile = await service.archive(id, requestedBy);

    return jsonSuccess(profile);
  } catch (error) {
    return jsonError(error);
  }
}
