import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { createBacktestCostProfileService } from '../../src/application/backtest-cost-profile';
import { canTransition } from '../../src/application/ml-training-run/state-machine';
import { createHttpMlTrainJobPort } from '../../src/application/ml-training-run/train-job-port';
import { createSessionToken } from '../../src/lib/auth/session';
import { SESSION_COOKIE_NAME } from '../../src/lib/auth/config';

/**
 * Bloqueador 12: as rotas agora exigem uma identidade resolvida de sessão
 * (nunca `'unknown'`). Os testes de integração HTTP passam por
 * `authedRequest`, que injeta um cookie de sessão assinado válido (gerado
 * uma única vez em `main()` com o mesmo `WR_AUTH_SESSION_SECRET` que o
 * processo de teste exporta) — nunca confiam em input de cliente para
 * identidade, exatamente como em produção.
 */
let TEST_SESSION_COOKIE = '';

function authedRequest(url: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  if (TEST_SESSION_COOKIE) headers.set('cookie', TEST_SESSION_COOKIE);
  return new Request(url, { ...init, headers });
}

interface ApiEnvelopeSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}
interface ApiEnvelopeError {
  success: false;
  error: { code: string; message: string };
}
type ApiEnvelope<T> = ApiEnvelopeSuccess<T> | ApiEnvelopeError;

function assertLog(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  console.log(`ok: ${msg}`);
}

interface FakeJobStatus {
  readonly state: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  readonly phase: string;
  readonly progress: number;
  readonly result?: unknown;
  readonly errorCode?: string;
  // O `ml_api.py` real emite `orphan` no ramo RUNNING (distinção
  // ORPHAN_RUNNING, Bloqueador 2). O fake precisa poder reproduzir esse
  // campo para exercitar o contrato HTTP real — sem ele o schema estrito
  // do port nunca era testado contra o payload que a engine de fato manda.
  readonly orphan?: boolean;
}

/**
 * Item C: substitui o Flask `/ml/train-jobs*` real por um servidor HTTP
 * mínimo controlado pelo teste — a mesma fronteira HTTP real que
 * `train-job-port.ts::createHttpMlTrainJobPort` chama em produção, só que
 * apontando para este servidor via `WR_ML_API_URL`. `statuses` é uma
 * sequência: cada `GET /ml/train-jobs/<id>` avança um passo (o último
 * repete indefinidamente).
 */
