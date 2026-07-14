import type { Signal as SignalRow } from '@prisma/client';
import type { Signal, SignalDirection } from '../../../domain/v1/models/signal';

export const toSignal = (row: SignalRow): Signal => ({
  signalId: row.signalId,
  modelVersionId: row.modelVersionId,
  instrumentId: row.instrumentId,
  barTime: row.barTime.toISOString(),
  direction: row.direction as SignalDirection,
  score: row.score,
  knowledgeTime: row.knowledgeTime.toISOString(),
  createdAt: row.createdAt.toISOString(),
});
