import type { Signal } from '../../domain/v1/models/signal';
import type { SignalReadModelV1 } from './dto';

export function assembleSignal(model: Signal): SignalReadModelV1 {
  return Object.freeze({
    signalId: model.signalId,
    modelVersionId: model.modelVersionId,
    instrumentId: model.instrumentId,
    barTime: model.barTime,
    direction: model.direction,
    score: model.score,
    knowledgeTime: model.knowledgeTime,
    createdAt: model.createdAt,
  });
}