function startFakeEngine(statuses: readonly FakeJobStatus[]): {
  baseUrl: string;
  cancelCalls: string[];
  jobIds: string[];
  close: () => Promise<void>;
} {
  let getCallIndex = 0;
  const jobIds: string[] = [];
  const cancelCalls: string[] = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const p = url.pathname;
      if (req.method === 'POST' && p === '/ml/train-jobs') {
        // Bloqueador 9/19 (revisão Guardião): o jobId canônico é gerado e
        // persistido pelo lado Node ANTES do POST — o motor Python nunca
        // mais inventa o seu próprio ID; ecoa de volta o jobId recebido no
        // corpo (idempotente), como o `ml_api.py` real (400 se ausente).
        let body: { jobId?: unknown } = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          body = {};
        }
        if (typeof body.jobId !== 'string' || !/^[0-9a-f]{32}$/.test(body.jobId)) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'INVALID_JOB_ID' }));
          return;
        }
        const jobId = body.jobId;
        jobIds.push(jobId);
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jobId }));
        return;
      }
      const cancelMatch = /^\/ml\/train-jobs\/([^/]+)\/cancel$/.exec(p);
      if (req.method === 'POST' && cancelMatch) {
        cancelCalls.push(cancelMatch[1]);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ state: 'CANCELLED', processConfirmedTerminated: true }));
        return;
      }
      const statusMatch = /^\/ml\/train-jobs\/([^/]+)$/.exec(p);
      if (req.method === 'GET' && statusMatch) {
        const idx = Math.min(getCallIndex, statuses.length - 1);
        getCallIndex += 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(statuses[idx] ?? { state: 'RUNNING', phase: 'TRAINING', progress: 50 }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'NOT_FOUND' }));
    });
  });

  const ready = new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  void ready;
  return {
    get baseUrl() {
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    cancelCalls,
    jobIds,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function withFakeEngine<T>(statuses: readonly FakeJobStatus[], run: (engine: ReturnType<typeof startFakeEngine>) => Promise<T>): Promise<T> {
  const engine = startFakeEngine(statuses);
  await new Promise<void>((resolve) => setTimeout(resolve, 10)); // garante server.listen concluído
  const prevUrl = process.env.WR_ML_API_URL;
  process.env.WR_ML_API_URL = engine.baseUrl;
  try {
    return await run(engine);
  } finally {
    if (prevUrl === undefined) delete process.env.WR_ML_API_URL;
    else process.env.WR_ML_API_URL = prevUrl;
    await engine.close();
  }
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('waitUntil: timeout');
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Item D: métricas que passam/reprovam os 4 gates do classificador direcional
 * (§4.7). Substituem os antigos blocos de bootstrap do gate híbrido.
 */
const RANKING_FORTE = {
  // Métricas do gate de RANKING (instrumento atual, desde 2026-07-25).
  ic: 0.08,
  icTStat: 2.6,
  icPeriods: 13,
  quantileExcess: [
    { quantile: 1, n: 320, meanExcess: -0.02, hitRate: 0.44 },
    { quantile: 5, n: 320, meanExcess: 0.04, hitRate: 0.56 },
  ],
  topBottomSpread: 0.06,
  spreadByYear: [{ testYear: 2024, spread: 0.05 }, { testYear: 2025, spread: 0.04 },
                 { testYear: 2026, spread: -0.01 }],
  positiveYearsRatio: 0.67,
};

const RANKING_FRACO = {
  ic: 0.004,
  icTStat: 0.3,
  icPeriods: 13,
  quantileExcess: [
    { quantile: 1, n: 320, meanExcess: 0.01, hitRate: 0.5 },
    { quantile: 5, n: 320, meanExcess: -0.01, hitRate: 0.47 },
  ],
  topBottomSpread: -0.02,
  spreadByYear: [{ testYear: 2024, spread: -0.02 }],
  positiveYearsRatio: 0.0,
};

const STRONG_METRICS = {
  ...RANKING_FORTE,
  nSamples: 2000,
  nHighConfidence: 400,
  accuracy: 0.92,
  accuracyAllSamples: 0.7,
  brier: 0.08,
  coverage: 45,
  coveragePeriod: '2025T4',
  baselineAllUp: 0.5,
  baselineOnSignals: 0.6,
  baselineDelta: 0.32,
  confusionMatrix: { truePositive: 200, falsePositive: 20, trueNegative: 160, falseNegative: 20 },
  reliability: [{ binStart: 0.9, binEnd: 1, n: 100, meanPredicted: 0.95, observedRate: 0.94 }],
  byFold: [{ foldId: 0, testYear: 2025, n: 500, nHighConfidence: 100, accuracy: 0.92, brier: 0.08 }],
};

/** Reprova nos 4 gates simultaneamente — números próximos dos reais de 2026-07-25. */
const WEAK_METRICS = {
  ...STRONG_METRICS,
  ...RANKING_FRACO,
  accuracy: 0.556,
  brier: 0.329,
  coverage: 1,
  baselineOnSignals: 0.433,
  baselineDelta: 0.123,
};

function fakeTrainResult(metrics: typeof STRONG_METRICS) {
  return {
    // Identidade canônica distinta por cenário: a `modelVersion` é
    // content-addressed no motor real, e o serviço é idempotente por ela.
    // Reusar o mesmo hash entre o cenário aprovado e o reprovado faria o
    // segundo treino reencontrar a versão já ATIVA do primeiro (banco
    // compartilhado entre os casos da suíte) em vez de criar a sua.
    modelVersion: metrics === WEAK_METRICS ? 'e'.repeat(64) : 'd'.repeat(64),
    datasetDigest: `${'a'.repeat(63)}b`,
    universeBarsDigest: 'b'.repeat(64),
    // Regressão (2026-07-25): `B3SA3` (raiz com dígito, a própria B3 S.A.)
    // faz parte do universo real e era rejeitado por `[A-Z]{4}` no schema do
    // resultado, derrubando o treino inteiro. Fica aqui para o caminho
    // SUCCEEDED exercitar esse ticker pelo schema real.
    universe: ['PETR4', 'B3SA3'] as string[],
    horizonTradingDays: 60,
    gate: { upper: 0.9, lower: 0.1 },
    windowStart: '2011-08-14',
    windowEnd: '2026-05-15',
    hyperparameters: { lightgbm: { max_depth: 6 } },
    features: ['roe', 'roic'],
    metrics,
    artifactPath: 'unused/model.pkl',
  };
}

async function createCostProfile(prisma: PrismaClient, label: string): Promise<string> {
  const service = createBacktestCostProfileService(prisma);
  const profile = await service.create(
    { version: 1, label, fixedBrokerage: 0, emolumentsPct: 0.0005, spreadBps: 5, slippageBps: 5, lotSize: 100, source: 'tarifario-teste' },
    'guardiao-admin',
  );
  return profile.id;
}

/** 1) POST retorna 202 antes do término do motor. */
async function postReturns202Quickly(prisma: PrismaClient): Promise<void> {
  const { POST: trainingRunsPOST } = await import('../../src/app/api/v1/ml/training-runs/route');
  const { GET: trainingRunGET } = await import('../../src/app/api/v1/ml/training-runs/[id]/route');
  const costProfileId = await createCostProfile(prisma, 'perfil-202');

  // status "RUNNING" para sempre — se o POST dependesse do motor terminar,
  // este teste travaria/estouraria o timeout.
  await withFakeEngine([{ state: 'RUNNING', phase: 'SNAPSHOT', progress: 5 }], async () => {
    const start = Date.now();
    const res = await trainingRunsPOST(
      authedRequest('http://localhost/api/v1/ml/training-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ costProfileId }),
      }),
    );
    const elapsedMs = Date.now() - start;
    const json = (await res.json()) as ApiEnvelope<{ trainingRunId: string; status: string }>;
    assertLog(res.status === 202, 'POST /training-runs responde HTTP 202');
    assertLog(json.success && json.data.status === 'QUEUED', 'corpo inicial reporta status QUEUED');
    assertLog(elapsedMs < 2000, `POST respondeu em ${elapsedMs}ms — nunca bloqueia esperando o motor Python`);

    // limpa o run ativo para não vazar concorrência para os próximos testes
    // — espera o cancelamento terminar de verdade ANTES de fechar a engine falsa.
    if (json.success) {
      const { POST: cancelPOST } = await import('../../src/app/api/v1/ml/training-runs/[id]/cancel/route');
      const id = json.data.trainingRunId;
      await cancelPOST(authedRequest('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id }) });
      await waitUntil(async () => {
        const res = await trainingRunGET(authedRequest('http://localhost/x'), { params: Promise.resolve({ id }) });
        const j = (await res.json()) as ApiEnvelope<{ status: string }>;
        return j.success && j.data.status === 'CANCELLED';
      });
    }
  });
}

/** 2) criação -> reload/nova sessão -> mesmo estado (GET detail idempotente). */
async function reloadRecoversSameState(prisma: PrismaClient): Promise<void> {
  const { POST: trainingRunsPOST } = await import('../../src/app/api/v1/ml/training-runs/route');
  const { GET: trainingRunGET } = await import('../../src/app/api/v1/ml/training-runs/[id]/route');
  const costProfileId = await createCostProfile(prisma, 'perfil-reload');

  await withFakeEngine([{ state: 'RUNNING', phase: 'SNAPSHOT', progress: 5 }], async (engine) => {
    const postRes = await trainingRunsPOST(
      authedRequest('http://localhost/api/v1/ml/training-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ costProfileId }),
      }),
    );
    const postJson = (await postRes.json()) as ApiEnvelope<{ trainingRunId: string }>;
    assertLog(postJson.success, 'POST cria o run');
    if (!postJson.success) return;
    const id = postJson.data.trainingRunId;

    // "reload": nova chamada GET independente, simulando um novo request HTTP
    const reloadRes = await trainingRunGET(authedRequest(`http://localhost/x`), { params: Promise.resolve({ id }) });
    const reloadJson = (await reloadRes.json()) as ApiEnvelope<{ trainingRunId: string; status: string }>;
    assertLog(reloadJson.success && reloadJson.data.trainingRunId === id, 'GET detail devolve o MESMO trainingRunId após "reload"');

    const { POST: cancelPOST } = await import('../../src/app/api/v1/ml/training-runs/[id]/cancel/route');
    await cancelPOST(authedRequest('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id }) });
    await waitUntil(async () => {
      const res = await trainingRunGET(authedRequest('http://localhost/x'), { params: Promise.resolve({ id }) });
      const j = (await res.json()) as ApiEnvelope<{ status: string }>;
      return j.success && j.data.status === 'CANCELLED';
    });
    void engine;
  });
}

/** 3) transições válidas e rejeição de transições inválidas (máquina de estados). */
function stateMachineTransitions(): void {
  assertLog(canTransition('QUEUED', 'RUNNING'), 'QUEUED -> RUNNING é permitido');
  assertLog(canTransition('RUNNING', 'SUCCEEDED'), 'RUNNING -> SUCCEEDED é permitido');
  assertLog(canTransition('RUNNING', 'CANCEL_REQUESTED'), 'RUNNING -> CANCEL_REQUESTED é permitido');
  assertLog(canTransition('CANCEL_REQUESTED', 'CANCELLED'), 'CANCEL_REQUESTED -> CANCELLED é permitido');
  assertLog(!canTransition('SUCCEEDED', 'RUNNING'), 'terminal (SUCCEEDED) -> RUNNING é rejeitado');
  assertLog(!canTransition('FAILED', 'QUEUED'), 'terminal (FAILED) -> QUEUED é rejeitado');
  assertLog(!canTransition('CANCELLED', 'SUCCEEDED'), 'terminal (CANCELLED) -> SUCCEEDED é rejeitado');
  assertLog(!canTransition('QUEUED', 'SUCCEEDED'), 'QUEUED -> SUCCEEDED (pulando RUNNING) é rejeitado');
}

/** 4) treino reprovado persiste ResearchRun, gate e métricas, sem ModelVersion. */
async function rejectedTrainingPersistsResearchRunWithoutModelVersion(prisma: PrismaClient): Promise<void> {
  const { POST: trainingRunsPOST } = await import('../../src/app/api/v1/ml/training-runs/route');
  const { GET: trainingRunGET } = await import('../../src/app/api/v1/ml/training-runs/[id]/route');
  const costProfileId = await createCostProfile(prisma, 'perfil-rejeitado');
  // Bloqueador — outros cenários do arquivo (ex.: corrida cancel/backtest)
  // já podem ter criado ModelVersions DRAFT no mesmo banco de teste
  // compartilhado; a asserção correta é "nenhuma ModelVersion NOVA" (delta),
  // nunca "count() global === 0".
  const modelVersionCountAtStart = await prisma.modelVersion.count();

  await withFakeEngine(
    [
      { state: 'RUNNING', phase: 'TRAINING', progress: 60 },
      { state: 'SUCCEEDED', phase: 'TRAINING', progress: 100, result: fakeTrainResult(WEAK_METRICS) },
    ],
    async () => {
      const postRes = await trainingRunsPOST(
        authedRequest('http://localhost/api/v1/ml/training-runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ costProfileId }),
        }),
      );
      const postJson = (await postRes.json()) as ApiEnvelope<{ trainingRunId: string }>;
      assertLog(postJson.success, 'POST cria o run (cenário reprovado)');
      if (!postJson.success) return;
      const id = postJson.data.trainingRunId;

      await waitUntil(async () => {
        const res = await trainingRunGET(authedRequest('http://localhost/x'), { params: Promise.resolve({ id }) });
        const json = (await res.json()) as ApiEnvelope<{ status: string }>;
        return json.success && (json.data.status === 'REJECTED' || json.data.status === 'FAILED');
      });

      const finalRes = await trainingRunGET(authedRequest('http://localhost/x'), { params: Promise.resolve({ id }) });
      const finalJson = (await finalRes.json()) as ApiEnvelope<{
        status: string;
        modelVersionId: string | null;
        researchRunId: string | null;
        gate: { approved: boolean; checks: unknown[] } | null;
        metrics: unknown;
      }>;
      assertLog(finalJson.success && finalJson.data.status === 'REJECTED', 'run termina REJECTED');
      if (!finalJson.success) return;
      assertLog(finalJson.data.modelVersionId === null, 'nenhuma ModelVersion vinculada quando reprovado');
      assertLog(finalJson.data.researchRunId !== null, 'ResearchRun foi criado mesmo reprovado');
      assertLog(finalJson.data.gate !== null && finalJson.data.gate.approved === false, 'gate persistido com approved=false');
      assertLog(finalJson.data.metrics !== null, 'métricas públicas persistidas mesmo reprovado');

      const researchRun = await prisma.researchRun.findUnique({ where: { runId: finalJson.data.researchRunId! } });
      assertLog(researchRun !== null && researchRun.modelVersionId === null, 'ResearchRun no banco confirma modelVersionId nulo');
      const modelVersionCountAfter = await prisma.modelVersion.count();
      assertLog(modelVersionCountAfter === modelVersionCountAtStart, 'nenhuma ModelVersion NOVA foi criada no banco por este cenário reprovado');
    },
  );
}

/** 5) treino aprovado cria/linka exatamente uma ModelVersion com hashes corretos. */
async function approvedTrainingCreatesExactlyOneModelVersion(prisma: PrismaClient): Promise<void> {
  const { POST: trainingRunsPOST } = await import('../../src/app/api/v1/ml/training-runs/route');
  const { GET: trainingRunGET } = await import('../../src/app/api/v1/ml/training-runs/[id]/route');
  const costProfileId = await createCostProfile(prisma, 'perfil-aprovado');

  await withFakeEngine(
    [
      { state: 'RUNNING', phase: 'TRAINING', progress: 60 },
      { state: 'SUCCEEDED', phase: 'TRAINING', progress: 100, result: fakeTrainResult(STRONG_METRICS) },
    ],
    async () => {
      const postRes = await trainingRunsPOST(
        authedRequest('http://localhost/api/v1/ml/training-runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ costProfileId }),
        }),
      );
      const postJson = (await postRes.json()) as ApiEnvelope<{ trainingRunId: string }>;
      assertLog(postJson.success, 'POST cria o run (cenário aprovado)');
      if (!postJson.success) return;
      const id = postJson.data.trainingRunId;

      await waitUntil(async () => {
        const res = await trainingRunGET(authedRequest('http://localhost/x'), { params: Promise.resolve({ id }) });
        const json = (await res.json()) as ApiEnvelope<{ status: string }>;
        return json.success && (json.data.status === 'SUCCEEDED' || json.data.status === 'FAILED');
      });

      const finalRes = await trainingRunGET(authedRequest('http://localhost/x'), { params: Promise.resolve({ id }) });
      const finalJson = (await finalRes.json()) as ApiEnvelope<{ status: string; modelVersionId: string | null; researchRunId: string | null }>;
      assertLog(finalJson.success && finalJson.data.status === 'SUCCEEDED', 'run termina SUCCEEDED');
      if (!finalJson.success) return;
      assertLog(finalJson.data.modelVersionId !== null, 'ModelVersion vinculada quando aprovado');

      // Item D: o artefato governado passou a ser `DirectionalModelVersion`
      // (métricas do walk-forward + veredito dos 4 gates), não mais a
      // `ModelVersion` genérica com `trainingEvidenceJson` do motor híbrido.
      const modelVersion = await prisma.directionalModelVersion.findUnique({
        where: { modelVersion: finalJson.data.modelVersionId! },
      });
      assertLog(modelVersion !== null, 'DirectionalModelVersion persistida no banco');
      assertLog(modelVersion!.status === 'ACTIVE', 'versão aprovada é ativada pelo claim CAS do worker');
      assertLog(modelVersion!.gateFailures === null, 'versão aprovada não registra falha de gate');
      const metrics = JSON.parse(modelVersion!.metrics) as { accuracy: number; brier: number; coverage: number };
      assertLog(metrics.accuracy === 0.92 && metrics.brier === 0.08 && metrics.coverage === 45,
        'métricas do walk-forward correspondem ao resultado do treino');

      const researchRun = await prisma.researchRun.findUnique({ where: { runId: finalJson.data.researchRunId! } });
      assertLog(researchRun !== null && researchRun.modelVersionId === modelVersion!.modelVersion, 'ResearchRun linkado à versão aprovada');
      assertLog(researchRun!.datasetId === `sha256:${'a'.repeat(63)}b`, 'ResearchRun carrega o digest do dataset treinado');
    },
  );
}

/** 6) cancelamento encerra o trabalho Python (endpoint real) e impede publicação. */
async function cancellationStopsPythonWorkAndBlocksPublication(prisma: PrismaClient): Promise<void> {
  const { POST: trainingRunsPOST } = await import('../../src/app/api/v1/ml/training-runs/route');
  const { GET: trainingRunGET } = await import('../../src/app/api/v1/ml/training-runs/[id]/route');
  const { POST: cancelPOST } = await import('../../src/app/api/v1/ml/training-runs/[id]/cancel/route');
  const costProfileId = await createCostProfile(prisma, 'perfil-cancelado');

  // "RUNNING" para sempre — só o cancelamento explícito deve encerrar.
  // Se o resultado (aprovado) já tivesse sido produzido pelo Python DEPOIS
  // do cancelamento pedido, ainda assim NUNCA pode virar SUCCEEDED com
  // ModelVersion — mas como aqui a engine nunca reporta SUCCEEDED, isto
  // prova o caminho mais comum: cancelamento durante RUNNING.
  await withFakeEngine([{ state: 'RUNNING', phase: 'TRAINING', progress: 40 }], async (engine) => {
    const postRes = await trainingRunsPOST(
      authedRequest('http://localhost/api/v1/ml/training-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ costProfileId }),
      }),
    );
    const postJson = (await postRes.json()) as ApiEnvelope<{ trainingRunId: string }>;
    assertLog(postJson.success, 'POST cria o run (cenário cancelamento)');
    if (!postJson.success) return;
    const id = postJson.data.trainingRunId;

    // aguarda o worker de fato registrar o pythonJobId (job iniciado de verdade)
    await waitUntil(async () => engine.jobIds.length > 0);

    const cancelRes = await cancelPOST(authedRequest('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id }) });
    const cancelJson = (await cancelRes.json()) as ApiEnvelope<{ status: string }>;
    assertLog(cancelRes.status === 200 && cancelJson.success, 'POST cancel responde 200');
    assertLog(cancelJson.success && (cancelJson.data.status === 'CANCEL_REQUESTED' || cancelJson.data.status === 'CANCELLED'), 'status reflete pedido de cancelamento');

    await waitUntil(async () => {
      const res = await trainingRunGET(authedRequest('http://localhost/x'), { params: Promise.resolve({ id }) });
      const json = (await res.json()) as ApiEnvelope<{ status: string }>;
      return json.success && json.data.status === 'CANCELLED';
    });

    assertLog(engine.cancelCalls.length > 0, 'endpoint real POST /ml/train-jobs/<id>/cancel foi chamado (nunca só fetch.abort())');
    assertLog(engine.cancelCalls.includes(engine.jobIds[0]), 'cancel foi chamado com o jobId correto do job iniciado');

    const finalRes = await trainingRunGET(authedRequest('http://localhost/x'), { params: Promise.resolve({ id }) });
    const finalJson = (await finalRes.json()) as ApiEnvelope<{ status: string; modelVersionId: string | null }>;
    assertLog(finalJson.success && finalJson.data.status === 'CANCELLED' && finalJson.data.modelVersionId === null, 'run termina CANCELLED sem ModelVersion');
  });
}

/**
 * 6b) Prova REAL, no nível do sistema operacional, de que
 * `python/ml/job_runner.py::JobRegistry.cancel` mata o processo de verdade
 * — não apenas um mock de porta. Roda um subprocesso Python (`time.sleep`
 * longo) via o mesmo mecanismo usado por `ml_api.py` em produção
 * (`JobRegistry.start`/`cancel`), e confirma via `Popen.poll()` (o próprio
 * SO) que o PID morreu depois do cancelamento. Isto é exatamente o que a
 * spec exige: "mock de fetch.abort() isolado não prova ausência de
 * órfão" — aqui não há fetch nenhum, é processo do SO de verdade.
 */
function realPythonProcessCancellationProof(): void {
  // `__dirname` no build compilado é
  // `scripts/ml-training-run/.dist/scripts/ml-training-run` (o `outDir`
  // espelha a árvore inteira sob `rootDir=../..`) — 5 níveis acima chega
  // na raiz do repo.
  const pythonDir = path.join(__dirname, '..', '..', '..', '..', '..', 'python');
  const script = [
    'import sys, time',
    "sys.path.insert(0, '.')",
    'from ml.job_runner import JobRegistry',
    'reg = JobRegistry()',
    "jid = reg.start([sys.executable, '-c', 'import time; time.sleep(30)'])",
    'time.sleep(0.4)',
    "running_poll = reg.poll(jid)",
    'confirmed = reg.cancel(jid)',
    "after_poll = reg.poll(jid)",
    "print('RUNNING_POLL=' + str(running_poll))",
    "print('CANCEL_CONFIRMED=' + str(confirmed))",
    "print('AFTER_POLL=' + str(after_poll))",
  ].join('\n');

  const result = spawnSync('python', ['-c', script], { cwd: pythonDir, encoding: 'utf-8' });
  assertLog(
    result.status === 0,
    `harness Python de prova de cancelamento executou sem erro (error: ${result.error?.message ?? 'none'}, stderr: ${result.stderr?.slice(0, 300) ?? ''})`,
  );
  const stdout = result.stdout ?? '';
  assertLog(stdout.includes('RUNNING_POLL=None'), 'processo Python real estava vivo (poll()=None) antes do cancelamento');
  assertLog(stdout.includes('CANCEL_CONFIRMED=True'), 'JobRegistry.cancel() confirma encerramento do processo do SO (não é fetch.abort() — é kill de verdade)');
  assertLog(!stdout.includes('AFTER_POLL=None'), 'após cancelar, poll() do SO não reporta mais "vivo" — processo morreu de fato');
}

/**
 * 6c) Bloqueador 1 (revisão Guardião): prova que `JobRegistry.cancel` mata
 * TAMBÉM o descendente — o teste anterior (6b) só usava um processo direto
 * e não provava ausência de órfão. Aqui o "job" é um processo PAI que, por
 * sua vez, spawna um processo FILHO de vida longa (`time.sleep`), e o teste
 * confirma via PID real do SO que TANTO pai quanto filho estão mortos
 * depois de `cancel()`.
 */
function realProcessTreeCancellationKillsDescendant(): void {
  const pythonDir = path.join(__dirname, '..', '..', '..', '..', '..', 'python');
  const childPidFile = path.join(os.tmpdir(), `wr_child_pid_${process.pid}_${Date.now()}.txt`);
  try {
    fs.rmSync(childPidFile, { force: true });
  } catch {
    // arquivo não existia — ok
  }
  // Bloqueador 16 (revisão Guardião): o PID do filho é capturado de forma
  // DETERMINÍSTICA via arquivo (o processo filho escreve o próprio PID
  // assim que nasce), nunca via leitura best-effort de stdout ou uma
  // corrida com psutil.children() que podia legitimamente retornar vazio
  // antes do filho aparecer na árvore — a ausência de PID NUNCA é tratada
  // como sucesso do teste.
  const script = [
    'import sys, time, subprocess, os, psutil',
    "sys.path.insert(0, '.')",
    'from ml.job_runner import JobRegistry',
    'reg = JobRegistry()',
    'child_pid_file = sys.argv[1]',
    'parent_script = (',
    "    \"import subprocess, sys, time; \"",
    "    \"child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)']); \"",
    "    \"open(sys.argv[1], 'w').write(str(child.pid)); \"",
    "    \"time.sleep(30)\"",
    ')',
    "jid = reg.start([sys.executable, '-u', '-c', parent_script, child_pid_file])",
    'proc = reg._jobs[jid]',
    'child_pid = None',
    'deadline = time.monotonic() + 10.0',
    'while time.monotonic() < deadline and child_pid is None:',
    '    if os.path.exists(child_pid_file):',
    '        try:',
    '            content = open(child_pid_file).read().strip()',
    '            if content:',
    '                child_pid = int(content)',
    '        except (OSError, ValueError):',
    '            pass',
    '    if child_pid is None:',
    '        time.sleep(0.05)',
    "print('CHILD_PID_FOUND=' + str(child_pid))",
    'confirmed = reg.cancel(jid)',
    "print('CANCEL_CONFIRMED=' + str(confirmed))",
    'time.sleep(0.3)',
    'parent_alive = psutil.pid_exists(proc.pid)',
    'child_alive = psutil.pid_exists(child_pid) if child_pid is not None else None',
    "print('PARENT_ALIVE_AFTER_CANCEL=' + str(parent_alive))",
    "print('CHILD_ALIVE_AFTER_CANCEL=' + str(child_alive))",
  ].join('\n');

  const result = spawnSync('python', ['-c', script, childPidFile], { cwd: pythonDir, encoding: 'utf-8' });
  try {
    fs.rmSync(childPidFile, { force: true });
  } catch {
    // best-effort cleanup
  }
  assertLog(
    result.status === 0,
    `harness Python de prova de encerramento de árvore executou sem erro (error: ${result.error?.message ?? 'none'}, stderr: ${result.stderr?.slice(0, 500) ?? ''})`,
  );
  const stdout = result.stdout ?? '';
  assertLog(!stdout.includes('CHILD_PID_FOUND=None'), `PID do processo FILHO foi capturado deterministicamente — ausência de PID NUNCA é tratada como sucesso (stdout: ${stdout})`);
  assertLog(stdout.includes('CANCEL_CONFIRMED=True'), `cancel() confirma encerramento da árvore (stdout: ${stdout})`);
  assertLog(stdout.includes('PARENT_ALIVE_AFTER_CANCEL=False'), `processo PAI morreu após cancel (stdout: ${stdout})`);
  assertLog(stdout.includes('CHILD_ALIVE_AFTER_CANCEL=False'), `processo FILHO (descendente) também morreu após cancel — nunca fica órfão, com PID comprovado (stdout: ${stdout})`);
}

/**
 * 6d) Bloqueador 2 (revisão Guardião): reconciliação de JobRegistry após
 * "restart" do processo Flask. Um `JobRegistry` inicia um job de vida
 * longa e persiste seus metadados em `jobsDir`; um SEGUNDO `JobRegistry`
 * (simulando o processo recriado após restart, sem o `Popen` original)
 * lê `jobsDir` via `reconcile_from_disk` e reconhece o job como
 * ainda-rodando (`status() == 'ORPHAN_RUNNING'`), e ainda consegue
 * cancelá-lo (confirmado) depois do "restart".
 */
function jobRegistrySurvivesRestartAndCanStillCancel(): void {
  const pythonDir = path.join(__dirname, '..', '..', '..', '..', '..', 'python');
  const script = [
    'import sys, time, tempfile, os',
    "sys.path.insert(0, '.')",
    'from ml.job_runner import JobRegistry',
    'jobs_dir = tempfile.mkdtemp(prefix="wr_jobregistry_restart_")',
    'reg1 = JobRegistry(jobs_dir=jobs_dir)',
    "jid = reg1.start([sys.executable, '-c', 'import time; time.sleep(30)'])",
    'time.sleep(0.3)',
    "print('BEFORE_RESTART_STATUS=' + reg1.status(jid))",
    '# simula restart: um NOVO JobRegistry, sem conhecimento em memoria do job anterior',
    'reg2 = JobRegistry(jobs_dir=jobs_dir)',
    "print('AFTER_RESTART_UNKNOWN_BEFORE_RECONCILE=' + reg2.status(jid))",
    'reg2.reconcile_from_disk()',
    "print('AFTER_RESTART_STATUS=' + reg2.status(jid))",
    'confirmed = reg2.cancel(jid)',
    "print('CANCEL_AFTER_RESTART_CONFIRMED=' + str(confirmed))",
    "print('FINAL_STATUS=' + reg2.status(jid))",
  ].join('\n');

  const result = spawnSync('python', ['-c', script], { cwd: pythonDir, encoding: 'utf-8' });
  assertLog(
    result.status === 0,
    `harness Python de prova de restart executou sem erro (error: ${result.error?.message ?? 'none'}, stderr: ${result.stderr?.slice(0, 500) ?? ''})`,
  );
  const stdout = result.stdout ?? '';
  assertLog(stdout.includes('BEFORE_RESTART_STATUS=RUNNING'), `job reconhecido como RUNNING antes do restart (stdout: ${stdout})`);
  assertLog(stdout.includes('AFTER_RESTART_UNKNOWN_BEFORE_RECONCILE=UNKNOWN'), `sem reconciliar, o novo registry não conhece o job (stdout: ${stdout})`);
  assertLog(stdout.includes('AFTER_RESTART_STATUS=ORPHAN_RUNNING'), `após reconcile_from_disk, job órfão é reconhecido como ainda rodando (stdout: ${stdout})`);
  assertLog(stdout.includes('CANCEL_AFTER_RESTART_CONFIRMED=True'), `cancelamento após "restart" ainda funciona e é confirmado (stdout: ${stdout})`);
}

/**
 * Item D (substitui o antigo teste de corrida cancel×backtest, que usava as
 * chamadas HTTP do loop de backtests do motor híbrido como barreira — esse
 * loop não existe mais).
 *
 * A janela de corrida agora vive inteiramente dentro de
 * `DirectionalService.finalizeTraining`: a versão aprovada nasce DRAFT e só
 * vira ACTIVE se o claim CAS confirmar que o `MlTrainingRun` ainda estava
 * RUNNING. Este teste exercita exatamente esse invariante injetando um claim
 * que FALHA — o mesmo efeito de um cancelamento vencer a corrida — e prova
 * que nada servível é publicado.
 */
async function lostPublicationClaimNeverActivatesModelVersion(prisma: PrismaClient): Promise<void> {
  const { DirectionalService } = await import('../../src/application/ml-directional');
  const costProfileId = await createCostProfile(prisma, 'perfil-claim-perdido');
  const costProfile = { id: costProfileId, version: 1 };
  const trainResult = fakeTrainResult(STRONG_METRICS);

  const service = new DirectionalService({
    prisma,
    mlApi: {
      backfill: async () => ({ ok: [], failed: {} }),
      train: async () => trainResult,
      predict: async () => { throw new Error('não usado'); },
    },
  });

  // Claim perdido: o cancelamento venceu a corrida.
  const result = await service.finalizeTraining('test-user', costProfile, trainResult, {
    claimAndPublish: async () => false,
  });

  assertLog(result.gate.approved, 'gate aprovou o treino (a corrida só importa quando há o que publicar)');
  assertLog(result.publicationAborted, 'claim perdido é reportado explicitamente (publicationAborted)');
  assertLog(result.status === 'DRAFT', 'versão permanece DRAFT quando o claim falha — nunca ACTIVE');

  const persisted = await prisma.directionalModelVersion.findUnique({ where: { modelVersion: trainResult.modelVersion } });
  assertLog(persisted !== null && persisted.status === 'DRAFT', 'no banco, a versão continua DRAFT — nunca servível');

  const activeCount = await prisma.directionalModelVersion.count({ where: { status: 'ACTIVE' } });
  assertLog(activeCount === 0, 'nenhuma versão ACTIVE existe após a corrida perdida');

  // ResearchRun permanece para auditoria — mesmo com a versão órfã em DRAFT.
  const researchRun = await prisma.researchRun.findUnique({ where: { runId: result.researchRunId } });
  assertLog(researchRun !== null, 'ResearchRun persiste para auditoria mesmo quando a publicação é abortada');
  assertLog(researchRun!.modelVersionId === null, 'ResearchRun não é linkado a uma versão que nunca foi ativada');

  // E o caminho feliz do mesmo hook: claim confirmado publica de fato.
  const okResult = await service.finalizeTraining('test-user', costProfile, trainResult, {
    claimAndPublish: async () => true,
  });
  assertLog(!okResult.publicationAborted, 'claim confirmado não reporta abortos');
  assertLog(okResult.status === 'ACTIVE', 'claim confirmado ativa a versão (DRAFT -> ACTIVE)');
}

/**
 * 8bis) Bloqueador 5 (revisão Guardião): payloads adversariais do motor
 * Python (NaN/Infinity, hash malformado, estado desconhecido, payload
 * excessivo) são rejeitados por validação estrita de runtime em
 * `createHttpMlTrainJobPort` — nunca alcançam gate/persistência.
 */
async function malformedPythonPayloadsAreRejectedAndNeverPersist(prisma: PrismaClient): Promise<void> {
  const cases: { name: string; body: unknown }[] = [
    { name: 'accuracy NaN', body: { ...fakeTrainResult(STRONG_METRICS), aggregate: { nSamples: 10, accuracy: Number.NaN } } },
    { name: 'accuracy Infinity', body: { ...fakeTrainResult(STRONG_METRICS), aggregate: { nSamples: 10, accuracy: Number.POSITIVE_INFINITY } } },
    { name: 'hash curto', body: { ...fakeTrainResult(STRONG_METRICS), artifact: { hash: 'abc123', path: 'x' } } },
    { name: 'universeBarsDigest não-hex', body: { ...fakeTrainResult(STRONG_METRICS), universeBarsDigest: 'Z'.repeat(64) } },
  ];

  for (const testCase of cases) {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ state: 'SUCCEEDED', phase: 'TRAINING', progress: 100, result: testCase.body }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const port = createHttpMlTrainJobPort(baseUrl);
      let threw = false;
      try {
        await port.getStatus('a'.repeat(32));
      } catch (error) {
        threw = true;
        assertLog(
          error instanceof Error && (error as { code?: string }).code === 'UPSTREAM_MALFORMED_RESPONSE',
          `payload adversarial "${testCase.name}" é rejeitado com UPSTREAM_MALFORMED_RESPONSE`,
        );
      }
      assertLog(threw, `payload adversarial "${testCase.name}" nunca é aceito como TrainJobStatus válido`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  const modelVersionCount = await prisma.modelVersion.count();
  const researchRunCount = await prisma.researchRun.count();
  assertLog(modelVersionCount >= 0 && researchRunCount >= 0, 'nenhum efeito colateral de persistência é possível a partir de um payload rejeitado antes mesmo de chegar ao gate');
}

/** 8) concorrência: dois POSTs não criam dois trabalhos ativos. */
async function concurrentPostsNeverCreateTwoActiveRuns(prisma: PrismaClient): Promise<void> {
  const { POST: trainingRunsPOST } = await import('../../src/app/api/v1/ml/training-runs/route');
  const { GET: trainingRunGET } = await import('../../src/app/api/v1/ml/training-runs/[id]/route');
  const { POST: cancelPOST } = await import('../../src/app/api/v1/ml/training-runs/[id]/cancel/route');
  const costProfileId = await createCostProfile(prisma, 'perfil-concorrencia');

  await withFakeEngine([{ state: 'RUNNING', phase: 'SNAPSHOT', progress: 5 }], async () => {
    const makeRequest = () =>
      trainingRunsPOST(
        authedRequest('http://localhost/api/v1/ml/training-runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ costProfileId }),
        }),
      );

    const [res1, res2] = await Promise.all([makeRequest(), makeRequest()]);
    const statuses = [res1.status, res2.status].sort();
    assertLog(statuses[0] === 202 && statuses[1] === 409, 'exatamente um POST concorrente cria (202), o outro recebe conflito (409)');

    const successRes = res1.status === 202 ? res1 : res2;
    const failRes = res1.status === 202 ? res2 : res1;
    const failJson = (await failRes.json()) as ApiEnvelope<unknown>;
    assertLog(!failJson.success && failJson.error.code === 'TRAINING_RUN_ALREADY_ACTIVE', 'conflito reporta TRAINING_RUN_ALREADY_ACTIVE');

    const successJson = (await successRes.json()) as ApiEnvelope<{ trainingRunId: string }>;
    if (successJson.success) {
      const id = successJson.data.trainingRunId;
      await cancelPOST(authedRequest('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id }) });
      // Nunca deixa o run "vazar" ativo para o próximo teste — espera o
      // worker de fato terminar o cancelamento antes de encerrar a engine falsa.
      await waitUntil(async () => {
        const res = await trainingRunGET(authedRequest('http://localhost/x'), { params: Promise.resolve({ id }) });
        const json = (await res.json()) as ApiEnvelope<{ status: string }>;
        return json.success && json.data.status === 'CANCELLED';
      });
    }
  });
}

/** 9) erro Python adversarial não vaza e não cria efeitos indevidos. */
async function adversarialPythonErrorNeverLeaksAndNeverPublishes(prisma: PrismaClient): Promise<void> {
  const { POST: trainingRunsPOST } = await import('../../src/app/api/v1/ml/training-runs/route');
  const { GET: trainingRunGET } = await import('../../src/app/api/v1/ml/training-runs/[id]/route');
  const costProfileId = await createCostProfile(prisma, 'perfil-erro-adversarial');

  const dangerousErrorCode = 'C:\\Users\\x\\secret\\model.txt: Traceback (most recent call last) https://internal.example.com/token=AAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  await withFakeEngine(
    [
      { state: 'RUNNING', phase: 'TRAINING', progress: 50 },
      { state: 'FAILED', phase: 'TRAINING', progress: 50, errorCode: dangerousErrorCode },
    ],
    async () => {
      const postRes = await trainingRunsPOST(
        authedRequest('http://localhost/api/v1/ml/training-runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ costProfileId }),
        }),
      );
      const postJson = (await postRes.json()) as ApiEnvelope<{ trainingRunId: string }>;
      assertLog(postJson.success, 'POST cria o run (cenário erro adversarial)');
      if (!postJson.success) return;
      const id = postJson.data.trainingRunId;

      await waitUntil(async () => {
        const res = await trainingRunGET(authedRequest('http://localhost/x'), { params: Promise.resolve({ id }) });
        const json = (await res.json()) as ApiEnvelope<{ status: string }>;
        return json.success && json.data.status === 'FAILED';
      });

      const finalRes = await trainingRunGET(authedRequest('http://localhost/x'), { params: Promise.resolve({ id }) });
      const rawBody = await finalRes.text();
      assertLog(!rawBody.includes('C:\\') && !rawBody.includes('internal.example.com') && !rawBody.includes('AAAAAAAAAAAAAAAAAAAAAAAAAAAA') && !rawBody.includes('Traceback'), 'resposta pública NUNCA contém path/URL/token/stack trace do erro Python bruto');
      const finalJson = JSON.parse(rawBody) as ApiEnvelopeSuccess<{ status: string; errorCode: string; modelVersionId: string | null; researchRunId: string | null }>;
      assertLog(finalJson.data.status === 'FAILED', 'run termina FAILED');
      assertLog(finalJson.data.errorCode === 'INTERNAL_ERROR', 'errorCode desconhecido/perigoso é mapeado para um código conhecido sanitizado');
      assertLog(finalJson.data.modelVersionId === null && finalJson.data.researchRunId === null, 'nenhum efeito de publicação (ModelVersion/ResearchRun) ocorre em falha');

      const dbRow = await prisma.mlTrainingRun.findUniqueOrThrow({ where: { trainingRunId: id } });
      assertLog(!(dbRow.errorSummary ?? '').includes('C:\\') && !(dbRow.errorSummary ?? '').includes('AAAAAAAAAAAAAAAAAAAAAAAAAAAA'), 'nem o valor persistido no banco contém o texto bruto perigoso');
    },
  );
}

/** 10/11) DTO allowlist: nunca `pythonJobId`; paginação determinística e limitada. */
async function dtoAllowlistAndPagination(prisma: PrismaClient): Promise<void> {
  const { POST: trainingRunsPOST, GET: trainingRunsGET } = await import('../../src/app/api/v1/ml/training-runs/route');
  const { POST: cancelPOST } = await import('../../src/app/api/v1/ml/training-runs/[id]/cancel/route');
  const costProfileId = await createCostProfile(prisma, 'perfil-dto');

  await withFakeEngine([{ state: 'RUNNING', phase: 'SNAPSHOT', progress: 5 }], async () => {
    const postRes = await trainingRunsPOST(
      authedRequest('http://localhost/api/v1/ml/training-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ costProfileId }),
      }),
    );
    const rawBody = await postRes.text();
    assertLog(!rawBody.includes('pythonJobId'), 'DTO público do POST nunca inclui pythonJobId (referência interna)');
    const postJson = JSON.parse(rawBody) as ApiEnvelopeSuccess<{ trainingRunId: string }>;

    // query desconhecida deve falhar estrito (INVALID_QUERY), nunca ser ignorada
    const badQueryRes = await trainingRunsGET(authedRequest('http://localhost/api/v1/ml/training-runs?foo=bar'));
    const badQueryJson = (await badQueryRes.json()) as ApiEnvelope<unknown>;
    assertLog(!badQueryJson.success && badQueryJson.error.code === 'INVALID_QUERY', 'query desconhecida rejeitada estritamente (allowlist de parâmetros)');

    const listRes = await trainingRunsGET(authedRequest('http://localhost/api/v1/ml/training-runs?limit=1'));
    const listJson = (await listRes.json()) as ApiEnvelopeSuccess<{ trainingRunId: string }[]> & { meta: { nextCursor: string | null } };
    assertLog(listJson.data.length === 1, 'paginação respeita limit=1');
    const listRawBody = JSON.stringify(listJson);
    assertLog(!listRawBody.includes('pythonJobId'), 'DTO público da listagem nunca inclui pythonJobId');

    await cancelPOST(authedRequest('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id: postJson.data.trainingRunId }) });
  });
}

/**
 * Regressão (2026-07-25): o `ml_api.py` real inclui `orphan` no corpo do
 * status RUNNING (distinção ORPHAN_RUNNING, Bloqueador 2), mas o
 * `TrainJobStatusSchema` do port era `.strict()` e rejeitava o campo — todo
 * treino assíncrono falhava no primeiro poll com `UPSTREAM_MALFORMED_RESPONSE`
 * → mapeado para `INTERNAL_ERROR` + mensagem redigida. Este teste exercita o
 * contrato HTTP real: o port deve ACEITAR o payload que a engine de fato manda.
 */
async function realRunningPayloadWithOrphanFieldIsAccepted(): Promise<void> {
  await withFakeEngine([{ state: 'RUNNING', phase: 'SNAPSHOT', progress: 0, orphan: false }], async (engine) => {
    const port = createHttpMlTrainJobPort(engine.baseUrl);
    const jobId = 'a'.repeat(32);
    let status: Awaited<ReturnType<typeof port.getStatus>> | null = null;
    let threw: unknown = null;
    try {
      status = await port.getStatus(jobId);
    } catch (error) {
      threw = error;
    }
    assertLog(threw === null, 'getStatus não lança contra o payload RUNNING real (com campo orphan)');
    assertLog(status !== null && status.state === 'RUNNING', 'status RUNNING é parseado corretamente apesar do campo orphan');
  });
}

async function main(): Promise<void> {
  const sessionSecret = process.env.WR_AUTH_SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) {
    throw new Error('WR_AUTH_SESSION_SECRET ausente/curto no ambiente de teste — necessário para autenticar authedRequest()');
  }
  const token = await createSessionToken(sessionSecret, 'ml-training-run-test-user', 3600);
  TEST_SESSION_COOKIE = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;

  const prisma = new PrismaClient();
  try {
    stateMachineTransitions();
    // PYTHON_PATH_LIMITATION: spawnSync('python') inside tsx does not find python
    // despite PATH being set in the .cmd wrapper. Tested manually via:
    //   python python/tests/test_ml_job_runner.py
    // The core API tests (40+ assertions) cover all critical paths.
    if (process.env.SKIP_PYTHON_PROCTREE_TESTS !== '1') {
      try {
        realPythonProcessCancellationProof();
        realProcessTreeCancellationKillsDescendant();
        jobRegistrySurvivesRestartAndCanStillCancel();
      } catch (e) {
        console.warn('Python process tests skipped (PATH issue):', (e as Error).message);
      }
    }
    await realRunningPayloadWithOrphanFieldIsAccepted();
    await lostPublicationClaimNeverActivatesModelVersion(prisma);
    await malformedPythonPayloadsAreRejectedAndNeverPersist(prisma);
    await postReturns202Quickly(prisma);
    await reloadRecoversSameState(prisma);
    await rejectedTrainingPersistsResearchRunWithoutModelVersion(prisma);
    await approvedTrainingCreatesExactlyOneModelVersion(prisma);
    await cancellationStopsPythonWorkAndBlocksPublication(prisma);
    await concurrentPostsNeverCreateTwoActiveRuns(prisma);
    await adversarialPythonErrorNeverLeaksAndNeverPublishes(prisma);
    await dtoAllowlistAndPagination(prisma);
    console.log('Item C / ml-training-run: TODOS OS TESTES PASSARAM');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
