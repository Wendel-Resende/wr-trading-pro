import type { OptionPosition as OptionPositionRow } from '@prisma/client';
import type { OptionKind, OptionPosition, OptionPositionSource, OptionSide } from '../../../domain/v1/models/option-position';

export const toOptionPosition = (row: OptionPositionRow): OptionPosition => ({
  id: row.id,
  instrumentId: row.instrumentId,
  kind: row.kind as OptionKind,
  strike: row.strike,
  expiration: row.expiration.toISOString(),
  side: row.side as OptionSide,
  quantity: row.quantity,
  source: row.source as OptionPositionSource,
  knowledgeTime: row.knowledgeTime.toISOString(),
  createdAt: row.createdAt.toISOString(),
});
