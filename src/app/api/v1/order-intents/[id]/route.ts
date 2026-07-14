import { prisma } from '../../../../../lib/prisma';
import { createOrderIntentService } from '../../../../../application/order-intent';
import { jsonError, jsonSuccess } from '../../_shared/http';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const service = createOrderIntentService(prisma);
    const intent = await service.getIntent(id);
    return jsonSuccess(intent);
  } catch (error) {
    return jsonError(error);
  }
}
