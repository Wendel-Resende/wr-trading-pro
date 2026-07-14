import type { OptionPosition } from '../../../../../domain/v1/models/option-position';
import { createOptionPositionService } from '../../../../../application/option-position';
import { prisma } from '../../../../../lib/prisma';
import { jsonError, jsonSuccess } from '../../_shared/http';

export const dynamic = 'force-dynamic';

function toWirePosition(position: OptionPosition) {
  return {
    id: position.id,
    instrumentId: position.instrumentId,
    kind: position.kind,
    strike: position.strike,
    expiration: position.expiration,
    side: position.side,
    quantity: position.quantity,
    source: position.source,
    knowledgeTime: position.knowledgeTime,
    createdAt: position.createdAt,
  };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const service = createOptionPositionService(prisma);
    const position = await service.getById(id);
    return jsonSuccess(toWirePosition(position));
  } catch (error) {
    return jsonError(error);
  }
}
