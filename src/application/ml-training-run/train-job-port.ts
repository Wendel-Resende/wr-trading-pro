import { z } from 'zod';
import { ReadModelError } from '../read-models-v1/errors';
import type { TrainResult } from '../ml-hybrid';
import { B3_TICKER_EXACT } from '../../lib/b3-ticker';

/**
 * Item C: porta para o job Python assíncrono (`POST /ml/train-jobs`,
 * `GET /ml/train-jobs/<id>`, `POST /ml/train-jobs/<id>/cancel`), distinta
 * de `MlApiPort` (`ml-hybrid/service.ts`) que só conhece o `/ml/train`
 * síncrono legado. Nenhum destes métodos bloqueia por mais que um request
 * HTTP curto — start/cancel retornam de imediato; o worker chama
 * `getStatus` em polling de baixa frequência.
 */
// Bloqueador 2 (revisão Guardião): 'UNKNOWN' distingue "jobId nunca existiu
// (ou não sobreviveu a um restart do motor Python)" de "está RUNNING" — sem
// isso, um GET de status para um ID desconhecido era tratado como RUNNING.
export type TrainJobState = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';

export interface TrainJobStatus {
  readonly state: TrainJobState;
  readonly phase: string;
  readonly progress: number;
  readonly result?: TrainResult;
  readonly errorCode?: string;
}

export interface MlTrainJobPort {
  // Bloqueador 9/19 (revisão Guardião): `jobId` é gerado e persistido pelo
  // chamador (MlTrainingRun) ANTES deste start — elimina a janela
  // persistência→efeito em que uma resposta perdida deixaria um processo
  // Python órfão sem ID conhecido do lado Node. `start` é idempotente:
  // reenviar o mesmo `jobId` nunca spawna um segundo processo Python.
  start(jobId: string, symbols: readonly string[] | null): Promise<{ jobId: string }>;
  getStatus(jobId: string): Promise<TrainJobStatus>;
  cancel(jobId: string): Promise<{ processConfirmedTerminated: boolean }>;
}

const SHORT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB — teto de payload aceito do motor Python

// Bloqueador 5 (revisão Guardião): schema Zod estrito para TODA resposta do
// motor Python — um cast `as T` sem validação de runtime deixaria NaN,
// hashes malformados, estados desconhecidos ou payloads excessivos chegarem
// até o gate/persistência (ResearchRun/ModelVersion). Rejeição aqui nunca
// deixa nada ser criado a partir do payload.
const finiteNumber = z.number().finite();
const hash64 = z.string().regex(/^[0-9a-f]{64}$/, 'hash 64-hex inválido');
const jobId32 = z.string().regex(/^[0-9a-f]{32}$/, 'jobId 32-hex inválido');
// Bloqueador 21 (revisão Guardião): `datasetHash` segue o formato semântico
// canônico produzido por python/ml/train.py (`sha256:<64-hex>`) — aceitar
// qualquer string de até 200 chars permitia payloads arbitrários chegarem
// ao ResearchRun.datasetId.
const datasetHashCanonical = z.string().regex(/^sha256:[0-9a-f]{64}$/, 'datasetHash fora do formato canônico sha256:<64-hex>');
// Bloqueador 21: `Date.parse` aceita formatos ambíguos/inválidos de calendário
// (ex.: "2024-02-30" às vezes é aceito por engines JS). Exige ISO 8601
// estrito (data ou data-hora) via z.string().datetime()/regex de data.
const isoDate = z.union([z.string().date(), z.string().datetime({ offset: true })]);
const accuracyBlock = z.object({ accuracy: finiteNumber.min(0).max(1) }).strict();

const TrainingBlockSchema = z
  .object({
    block: z.string().min(1).max(200),
    n: z.number().int().min(0),
    hitsModel: z.number().int().min(0),
    hitsAlwaysUp: z.number().int().min(0),
    hitsTimesfm: z.number().int().min(0),
    hitsFundamental: z.number().int().min(0),
    hitsPriceOnly: z.number().int().min(0),
  })
  .strict()
  // Bloqueador 21: coerência básica — nenhuma contagem de acerto pode
  // exceder o total de amostras do bloco.
  .refine(
    (b) => b.hitsModel <= b.n && b.hitsAlwaysUp <= b.n && b.hitsTimesfm <= b.n && b.hitsFundamental <= b.n && b.hitsPriceOnly <= b.n,
    'hits* não pode exceder n no bloco',
  );

