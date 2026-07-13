import type { FeatureValue } from '../../domain/v1/models/feature-value';
import type { RunProvenanceDTO } from '../read-models-v1/dto';
import { rawToDecimalString } from './decimal';
import type { FeatureValueReadModelV1 } from './dto';

/** Pure assembler: no I/O, no clock reads. Provenance is passed in, already resolved. */
export function assembleFeatureValue(model: FeatureValue, provenance: RunProvenanceDTO): FeatureValueReadModelV1 {
  const bigintValue =
    model.featureType === 'BIGINT' && model.scalePow !== null
      ? Object.freeze({
          raw: model.valueRaw,
          scalePow: model.scalePow,
          decimal: rawToDecimalString(model.valueRaw, model.scalePow),
        })
      : null;

  return Object.freeze({
    id: model.id,
    featureId: model.featureId,
    subjectId: model.subjectId,
    featureType: model.featureType,
    bigintValue,
    valueRaw: model.valueRaw,
    enumValue: model.enumValue,
    label: model.label,
    sourceKey: model.sourceKey,
    knowledgeTime: model.knowledgeTime,
    decisionTime: model.decisionTime,
    provenance,
  });
}
