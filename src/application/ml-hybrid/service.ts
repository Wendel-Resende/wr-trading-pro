import type { PrismaClient } from '@prisma/client';
import { createResearchRunService } from '../research-run';
import { createModelVersionService } from '../model-version';
import { createSignalService } from '../signal';
import { ReadModelError } from '../read-models-v1/errors';
import { evaluateGate, type GateResult, type TrainingBlock } from './gate';

/**
 * ML Híbrido v1 — orquestração /api/v1/ml/* (Task 9, plano ML Híbrido v1).
 *
 * `runTraining` chama o serviço Python de treino (`MlApiPort.train`),
 * SEMPRE cria um `ResearchRun` (proveniência), avalia o gate estatístico
 * (`evaluateGate`, Task 8) e, se aprovado, cria um `ModelVersion`. O
 * backtest do treino (`trainResult.backtest.metrics`) é registrado como
 * PROXY dentro do `trainingEvidenceJson` — NÃO cria um `BacktestRun`
 * governado, pois essa tabela implica reexecução pelo motor determinístico
 * (`runDeterministicBacktest`), o que falsificaria a proveniência para um
 * número apenas informado pelo Python (desvio #6 do plano, decisão do
 * controller de 2026-07-18).
 *
 * `predictLive` nunca produz uma `OrderIntent` — apenas persiste um
 * `Signal` de leitura; nenhum acoplamento com execução.
 */

export interface TrainResult {
  readonly datasetHash: string;
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

export interface MlApiPort {
  backfill(symbols?: readonly string[]): Promise<{ ok: string[]; failed: Record<string, string> }>;
  train(symbols?: readonly string[]): Promise<TrainResult>;
  predict(symbol: string, artifactHash: string): Promise<PredictResult>;
}

export interface MlHybridServicePorts {
  readonly mlApi: MlApiPort;
  readonly prisma: PrismaClient;
}

export interface RunTrainingResult {
  readonly researchRunId: string;
  readonly gate: GateResult;
  readonly modelVersionId: string | null;
  readonly metrics: TrainResult;
}

export interface PredictLiveResult {
  readonly signalId: string;
  readonly prediction: PredictResult;
}

const MODEL_LABEL = 'ml-hybrid-swing-v1';

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

export class MlHybridService {
  constructor(private readonly ports: MlHybridServicePorts) {}

  async runTraining(createdBy: string, symbols?: readonly string[]): Promise<RunTrainingResult> {
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
    }

    return {
      researchRunId: researchRun.runId,
      gate,
      modelVersionId,
      metrics: trainResult,
    };
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

  return {
    backfill: (symbols) => call('/ml/backfill', { symbols }, 120_000),
    train: (symbols) => call('/ml/train', { symbols }, 600_000),
    predict: (symbol, artifactHash) => call('/ml/predict', { symbol, artifactHash }, 120_000),
  };
}
