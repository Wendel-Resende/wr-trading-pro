import type { PrismaClient } from '@prisma/client';
import { createResearchRunService } from '../research-run';
import { createModelVersionService } from '../model-version';
import { createSignalService } from '../signal';
import { createBacktestRunService } from '../backtest-run';
import type { MlHybridBacktestRunRequestV1 } from '../backtest-run';
import { createBacktestCostProfileService } from '../backtest-cost-profile';
import { ReadModelError } from '../read-models-v1/errors';
import { evaluateGate, type GateResult, type TrainingBlock } from './gate';
import type { BacktestBar, BacktestSignalInput } from '../../domain/v1/models/backtest-run';
import { b3DailyCloseKnowledgeInstant, emptyB3SessionCalendar, type B3DailySessionCalendar } from '../../domain/v1/time/b3-session';

/**
 * ML Híbrido v1 — orquestração /api/v1/ml/* (Task 9, plano ML Híbrido v1;
 * Item A / spec revisão 4 para o backtest econômico real).
 *
 * `runTraining` chama o serviço Python de treino (`MlApiPort.train`),
 * SEMPRE cria um `ResearchRun` (proveniência), avalia o gate estatístico
 * (`evaluateGate`, Task 8) e, se aprovado, cria um `ModelVersion`. Quando
 * aprovado, também dispara `runRealBacktests`: um `BacktestRun` real (motor
 * determinístico, D8 horizonte t..t+10, D9 sem sobreposição) por
 * instrumento do universo treinado, via `BacktestRunService.runForMlHybrid`
 * — nunca mais o proxy direcional (`trainResult.backtest.metrics`) fica
 * fora de `trainingEvidenceJson` como um número econômico "oficial"; ele
 * continua ali só como referência histórica do próprio Python, rotulado
 * como proxy (mantido do desvio consciente #5 do plano 2026-07-18).
 *
 * `predictLive` nunca produz uma `OrderIntent` — apenas persiste um
 * `Signal` de leitura; nenhum acoplamento com execução.
 */

export interface TrainResult {
  readonly datasetHash: string;
  /** Item A / D-hash: 64 hex sem prefixo, do dataset final (preço+CVM+TimesFM). */
  readonly datasetDigest: string;
  /** Item A / D-hash: 64 hex sem prefixo, do snapshot OHLCV cru (D1). */
  readonly universeBarsDigest: string;
  /** Símbolos com snapshot válido usado neste treino — base do backtest por instrumento (D2). */
  readonly universe: readonly string[];
  readonly timesfmVersion?: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly hyperparameters: Record<string, unknown>;
  readonly aggregate: { readonly nSamples: number; readonly accuracy: number };
  readonly baselines: {
    readonly alwaysUp: { readonly accuracy: number };
    readonly timesfmOnly: { readonly accuracy: number };
    readonly fundamentalOnly: { readonly accuracy: number };
    readonly priceOnlyLgbm: { readonly accuracy: number };
  };
  readonly blocks: readonly TrainingBlock[];
  readonly backtest: { readonly metrics: Record<string, unknown> };
  readonly artifact: { readonly hash: string; readonly path: string };
}

export interface PredictResult {
  readonly symbol: string;
  readonly date: string;
  readonly direction: 'BUY' | 'SELL' | 'HOLD';
  readonly score: number;
  readonly topFeatures: readonly { readonly name: string; readonly importance: number }[];
  readonly sourceMeta: Record<string, unknown>;
}

export interface WalkforwardPredictionRow {
  readonly symbol: string;
  readonly date: string;
  readonly pModel: number;
  readonly foldId: number;
  readonly trainEnd: string;
  readonly testStart: string;
  readonly embargoCalDays: number;
}

