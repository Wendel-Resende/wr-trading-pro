import { z } from 'zod';
import { ReadModelError } from '../read-models-v1/errors';
import { DirectionalMetricsSchema } from '../../adapters/prisma/ml-directional/schemas';
import type { DirectionalMetrics, DirectionalSignal } from '../../domain/v1/models/ml-directional';

/**
 * Item D — porta para o motor Python (`/ml/directional/*`, porta 5560).
 *
 * Toda resposta do upstream é validada com Zod ESTRITO antes de virar objeto
 * de domínio. O motor é um processo separado que pode mudar de contrato: um
 * campo novo ou uma métrica fora de faixa precisa falhar aqui, com
 * `UPSTREAM_MALFORMED_RESPONSE`, e não se propagar meio-parseado até a UI —
 * lição registrada em CODEX_HANDOFF (o `orphan` que quebrou o Item C).
 */

const HEX64 = /^[a-f0-9]{64}$/;

export const DirectionalTrainResponseSchema = z
  .object({
    modelVersion: z.string().regex(HEX64),
    datasetDigest: z.string().regex(HEX64),
    universeBarsDigest: z.string().regex(HEX64),
    universe: z.array(z.string().min(1).max(20)).max(1000),
    horizonTradingDays: z.number().int().positive(),
    /** 'sector_relative' (default) | 'absolute' — ver TARGET_MODE no motor. */
    targetMode: z.enum(['absolute', 'sector_relative']).optional(),
    // O escore composto não tem gate de probabilidade; reporta a configuração
    // do ranking. `upper`/`lower` seguem aceitos para versões antigas.
    gate: z.object({
      upper: z.number().optional(),
      lower: z.number().optional(),
      quantiles: z.number().int().optional(),
      minFeatureTStat: z.number().optional(),
    }),
    windowStart: z.string().min(1).max(64),
    windowEnd: z.string().min(1).max(64),
    hyperparameters: z.record(z.string(), z.unknown()),
    features: z.array(z.string().max(200)).max(500),
    /** Features que passaram no corte de significância no treino final. */
    selectedFeatures: z.array(z.string().max(200)).max(500).optional(),
    metrics: DirectionalMetricsSchema,
    /**
     * Caminho local do artefato. NUNCA sai desta camada: não entra em nenhum
     * DTO público (é filesystem do servidor). Persistido em
     * `DirectionalModelVersion.artifactPath` só para auditoria interna.
     */
    artifactPath: z.string().min(1).max(1000),
  })
  .strict();

