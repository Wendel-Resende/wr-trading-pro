import { createHash } from 'node:crypto';
import type { BacktestRepository, BacktestRunSubmission } from '../../domain/v1/ports/backtest-repository';
import type { ResearchRunRepository } from '../../domain/v1/ports/research-repository';
import type { ModelVersionRepository } from '../../domain/v1/ports/model-version-repository';
import { applyEmbargo, runDeterministicBacktest } from '../../domain/v1/models/backtest-run';
import { ReadModelError } from '../read-models-v1/errors';
import { assembleBacktestRun } from './assemblers';
import type {
  BacktestMetricsEnvelopeV1,
  BacktestRunReadModelV1,
  BacktestRunRequestV1,
  MlHybridBacktestRunRequestV1,
  MlHybridBacktestRunResult,
} from './dto';
import { periodsPerYearFor } from './periods';
import type { Timeframe } from '../../domain/v1/models/market-bar';

export interface BacktestRunServicePorts {
  readonly backtestRepository: BacktestRepository;
  readonly researchRunRepository: ResearchRunRepository;
  readonly modelVersionRepository: ModelVersionRepository;
}

/**
 * G-003 item 5 (D10): violação de unique constraint do Prisma (`P2002`) —
 * checado por duck-typing (`error.code`), sem importar o tipo concreto do
 * driver na camada de aplicação. É exatamente o que duas chamadas
 * concorrentes de `runForMlHybrid` com a MESMA `idempotencyKey` produzem
 * quando ambas passam pelo `findByIdempotencyKey` como "não existe" antes
 * de qualquer uma delas commitar o `create`.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'P2002';
}

/** Item A (D10): chave determinística — mesma combinação nunca cria duas linhas. */
export function computeExitRuleKey(entryRule: string, predictionHorizonBars: number): string {
  return `${entryRule}:${predictionHorizonBars}`;
}

export function computeIdempotencyKey(input: {
  readonly modelVersionId: string;
  readonly artifactHash: string;
  readonly instrumentId: string;
  readonly costProfileId: string;
  readonly costProfileVersion: number;
  readonly exitRuleKey: string;
}): string {
  const raw = `${input.modelVersionId}|${input.artifactHash}|${input.instrumentId}|${input.costProfileId}:${input.costProfileVersion}|${input.exitRuleKey}`;
  return createHash('sha256').update(raw).digest('hex');
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

  private async validateResearchAndModel(researchRunId: string, modelVersionId: string): Promise<void> {
    const researchRun = await this.ports.researchRunRepository.findById(researchRunId);
    if (!researchRun) throw new ReadModelError('RESEARCH_RUN_NOT_FOUND', `ResearchRun ${researchRunId} não encontrado`);

    const modelVersion = await this.ports.modelVersionRepository.findById(modelVersionId);
    if (!modelVersion) throw new ReadModelError('MODEL_VERSION_NOT_FOUND', `ModelVersion ${modelVersionId} não encontrado`);
    if (modelVersion.invalidatedAt !== null) {
      throw new ReadModelError('INVALID_MODEL_VERSION', `ModelVersion ${modelVersionId} está invalidado`);
    }
  }

  async run(request: BacktestRunRequestV1, timeframe: Timeframe): Promise<BacktestRunReadModelV1> {
    await this.validateResearchAndModel(request.researchRunId, request.modelVersionId);

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

  /**
   * Item A (revisão 4, D10): variante idempotente e com envelope versionado
   * usada exclusivamente pelo fluxo ML Híbrido. `run()` acima (genérico) não
   * muda de assinatura nem de comportamento — esta função é aditiva.
   */
  async runForMlHybrid(request: MlHybridBacktestRunRequestV1, timeframe: Timeframe): Promise<MlHybridBacktestRunResult> {
    await this.validateResearchAndModel(request.researchRunId, request.modelVersionId);

    const exitRuleKey = computeExitRuleKey(request.entryRule, request.predictionHorizonBars);
    const idempotencyKey = computeIdempotencyKey({
      modelVersionId: request.modelVersionId,
      artifactHash: request.artifactHash,
      instrumentId: request.instrumentId,
      costProfileId: request.costProfileId,
      costProfileVersion: request.costProfileVersion,
      exitRuleKey,
    });

    const existing = await this.ports.backtestRepository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return { status: 'ALREADY_EXISTS', run: assembleBacktestRun(existing) };
    }

    const purgedBars = applyEmbargo(request.bars, request.windowStart, request.embargoDays);
    const periodsPerYear = periodsPerYearFor(timeframe);

    const result = runDeterministicBacktest({
      bars: purgedBars,
      signals: request.signals,
      costs: request.costs,
      periodsPerYear,
      entryRule: request.entryRule,
      predictionHorizonBars: request.predictionHorizonBars,
    });

    const envelope: BacktestMetricsEnvelopeV1 = {
      envelopeVersion: 1,
      metrics: result.metrics,
      trades: result.trades,
      signalCoverage: request.signalCoverage,
      provenance: {
        artifactHash: request.artifactHash,
        universeBarsDigest: request.universeBarsDigest,
        datasetDigest: request.datasetDigest,
        foldsCovered: request.foldsCovered,
      },
      costProfileRef: { id: request.costProfileId, version: request.costProfileVersion },
    };

    const submission: BacktestRunSubmission = {
      researchRunId: request.researchRunId,
      modelVersionId: request.modelVersionId,
      instrumentId: request.instrumentId,
      entryRule: request.entryRule,
      costsJson: JSON.stringify(request.costs),
      windowStart: request.windowStart,
      windowEnd: request.windowEnd,
      metricsJson: JSON.stringify(envelope),
      embargoDays: request.embargoDays,
      costProfileId: request.costProfileId,
      costProfileVersion: request.costProfileVersion,
      predictionHorizonBars: request.predictionHorizonBars,
      exitRuleKey,
      idempotencyKey,
      metricsSchemaVersion: 1,
    };

    // G-003 item 5 (D10): a corrida entre o `findByIdempotencyKey` acima e
    // este `create` é real sob concorrência — duas chamadas simultâneas com
    // a MESMA `idempotencyKey` podem ambas ver "não existe" e ambas tentar
    // criar. `@@unique([idempotencyKey])` no schema garante que só uma
    // sobrevive; a outra recebe `P2002` do Prisma, que aqui é tratado como
    // `ALREADY_EXISTS` (busca a linha vencedora), nunca propagado como erro
    // genérico.
    try {
      const persisted = await this.ports.backtestRepository.create(submission);
      return { status: 'CREATED', run: assembleBacktestRun(persisted) };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        const raceWinner = await this.ports.backtestRepository.findByIdempotencyKey(idempotencyKey);
        if (raceWinner) return { status: 'ALREADY_EXISTS', run: assembleBacktestRun(raceWinner) };
      }
      throw error;
    }
  }

  async get(backtestId: string): Promise<BacktestRunReadModelV1> {
    const run = await this.ports.backtestRepository.findById(backtestId);
    if (!run) throw new ReadModelError('BACKTEST_NOT_FOUND', `BacktestRun ${backtestId} não encontrado`);
    return assembleBacktestRun(run);
  }

  async listByModelVersion(modelVersionId: string, limit?: number, cursor?: string): Promise<readonly BacktestRunReadModelV1[]> {
    const runs = await this.ports.backtestRepository.findByModelVersion(modelVersionId, limit, cursor);
    return Object.freeze(runs.map(assembleBacktestRun));
  }
}