const TrainResultSchema = z
  .object({
    datasetHash: datasetHashCanonical,
    datasetDigest: hash64,
    universeBarsDigest: hash64,
    universe: z.array(z.string().regex(B3_TICKER_EXACT)).min(1).max(2_000),
    timesfmVersion: z.string().max(200).optional(),
    windowStart: isoDate,
    windowEnd: isoDate,
    hyperparameters: z.record(z.string(), z.unknown()),
    aggregate: z.object({ nSamples: z.number().int().min(0), accuracy: finiteNumber.min(0).max(1) }).strict(),
    baselines: z
      .object({
        alwaysUp: accuracyBlock,
        timesfmOnly: accuracyBlock,
        fundamentalOnly: accuracyBlock,
        priceOnlyLgbm: accuracyBlock,
      })
      .strict(),
    blocks: z.array(TrainingBlockSchema).max(100_000),
    backtest: z.object({ metrics: z.record(z.string(), z.unknown()) }).strict(),
    artifact: z.object({ hash: hash64, path: z.string().min(1).max(1_000) }).strict(),
  })
  .strict();

const TrainJobStateSchema = z.enum(['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN']);

const TrainJobStatusSchema = z
  .object({
    state: TrainJobStateSchema,
    phase: z.string().min(1).max(50),
    progress: z.number().int().min(0).max(100),
    result: TrainResultSchema.optional(),
    errorCode: z.string().max(100).optional(),
    // O `ml_api.py` real emite `orphan: boolean` no ramo RUNNING (distinção
    // ORPHAN_RUNNING, Bloqueador 2 da revisão do Guardião): um processo vivo
    // herdado de uma geração anterior do registry. O schema é `.strict()`, então
    // este campo PRECISA ser declarado — sem ele, todo status RUNNING (o estado
    // normal logo após o start) virava UPSTREAM_MALFORMED_RESPONSE →
    // INTERNAL_ERROR, quebrando o happy path inteiro do treino assíncrono.
    orphan: z.boolean().optional(),
  })
  .strict();

const StartResponseSchema = z.object({ jobId: jobId32 }).strict();
const CancelResponseSchema = z
  .object({ state: z.enum(['CANCELLED', 'RUNNING']), processConfirmedTerminated: z.boolean() })
  .strict();

export function createHttpMlTrainJobPort(baseUrl: string, fetchImpl: typeof fetch = fetch): MlTrainJobPort {
  async function request<T>(path: string, method: 'GET' | 'POST', schema: z.ZodType<T>, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        signal: AbortSignal.timeout(SHORT_TIMEOUT_MS),
      });
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'TimeoutError') {
        throw new ReadModelError('UPSTREAM_TIMEOUT', `motor ML não respondeu em ${SHORT_TIMEOUT_MS}ms (${path})`);
      }
      throw new ReadModelError('UPSTREAM_ERROR', 'motor ML (porta 5560) inacessível — ligue o card "ML Engine" na aba Admin');
    }
    // Bloqueador 2: 404 em GET /ml/train-jobs/<id> é um corpo estruturado
    // ({state:'UNKNOWN',...}), não uma falha de transporte — deixa fluir
    // para validação de schema em vez de virar UPSTREAM_ERROR genérico.
    if (!response.ok && response.status !== 202 && response.status !== 404) {
      throw new ReadModelError('UPSTREAM_ERROR', `motor ML retornou status ${response.status}`);
    }

    const rawText = await response.text();
    // Bloqueador 21 (revisão Guardião): o limite é em BYTES (payload
    // adversarial em UTF-8 multi-byte), não em unidades de código UTF-16
    // (`string.length`) — usa o tamanho real do buffer.
    if (Buffer.byteLength(rawText, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new ReadModelError('UPSTREAM_MALFORMED_RESPONSE', `resposta do motor ML excede o limite de ${MAX_RESPONSE_BYTES} bytes`);
    }
    let json: unknown;
    try {
      json = JSON.parse(rawText);
    } catch {
      throw new ReadModelError('UPSTREAM_MALFORMED_RESPONSE', 'motor ML retornou um corpo que não é JSON válido');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      // Nunca vaza o payload bruto (pode ser adversarial) — só o path do
      // problema, sanitizado, fica em log server-side via `error.summary`.
      throw new ReadModelError('UPSTREAM_MALFORMED_RESPONSE', `motor ML retornou payload fora do contrato esperado em ${path}`);
    }
    return parsed.data;
  }

  return {
    start: (jobId, symbols) => request('/ml/train-jobs', 'POST', StartResponseSchema, { jobId, symbols }),
    getStatus: (jobId) => request(`/ml/train-jobs/${jobId}`, 'GET', TrainJobStatusSchema),
    cancel: (jobId) => request(`/ml/train-jobs/${jobId}/cancel`, 'POST', CancelResponseSchema),
  };
}
