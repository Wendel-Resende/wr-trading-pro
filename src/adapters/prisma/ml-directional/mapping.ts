import type {
  DirectionalModelVersion as DirectionalModelVersionRow,
  DirectionalPrediction as DirectionalPredictionRow,
} from '@prisma/client';
import type {
  DirectionalGateFailureCode,
  DirectionalModelStatus,
  DirectionalModelVersion,
  DirectionalPrediction,
  DirectionalSignal,
} from '../../../domain/v1/models/ml-directional';
import { DirectionalRecordCorruptedError } from './errors';
import {
  DirectionalGateFailureCodeSchema,
  DirectionalMetricsSchema,
  DirectionalTopFeaturesSchema,
} from './schemas';

/**
 * Parse estrito de um blob JSON persistido. Qualquer erro (JSON inválido ou
 * shape inesperado) vira `DirectionalRecordCorruptedError` identificando a
 * linha — nunca um objeto meio preenchido circulando pela aplicação.
 */
function parseJsonColumn<T>(raw: string, schema: { parse: (value: unknown) => T }, context: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DirectionalRecordCorruptedError(`${context}: JSON inválido`);
  }
  try {
    return schema.parse(parsed);
  } catch {
    throw new DirectionalRecordCorruptedError(`${context}: shape inesperado`);
  }
}

export const toDirectionalModelVersion = (row: DirectionalModelVersionRow): DirectionalModelVersion => ({
  id: row.id,
  modelVersion: row.modelVersion,
  createdAt: row.createdAt.toISOString(),
  researchRunId: row.researchRunId,
  metrics: parseJsonColumn(row.metrics, DirectionalMetricsSchema, `DirectionalModelVersion ${row.modelVersion} metrics`),
  artifactPath: row.artifactPath,
  status: row.status as DirectionalModelStatus,
  gateFailures: row.gateFailures
    ? parseJsonColumn(
        row.gateFailures,
        DirectionalGateFailureCodeSchema.array(),
        `DirectionalModelVersion ${row.modelVersion} gateFailures`,
      )
    : ([] as readonly DirectionalGateFailureCode[]),
});

export const toDirectionalPrediction = (row: DirectionalPredictionRow): DirectionalPrediction => ({
  id: row.id,
  modelVersion: row.modelVersion,
  cdCvm: row.cdCvm,
  ticker: row.ticker,
  signal: row.signal as DirectionalSignal,
  confidence: row.confidence,
  prob: row.prob,
  score: row.score,
  quantile: row.quantile,
  knowledgeDate: row.knowledgeDate.toISOString(),
  topFeatures: parseJsonColumn(
    row.topFeatures,
    DirectionalTopFeaturesSchema,
    `DirectionalPrediction ${row.id} topFeatures`,
  ),
  universeDigest: row.universeDigest,
  generatedAt: row.generatedAt.toISOString(),
});
