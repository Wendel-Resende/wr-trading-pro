import type { BacktestBar, BacktestCosts, BacktestMetrics, BacktestSignalInput, BacktestTrade, EntryRule } from '../../domain/v1/models/backtest-run';

export interface BacktestRunRequestV1 {
  readonly researchRunId: string;
  readonly modelVersionId: string;
  readonly instrumentId: string;
  readonly entryRule: EntryRule;
  readonly costs: BacktestCosts;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly embargoDays: number;
  /** Already point-in-time bars for the window (see deviation note: caller supplies these via the Phase 2 read-model routes). */
  readonly bars: readonly BacktestBar[];
  readonly signals: readonly BacktestSignalInput[];
}

export interface BacktestRunReadModelV1 {
  readonly backtestId: string;
  readonly researchRunId: string;
  readonly modelVersionId: string;
  readonly instrumentId: string;
  readonly entryRule: string;
  readonly costs: BacktestCosts;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly embargoDays: number;
  readonly metrics: unknown;
  readonly trades: unknown;
  readonly createdAt: string;
  // Item A (revisão 4, D10) — presentes só quando o BacktestRun veio do
  // fluxo ML Híbrido (metricsSchemaVersion !== null); ausentes/omitidos
  // para BacktestRun legado/genérico, sem quebrar o formato de leitura.
  readonly signalCoverage?: BacktestMetricsEnvelopeV1['signalCoverage'];
  readonly provenance?: BacktestMetricsEnvelopeV1['provenance'];
  readonly costProfileRef?: BacktestMetricsEnvelopeV1['costProfileRef'];
}

/**
 * Item A (revisão 3/4, D10): formato versionado de `BacktestRun.metricsJson`
 * usado pelo fluxo ML governado (`runGoverned`). O formato legado (rota
 * genérica `/api/v1/backtests`) continua sendo apenas `{ metrics, trades }`,
 * sem `envelopeVersion` — o assembler distingue os dois pela presença de
 * `metricsSchemaVersion` na linha persistida, nunca por heurística sobre o
 * conteúdo do JSON.
 */
export interface BacktestMetricsEnvelopeV1 {
  readonly envelopeVersion: 1;
  readonly metrics: BacktestMetrics;
  readonly trades: readonly BacktestTrade[];
  readonly signalCoverage: {
    readonly totalSignalsInWindow: number;
    readonly acceptedSignals: number;
    readonly skippedOverlapping: number;
    /** G-003 item 5 (D8/D10): sinais descartados por falta de barra `t` ou
     *  `t+horizon` no snapshot — motivo distinto de `skippedOverlapping`
     *  (janela de holding ocupada), nunca somado ao mesmo contador. */
    readonly skippedMissingBar: number;
  };
  readonly provenance: {
    readonly artifactHash: string;
    readonly universeBarsDigest: string;
    readonly datasetDigest: string;
    readonly foldsCovered: readonly {
      readonly foldId: number;
      readonly trainEnd: string;
      readonly testStart: string;
      readonly embargoCalDays: number;
    }[];
  };
  readonly costProfileRef: { readonly id: string; readonly version: number };
}

/**
 * Contrato estrito exigido por `runGoverned()` (D10): os seis campos que
 * são nullable no banco (compatibilidade com BacktestRun legado) são
 * OBRIGATÓRIOS aqui — a obrigatoriedade é imposta pelo tipo TS/validação
 * Zod na fronteira, nunca pela constraint do banco.
 */
export interface GovernedBacktestRunRequestV1 extends BacktestRunRequestV1 {
  readonly costProfileId: string;
  readonly costProfileVersion: number;
  readonly predictionHorizonBars: number;
  readonly artifactHash: string;
  readonly universeBarsDigest: string;
  readonly datasetDigest: string;
  readonly foldsCovered: BacktestMetricsEnvelopeV1['provenance']['foldsCovered'];
  /** Calculado pelo chamador (orquestração D9) ANTES de montar `signals`
   *  (que já vem filtrado, sem sobreposição) — o motor não tem estado
   *  entre sinais, então essa contagem não pode ser recomputada aqui. */
  readonly signalCoverage: BacktestMetricsEnvelopeV1['signalCoverage'];
}

export type GovernedBacktestRunStatus = 'CREATED' | 'ALREADY_EXISTS';

export interface GovernedBacktestRunResult {
  readonly status: GovernedBacktestRunStatus;
  readonly run: BacktestRunReadModelV1;
}
