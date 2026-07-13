import type { FeatureValue as FeatureValueRow } from '@prisma/client';
import type { FeatureType, FeatureValue } from '../../../domain/v1/models/feature-value';

export const toFeatureValue = (row: FeatureValueRow): FeatureValue => ({
  id: row.id,
  featureId: row.featureId,
  subjectId: row.subjectId,
  featureType: row.featureType as FeatureType,
  valueRaw: row.valueRaw,
  scalePow: row.scalePow,
  enumValue: row.enumValue,
  label: row.label,
  sourceKey: row.sourceKey,
  knowledgeTime: row.knowledgeTime.toISOString(),
  decisionTime: row.decisionTime.toISOString(),
  createdByRunId: row.createdByRunId,
  createdAt: row.createdAt.toISOString(),
});
