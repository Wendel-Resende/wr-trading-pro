import { prisma } from '../../../../../../lib/prisma';
import { createResearchSessionService } from '../../../../../../application/research-session';
import { jsonError, jsonSuccess } from '../../../_shared/http';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    return jsonSuccess(await createResearchSessionService(prisma).cancel(id));
  } catch (error) {
    return jsonError(error);
  }
}