export interface SnapshotBarRow {
  readonly time: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface PaginatedRows<T> {
  readonly rows: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface MlApiPort {
  backfill(symbols?: readonly string[]): Promise<{ ok: string[]; failed: Record<string, string> }>;
  train(symbols?: readonly string[]): Promise<TrainResult>;
  predict(symbol: string, artifactHash: string): Promise<PredictResult>;
  /** Item A / D7: previsões out-of-sample paginadas, com metadata de fold (D3/D11). */
  getWalkforwardPredictions(artifactHash: string, symbol: string, page: { limit: number; offset: number }): Promise<PaginatedRows<WalkforwardPredictionRow>>;
  /** Item A / D1, D7: barras cruas (timestamp de abertura, NÃO normalizado) do snapshot congelado. */
  getSnapshotBars(universeBarsDigest: string, symbol: string, page: { limit: number; offset: number }): Promise<PaginatedRows<SnapshotBarRow>>;
}

export interface MlHybridServicePorts {
  readonly mlApi: MlApiPort;
  readonly prisma: PrismaClient;
  /** Item A / D-session: opcional — sem calendário real cadastrado (estado
   *  inicial desta v1.1), usa o fallback fail-safe de fim de dia civil. */
  readonly b3SessionCalendar?: B3DailySessionCalendar;
}

export type BacktestCoverage = 'COMPLETE' | 'PARTIAL' | 'NONE';

export interface RunTrainingBacktests {
  readonly coverage: BacktestCoverage;
  readonly created: readonly string[];
  readonly alreadyExists: readonly string[];
  readonly skipped: Readonly<Record<string, string>>;
}

export interface RunTrainingResult {
  readonly researchRunId: string;
  readonly gate: GateResult;
  readonly modelVersionId: string | null;
  readonly metrics: TrainResult;
  /** `null` quando o gate reprova — não há por que provar economicamente um modelo descartado (D12/desvio #6 original). */
  readonly backtests: RunTrainingBacktests | null;
}

export interface PredictLiveResult {
  readonly signalId: string;
  readonly prediction: PredictResult;
}

const MODEL_LABEL = 'ml-hybrid-swing-v1';
/** Item A / D8: mesmo horizonte de `python/ml/features.py::target_direction`
 *  (`horizon=10`) — risco de drift documentado (desvio consciente #5 da spec). */
export const PREDICTION_HORIZON_BARS = 10;
const MAX_PAGE_SIZE = 2000; // teto do endpoint Python (D7)

/**
 * O `ml_api.py` (Task 7) trafega datas em formato `YYYY-MM-DD` (sem
 * componente de hora); os schemas Zod de ResearchRun/ModelVersion/Signal
 * exigem timestamp ISO-8601 completo com offset explícito
 * (`src/domain/v1/time.ts`). Normaliza para meia-noite UTC quando
 * necessário — não altera valores que já trazem o componente de hora.
 */
function toInstant(value: string): string {
  return value.includes('T') ? value : `${value}T00:00:00.000Z`;
}

async function fetchAllRows<T>(fetchPage: (limit: number, offset: number) => Promise<PaginatedRows<T>>): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage(MAX_PAGE_SIZE, offset);
    all.push(...page.rows);
    offset += page.rows.length;
    if (page.rows.length === 0 || offset >= page.total) break;
  }
  return all;
}

interface SignalBuildResult {
  readonly bars: readonly BacktestBar[];
  readonly signals: readonly BacktestSignalInput[];
  readonly signalCoverage: { readonly totalSignalsInWindow: number; readonly acceptedSignals: number; readonly skippedOverlapping: number; readonly skippedMissingBar: number };
  readonly foldsCovered: readonly { readonly foldId: number; readonly trainEnd: string; readonly testStart: string; readonly embargoCalDays: number }[];
}

/**
 * Item A / D-session + D8 + D9: normaliza barras/sinais pela mesma função
 * de sessão B3 (nunca uma constante paralela — bar.time e signal.barTime
 * precisam ser IGUAIS para o casamento por string do motor funcionar), e
 * filtra sinais sobrepostos usando o offset corrigido de D8
 * (`exitBarIndex = signalBarIndex + predictionHorizonBars`). Só sinais
 * `BUY` ocupam janela de holding — `HOLD` não gera trade, então nunca
 * "sobrepõe" nada.
 */
