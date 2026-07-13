import { prisma } from '../../../../../lib/prisma';
import { createAgentRunService } from '../../../../../application/agent-run';
import { jsonError, jsonSuccess } from '../../_shared/http';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const service = createAgentRunService(prisma);
    const run = await service.get(id);
    return jsonSuccess(run);
  } catch (error) {
    return jsonError(error);
  }
}
