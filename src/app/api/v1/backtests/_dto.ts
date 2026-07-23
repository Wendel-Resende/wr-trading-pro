import type { BacktestRunReadModelV1 } from '../../../../application/backtest-run/dto';

/**
 * Achado médio 8 (auditoria final do Guardião, 2026-07-22): DTO resumido
 * específico para a listagem consumida pela visão pública de ML — nunca
 * devolve `trades` (coleção interna de execuções simuladas), `entryRule`,
 * `embargoDays`, `costs` bruto (a UI já resolve os componentes de custo via
 * `GET /api/v1/ml/cost-profiles/{id}`) ou `provenance.foldsCovered` (detalhe
 * interno do walk-forward, sem valor de UX na aba pública).
 */
export interface BacktestMetricsSummary {
  readonly trades: number;
  readonly totalNetReturn: number;
  readonly maxDrawdown: number;
  readonly sharpe: number;
  readonly winRate: number;
}

function toMetricsSummary(metrics: unknown): BacktestMetricsSummary | null {
  if (!metrics || typeof metrics !== 'object') return null;
  const m = metrics as Record<string, unknown>;
  if (
    typeof m.trades !== 'number' ||
    typeof m.totalNetReturn !== 'number' ||
    typeof m.maxDrawdown !== 'number' ||
    typeof m.sharpe !== 'number' ||
    typeof m.winRate !== 'number'
  ) {
    return null;
  }
  return { trades: m.trades, totalNetReturn: m.totalNetReturn, maxDrawdown: m.maxDrawdown, sharpe: m.sharpe, winRate: m.winRate };
}

export interface BacktestRunPublicDTO {
  readonly backtestId: string;
  readonly modelVersionId: string;
  readonly instrumentId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly createdAt: string;
  readonly metrics: BacktestMetricsSummary | null;
  readonly signalCoverage?: { readonly totalSignalsInWindow: number; readonly acceptedSignals: number };
  readonly costProfileRef?: { readonly id: string; readonly version: number };
}

export function toBacktestRunPublicDTO(r: BacktestRunReadModelV1): BacktestRunPublicDTO {
  return {
    backtestId: r.backtestId,
    modelVersionId: r.modelVersionId,
    instrumentId: r.instrumentId,
    windowStart: r.windowStart,
    windowEnd: r.windowEnd,
    createdAt: r.createdAt,
    metrics: toMetricsSummary(r.metrics),
    signalCoverage: r.signalCoverage
      ? { totalSignalsInWindow: r.signalCoverage.totalSignalsInWindow, acceptedSignals: r.signalCoverage.acceptedSignals }
      : undefined,
    costProfileRef: r.costProfileRef ? { id: r.costProfileRef.id, version: r.costProfileRef.version } : undefined,
  };
}