export function buildBarsAndSignals(
  rawBars: readonly SnapshotBarRow[],
  predictions: readonly WalkforwardPredictionRow[],
  calendar: B3DailySessionCalendar,
): SignalBuildResult {
  const bars: BacktestBar[] = rawBars
    .map((r) => {
      const normalized = b3DailyCloseKnowledgeInstant(r.time, calendar);
      return { time: normalized, open: r.open, high: r.high, low: r.low, close: r.close, knowledgeTime: normalized };
    })
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

  const barIndexByTime = new Map<string, number>();
  bars.forEach((bar, index) => barIndexByTime.set(bar.time, index));

  const sortedPredictions = [...predictions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const signals: BacktestSignalInput[] = [];
  const foldsCovered = new Map<number, { foldId: number; trainEnd: string; testStart: string; embargoCalDays: number }>();
  let lastAcceptedBuyBarIndex = -Infinity;
  let skippedOverlapping = 0;
  let skippedMissingBar = 0;

  for (const pred of sortedPredictions) {
    const normalizedTime = b3DailyCloseKnowledgeInstant(pred.date, calendar);
    const barIndex = barIndexByTime.get(normalizedTime);
    const direction: 'BUY' | 'HOLD' = pred.pModel > 0.5 ? 'BUY' : 'HOLD'; // D4: SELL vira HOLD nesta v1.1

    // G-003 item 5 (D8/D10): sem barra de entrada (`t`) — motivo distinto de
    // sobreposição, contado à parte em `skippedMissingBar`.
    if (barIndex === undefined) {
      skippedMissingBar += 1;
      continue;
    }
    // G-003 item 5 (D8/D10): um sinal BUY sem barra de saída (`t+horizon`)
    // no snapshot nunca pode ser aceito — o motor determinístico não teria
    // como fechar a posição dentro do próprio universo congelado. Descartado
    // e refletido em `skippedMissingBar`, nunca silenciosamente aceito.
    if (direction === 'BUY' && barIndex + PREDICTION_HORIZON_BARS >= bars.length) {
      skippedMissingBar += 1;
      continue;
    }
    if (direction === 'BUY' && barIndex < lastAcceptedBuyBarIndex + PREDICTION_HORIZON_BARS) {
      skippedOverlapping += 1; // D9: dentro da janela de holding do BUY aceito anterior
      continue;
    }

    signals.push({ barTime: normalizedTime, direction, knowledgeTime: normalizedTime });
    if (direction === 'BUY') lastAcceptedBuyBarIndex = barIndex;
    foldsCovered.set(pred.foldId, { foldId: pred.foldId, trainEnd: pred.trainEnd, testStart: pred.testStart, embargoCalDays: pred.embargoCalDays });
  }

  return {
    bars,
    signals,
    signalCoverage: { totalSignalsInWindow: sortedPredictions.length, acceptedSignals: signals.length, skippedOverlapping, skippedMissingBar },
    foldsCovered: Object.freeze([...foldsCovered.values()].sort((a, b) => a.foldId - b.foldId)),
  };
}

export class MlHybridService {
  constructor(private readonly ports: MlHybridServicePorts) {}

  async runTraining(createdBy: string, costProfileId: string, symbols?: readonly string[]): Promise<RunTrainingResult> {
    if (!costProfileId) {
      throw new ReadModelError('COST_PROFILE_REQUIRED', 'informe um BacktestCostProfile — nenhum custo default é aceito (D5)');
    }
    const costProfileService = createBacktestCostProfileService(this.ports.prisma);
    const costProfile = await costProfileService.resolveActiveForTraining(costProfileId);

    const trainResult = await this.ports.mlApi.train(symbols);
    const gate = evaluateGate(trainResult.blocks);

    const researchRunService = createResearchRunService(this.ports.prisma);
    const researchRun = await researchRunService.submit(
      {
        name: MODEL_LABEL,
        hypothesis: 'preço+fundamentos+TimesFM supera cada baseline isolada (spec 2026-07-18)',
        datasetId: trainResult.datasetHash,
        windowStart: toInstant(trainResult.windowStart),
        windowEnd: toInstant(trainResult.windowEnd),
        paramsJson: JSON.stringify(trainResult.hyperparameters),
      },
      createdBy,
    );

    let modelVersionId: string | null = null;
    let backtests: RunTrainingBacktests | null = null;
    if (gate.approved) {
      const trainingEvidenceJson = JSON.stringify({
        aggregate: trainResult.aggregate,
        baselines: trainResult.baselines,
        gate,
        artifact: trainResult.artifact,
        backtestProxy: trainResult.backtest.metrics,
        datasetHash: trainResult.datasetHash,
        timesfmVersion: trainResult.timesfmVersion ?? null,
        windowStart: trainResult.windowStart,
        windowEnd: trainResult.windowEnd,
      });

      const modelVersionService = createModelVersionService(this.ports.prisma);
      const modelVersion = await modelVersionService.submit({
        kind: 'ML',
        label: MODEL_LABEL,
        asOf: toInstant(trainResult.windowEnd),
        hyperparametersJson: JSON.stringify(trainResult.hyperparameters),
        trainingEvidenceJson,
      });
      modelVersionId = modelVersion.modelVersion;

      backtests = await this.runRealBacktests(researchRun.runId, modelVersionId, trainResult, costProfile);
    }

    return { researchRunId: researchRun.runId, gate, modelVersionId, metrics: trainResult, backtests };
  }

  /**
   * Item A: um `BacktestRun` real por símbolo do universo treinado (D2),
   * usando exclusivamente as previsões out-of-sample do walk-forward (D3)
   * e as barras do snapshot congelado (D1) — nunca `/ml/predict`, nunca
   * `HistoricalCandle` live. Falha por símbolo nunca derruba os demais (D6).
   */
  private async runRealBacktests(
    researchRunId: string,
    modelVersionId: string,
    trainResult: TrainResult,
    costProfile: { readonly id: string; readonly version: number; readonly fixedBrokerage: number; readonly emolumentsPct: number; readonly spreadBps: number; readonly slippageBps: number; readonly lotSize: number },
  ): Promise<RunTrainingBacktests> {
    const calendar = this.ports.b3SessionCalendar ?? emptyB3SessionCalendar();
    const backtestRunService = createBacktestRunService(this.ports.prisma);

    const created: string[] = [];
    const alreadyExists: string[] = [];
    const skipped: Record<string, string> = {};

    for (const symbol of trainResult.universe) {
      try {
        const [predictions, rawBars] = await Promise.all([
          fetchAllRows((limit, offset) => this.ports.mlApi.getWalkforwardPredictions(trainResult.artifact.hash, symbol, { limit, offset })),
          fetchAllRows((limit, offset) => this.ports.mlApi.getSnapshotBars(trainResult.universeBarsDigest, symbol, { limit, offset })),
        ]);

        if (predictions.length === 0) {
          skipped[symbol] = 'NO_SIGNALS';
          continue;
        }
        if (rawBars.length === 0) {
          skipped[symbol] = 'INSUFFICIENT_BARS';
          continue;
        }

        const { bars, signals, signalCoverage, foldsCovered } = buildBarsAndSignals(rawBars, predictions, calendar);
        if (signals.filter((s) => s.direction !== 'HOLD').length === 0) {
          skipped[symbol] = 'NO_SIGNALS';
          continue;
        }

        const request: MlHybridBacktestRunRequestV1 = {
          researchRunId,
          modelVersionId,
          instrumentId: symbol,
          entryRule: 'open_next_bar',
          costs: {
            fixedBrokerage: costProfile.fixedBrokerage,
            emolumentsPct: costProfile.emolumentsPct,
            spreadBps: costProfile.spreadBps,
            slippageBps: costProfile.slippageBps,
            lotSize: costProfile.lotSize,
          },
          windowStart: bars[0].time,
          windowEnd: bars[bars.length - 1].time,
          embargoDays: 0, // D3: embargo já aplicado pelo walk-forward Python, auditável via foldsCovered
          bars,
          signals,
          costProfileId: costProfile.id,
          costProfileVersion: costProfile.version,
          predictionHorizonBars: PREDICTION_HORIZON_BARS,
          artifactHash: trainResult.artifact.hash,
          universeBarsDigest: trainResult.universeBarsDigest,
          datasetDigest: trainResult.datasetDigest,
          foldsCovered,
          signalCoverage,
        };

        const result = await backtestRunService.runForMlHybrid(request, '1d');
        if (result.status === 'CREATED') created.push(result.run.backtestId);
        else alreadyExists.push(result.run.backtestId);
      } catch (error) {
        skipped[symbol] = error instanceof ReadModelError ? error.code : 'INSUFFICIENT_BARS';
      }
    }

    const succeeded = created.length + alreadyExists.length;
    const coverage: BacktestCoverage = succeeded === 0 ? 'NONE' : Object.keys(skipped).length === 0 ? 'COMPLETE' : 'PARTIAL';

    return { coverage, created: Object.freeze(created), alreadyExists: Object.freeze(alreadyExists), skipped: Object.freeze(skipped) };
  }

  async predictLive(symbol: string): Promise<PredictLiveResult> {
    const modelVersionService = createModelVersionService(this.ports.prisma);
    const versions = await modelVersionService.listByKind('ML');
    const candidates = versions
      .filter((v) => v.label === MODEL_LABEL && v.invalidatedAt === null)
      .slice()
      .sort((a, b) => (a.asOf < b.asOf ? 1 : a.asOf > b.asOf ? -1 : 0));
    const modelVersion = candidates[0];
    if (!modelVersion) {
      throw new ReadModelError('MODEL_VERSION_NOT_FOUND', `Nenhuma ModelVersion válida encontrada para label ${MODEL_LABEL}`);
    }

    let artifactHash: string;
    try {
      const evidence: unknown = JSON.parse(modelVersion.trainingEvidenceJson ?? '{}');
      const hash = (evidence as { artifact?: { hash?: unknown } }).artifact?.hash;
      if (typeof hash !== 'string' || hash.length === 0) throw new Error('artifact.hash ausente');
      artifactHash = hash;
    } catch {
      throw new ReadModelError('MODEL_VERSION_NOT_FOUND', `ModelVersion ${modelVersion.modelVersion} sem artifact.hash válido`);
    }

    const prediction = await this.ports.mlApi.predict(symbol, artifactHash);

    const signalService = createSignalService(this.ports.prisma);
    const signal = await signalService.generate({
      modelVersionId: modelVersion.modelVersion,
      instrumentId: prediction.symbol,
      barTime: toInstant(prediction.date),
      direction: prediction.direction,
      score: prediction.score,
      knowledgeTime: toInstant(prediction.date),
    });

    return { signalId: signal.signalId, prediction };
  }
}

export function createHttpMlApiPort(baseUrl: string, fetchImpl: typeof fetch = fetch): MlApiPort {
  async function call<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'TimeoutError') {
        throw new ReadModelError('UPSTREAM_TIMEOUT', `motor ML não respondeu em ${timeoutMs}ms (${path})`);
      }
      throw new ReadModelError(
        'UPSTREAM_ERROR',
        'motor ML (porta 5560) inacessível — ligue o card "ML Engine" na aba Admin',
      );
    }
    if (!response.ok) {
      let message = String(response.status);
      try {
        const errorBody = (await response.json()) as { error?: string };
        message = errorBody.error ?? message;
      } catch {
        // corpo não-JSON: mantém a mensagem com o status HTTP.
      }
      throw new ReadModelError('UPSTREAM_ERROR', message);
    }
    return (await response.json()) as T;
  }

  async function callGet<T>(path: string, query: Record<string, string | number>, timeoutMs: number): Promise<T> {
    const search = new URLSearchParams(Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])));
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}?${search.toString()}`, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'TimeoutError') {
        throw new ReadModelError('UPSTREAM_TIMEOUT', `motor ML não respondeu em ${timeoutMs}ms (${path})`);
      }
      throw new ReadModelError(
        'UPSTREAM_ERROR',
        'motor ML (porta 5560) inacessível — ligue o card "ML Engine" na aba Admin',
      );
    }
    if (!response.ok) {
      let message = String(response.status);
      try {
        const errorBody = (await response.json()) as { error?: string };
        message = errorBody.error ?? message;
      } catch {
        // corpo não-JSON: mantém a mensagem com o status HTTP.
      }
      throw new ReadModelError('UPSTREAM_ERROR', message);
    }
    return (await response.json()) as T;
  }

  return {
    backfill: (symbols) => call('/ml/backfill', { symbols }, 120_000),
    train: (symbols) => call('/ml/train', { symbols }, 600_000),
    predict: (symbol, artifactHash) => call('/ml/predict', { symbol, artifactHash }, 120_000),
    getWalkforwardPredictions: (artifactHash, symbol, page) =>
      callGet(`/ml/predictions/${artifactHash}`, { symbol, limit: page.limit, offset: page.offset }, 60_000),
    getSnapshotBars: (universeBarsDigest, symbol, page) =>
      callGet(`/ml/snapshot-bars/${universeBarsDigest}`, { symbol, limit: page.limit, offset: page.offset }, 60_000),
  };
}
