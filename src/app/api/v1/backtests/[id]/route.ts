import { prisma } from '../../../../../lib/prisma';
import { createBacktestRunService } from '../../../../../application/backtest-run';
import { jsonError, jsonSuccess } from '../../_shared/http';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const service = createBacktestRunService(prisma);
    const run = await service.get(id);
    return jsonSuccess(run);
  } catch (error) {
    return jsonError(error);
  }
}
