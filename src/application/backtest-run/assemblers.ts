import type { BacktestRunPersistedShape } from '../../domain/v1/ports/backtest-repository';
import type { BacktestMetricsEnvelopeV1, BacktestRunReadModelV1 } from './dto';

interface LegacyMetricsShape {
  readonly metrics: unknown;
  readonly trades: unknown;
}

/**
 * Pure assembler: no I/O. Parses the persisted JSON blob back into a
 * structured shape for the wire response.
 *
 * Item A (revisão 4, D10): `metricsJson` tem dois formatos possíveis —
 * `{ metrics, trades }` legado (BacktestRun genérico, `metricsSchemaVersion
 * === null`) ou o envelope versionado `BacktestMetricsEnvelopeV1` do fluxo
 * ML Híbrido (`metricsSchemaVersion === 1`). Nunca inferido pelo formato do
 * JSON em si — sempre pela coluna `metricsSchemaVersion`, que é a fonte de
 * verdade explícita. Uma linha legada nunca faz o assembler quebrar: os
 * campos novos ficam simplesmente ausentes no DTO de leitura.
 */
export function assembleBacktestRun(model: BacktestRunPersistedShape): BacktestRunReadModelV1 {
  const base = {
    backtestId: model.backtestId,
    researchRunId: model.researchRunId,
    modelVersionId: model.modelVersionId,
    instrumentId: model.instrumentId,
    entryRule: model.entryRule,
    costs: JSON.parse(model.costsJson),
    windowStart: model.windowStart,
    windowEnd: model.windowEnd,
    embargoDays: model.embargoDays,
    createdAt: model.createdAt,
  };

  if (model.metricsSchemaVersion === 1) {
    const envelope: BacktestMetricsEnvelopeV1 = JSON.parse(model.metricsJson);
    return Object.freeze({
      ...base,
      metrics: envelope.metrics,
      trades: envelope.trades,
      signalCoverage: envelope.signalCoverage,
      provenance: envelope.provenance,
      costProfileRef: envelope.costProfileRef,
    });
  }

  // G-003 (item adicional de robustez): só `null` (BacktestRun genérico
  // legado, nunca escreveu essa coluna) cai no formato `{ metrics, trades }`.
  // Qualquer valor numérico desconhecido — uma versão de envelope futura
  // ainda não implementada aqui — precisa FALHAR explicitamente, nunca ser
  // lida silenciosamente como legado (o que perderia signalCoverage/
  // provenance/costProfileRef sem aviso algum).
  if (model.metricsSchemaVersion !== null) {
    throw new Error(
      `metricsSchemaVersion desconhecido: ${model.metricsSchemaVersion} (BacktestRun ${model.backtestId}) — ` +
      'nenhum parser de envelope registrado para esta versão; corrigir o assembler antes de ler esta linha.',
    );
  }

  const legacy: LegacyMetricsShape = JSON.parse(model.metricsJson);
  return Object.freeze({
    ...base,
    metrics: legacy.metrics,
    trades: legacy.trades,
  });
}
