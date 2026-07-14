import type { BacktestRepository } from '../../domain/v1/ports/backtest-repository';
import type { ResearchRunRepository } from '../../domain/v1/ports/research-repository';
import type { ModelVersionRepository } from '../../domain/v1/ports/model-version-repository';
import { applyEmbargo, runDeterministicBacktest } from '../../domain/v1/models/backtest-run';
import { ReadModelError } from '../read-models-v1/errors';
import { assembleBacktestRun } from './assemblers';
import type { BacktestRunReadModelV1, BacktestRunRequestV1 } from './dto';
import { periodsPerYearFor } from './periods';
import type { Timeframe } from '../../domain/v1/models/market-bar';

export interface BacktestRunServicePorts {
  readonly backtestRepository: BacktestRepository;
  readonly researchRunRepository: ResearchRunRepository;
  readonly modelVersionRepository: ModelVersionRepository;
}

/**
 * Application service for BacktestRun (Fase 5 / Item 4). Orchestrates:
 * 1. Validate ResearchRun and ModelVersion exist.
 * 2. Apply embargo/purge (R-BT-5) to the caller-supplied, already
 *    point-in-time bars.
 * 3. Call the PURE deterministic engine (R-BT-1..4, R-BT-6, R-BT-7).
 * 4. Persist the BacktestRun with the resulting metricsJson.
 *
 * No I/O happens inside the engine itself — only here, before/after
 * calling it.
 */
export class BacktestRunService {
  constructor(private readonly ports: BacktestRunServicePorts) {}

  async run(request: BacktestRunRequestV1, timeframe: Timeframe): Promise<BacktestRunReadModelV1> {
    const researchRun = await this.ports.researchRunRepository.findById(request.researchRunId);
    if (!researchRun) throw new ReadModelError('RESEARCH_RUN_NOT_FOUND', `ResearchRun ${request.researchRunId} não encontrado`);

    const modelVersion = await this.ports.modelVersionRepository.findById(request.modelVersionId);
    if (!modelVersion) throw new ReadModelError('MODEL_VERSION_NOT_FOUND', `ModelVersion ${request.modelVersionId} não encontrado`);
    if (modelVersion.invalidatedAt !== null) {
      throw new ReadModelError('INVALID_MODEL_VERSION', `ModelVersion ${request.modelVersionId} está invalidado`);
    }

    // R-BT-5: purge/embargo — discard bars inside the embargo window after windowStart (train/test boundary).
    const purgedBars = applyEmbargo(request.bars, request.windowStart, request.embargoDays);

    const periodsPerYear = periodsPerYearFor(timeframe);

    const result = runDeterministicBacktest({
      bars: purgedBars,
      signals: request.signals,
      costs: request.costs,
      periodsPerYear,
      entryRule: request.entryRule,
    });

    const metricsJson = JSON.stringify({ metrics: result.metrics, trades: result.trades });

    const persisted = await this.ports.backtestRepository.create({
      researchRunId: request.researchRunId,
      modelVersionId: request.modelVersionId,
      instrumentId: request.instrumentId,
      entryRule: request.entryRule,
      costsJson: JSON.stringify(request.costs),
      windowStart: request.windowStart,
      windowEnd: request.windowEnd,
      metricsJson,
      embargoDays: request.embargoDays,
    });

    return assembleBacktestRun(persisted);
  }

  async get(backtestId: string): Promise<BacktestRunReadModelV1> {
    const run = await this.ports.backtestRepository.findById(backtestId);
    if (!run) throw new ReadModelError('BACKTEST_NOT_FOUND', `BacktestRun ${backtestId} não encontrado`);
    return assembleBacktestRun(run);
  }

  async listByModelVersion(modelVersionId: string): Promise<readonly BacktestRunReadModelV1[]> {
    const runs = await this.ports.backtestRepository.findByModelVersion(modelVersionId);
    return Object.freeze(runs.map(assembleBacktestRun));
  }
}