export const DirectionalPredictResponseSchema = z
  .object({
    modelVersion: z.string().regex(HEX64),
    universeDigest: z.string().regex(HEX64),
    generatedAt: z.string().min(1).max(64),
    /** Empresas com fundamentos, mas fora do universo validado do modelo. */
    excludedFromUniverse: z.array(z.string().max(20)).max(500).optional(),
    predictions: z
      .array(
        z
          .object({
            ticker: z.string().min(1).max(20),
            cdCvm: z.string().min(1).max(20),
            signal: z.enum(['COMPRA', 'VENDA', 'NEUTRO']),
            confidence: z.number().finite().min(0).max(1),
            // `prob` carrega o PERCENTIL transversal no escore composto — o
            // nome do campo é herança do motor de classificação anterior.
            prob: z.number().finite().min(0).max(1),
            score: z.number().finite().nullable().optional(),
            quantile: z.number().int().positive().max(20).nullable().optional(),
            knowledgeDate: z.string().min(1).max(64),
            topFeatures: z
              .array(z.object({ feature: z.string().max(200), importance: z.number().finite() }))
              .max(20),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();

/**
 * `metrics` é trocado pelo tipo de domínio (arrays `readonly`) em vez de
 * intersectado com o inferido do Zod: interseção produziria
 * `readonly T[] & T[]`, que nenhum valor satisfaz.
 */
export type DirectionalTrainResponse = Omit<z.infer<typeof DirectionalTrainResponseSchema>, 'metrics'> & {
  readonly metrics: DirectionalMetrics;
};

export interface DirectionalPredictionRow {
  readonly ticker: string;
  readonly cdCvm: string;
  readonly signal: DirectionalSignal;
  readonly confidence: number;
  readonly prob: number;
  readonly score?: number | null;
  readonly quantile?: number | null;
  readonly knowledgeDate: string;
  readonly topFeatures: readonly { readonly feature: string; readonly importance: number }[];
}

export interface DirectionalPredictResponse {
  readonly modelVersion: string;
  readonly universeDigest: string;
  readonly generatedAt: string;
  readonly excludedFromUniverse?: readonly string[];
  readonly predictions: readonly DirectionalPredictionRow[];
}

export const BackfillResponseSchema = z
  .object({
    ok: z.array(z.string().max(20)).max(2000),
    failed: z.record(z.string(), z.string().max(500)),
  })
  .strict();

export type BackfillResponse = z.infer<typeof BackfillResponseSchema>;

export interface DirectionalMlApiPort {
  /**
   * Backfill das barras D1 (MT5 → HistoricalCandle). Vive nesta porta porque
   * o motor ML é um só processo Flask: separar em outra porta duplicaria toda
   * a plumbing de erro/timeout sem ganho nenhum.
   */
  backfill(symbols?: readonly string[]): Promise<BackfillResponse>;
  train(symbols?: readonly string[]): Promise<DirectionalTrainResponse>;
  predict(modelVersion: string, symbols?: readonly string[]): Promise<DirectionalPredictResponse>;
}

/**
 * O treino direcional é síncrono e barato (sem TimesFM): painel + walk-forward
 * + ajuste final rodam na casa de dezenas de segundos, dominados pela escrita
 * do snapshot de barras. Mesmo assim o timeout é generoso e explícito — nunca
 * indefinido.
 */
const TRAIN_TIMEOUT_MS = 600_000;
const PREDICT_TIMEOUT_MS = 120_000;
const BACKFILL_TIMEOUT_MS = 300_000;

async function callPython<T>(
  baseUrl: string,
  path: string,
  body: unknown,
  timeoutMs: number,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch,
): Promise<T> {
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
    let code = String(response.status);
    try {
      const errorBody = (await response.json()) as { error?: string };
      code = errorBody.error ?? code;
    } catch {
      // corpo não-JSON: mantém o status HTTP como mensagem.
    }
    if (code === 'INSUFFICIENT_DATA') {
      throw new ReadModelError('INSUFFICIENT_DATA', 'dados insuficientes para treinar/prever o classificador direcional');
    }
    if (code === 'MODEL_NOT_FOUND') {
      throw new ReadModelError('MODEL_VERSION_NOT_FOUND', 'artefato do modelo não encontrado no motor ML');
    }
    throw new ReadModelError('UPSTREAM_ERROR', code);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ReadModelError('UPSTREAM_MALFORMED_RESPONSE', `resposta não-JSON do motor ML em ${path}`);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    // Nunca ecoar o payload cru (pode conter path do servidor) — só o caminho.
    throw new ReadModelError('UPSTREAM_MALFORMED_RESPONSE', `resposta fora do contrato em ${path}`);
  }
  return parsed.data;
}

export function createHttpDirectionalMlApiPort(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): DirectionalMlApiPort {
  return {
    backfill: (symbols) =>
      callPython(baseUrl, '/ml/backfill', symbols ? { symbols } : {}, BACKFILL_TIMEOUT_MS, BackfillResponseSchema, fetchImpl),
    train: (symbols) =>
      callPython(baseUrl, '/ml/directional/train', symbols ? { symbols } : {}, TRAIN_TIMEOUT_MS, DirectionalTrainResponseSchema, fetchImpl),
    predict: (modelVersion, symbols) =>
      callPython(
        baseUrl,
        '/ml/directional/predict',
        symbols ? { modelVersion, symbols } : { modelVersion },
        PREDICT_TIMEOUT_MS,
        DirectionalPredictResponseSchema,
        fetchImpl,
      ),
  };
}
