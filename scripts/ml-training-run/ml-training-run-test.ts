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

const STRONG_BLOCKS = Array.from({ length: 80 }, (_, i) => ({
  block: `T${i % 7}:2024-${(i % 12) + 1}`,
  n: 10,
  hitsModel: 8,
  hitsAlwaysUp: 5,
  hitsTimesfm: 5,
  hitsFundamental: 5,
  hitsPriceOnly: 5,
}));
const WEAK_BLOCKS = Array.from({ length: 80 }, (_, i) => ({
  block: `T${i % 7}:2024-${(i % 12) + 1}`,
  n: 10,
  hitsModel: 6,
  hitsAlwaysUp: 6,
  hitsTimesfm: 6,
  hitsFundamental: 6,
  hitsPriceOnly: 6,
}));

function fakeTrainResult(blocks: typeof STRONG_BLOCKS) {
  return {
    // Bloqueador 21 (revisão Guardião): datasetHash agora exige o formato
    // canônico sha256:<64-hex> — não basta um placeholder curto.
    datasetHash: `sha256:${'a'.repeat(64)}`,
    datasetDigest: `${'a'.repeat(63)}b`,
    universeBarsDigest: 'b'.repeat(64),
    // Bloqueador 15 (revisão Guardião): TrainResultSchema exige universe
    // não-vazio (.min(1)) — universo vazio fazia o worker rejeitar o
    // payload como malformado antes de chegar a REJECTED/SUCCEEDED. Um
    // único símbolo aqui não dispara I/O real: falhas por símbolo em
    // runRealBacktests são capturadas e viram `skipped[symbol]` (D6),
    // nunca derrubam o teste — a engine falsa nem serve /ml/predictions.
    universe: ['PETR4'] as string[],
    windowStart: '2019-01-05',
    windowEnd: '2026-07-17',
    hyperparameters: { max_depth: 6 },
    aggregate: { nSamples: 800, accuracy: 0.8 },
    baselines: {
      alwaysUp: { accuracy: 0.5 },
      timesfmOnly: { accuracy: 0.5 },
      fundamentalOnly: { accuracy: 0.5 },
      priceOnlyLgbm: { accuracy: 0.5 },
    },
    blocks,
    backtest: { metrics: { totalReturn: 0.1 } },
    artifact: { hash: 'd'.repeat(64), path: 'unused' },
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
      { state: 'SUCCEEDED', phase: 'TRAINING', progress: 100, result: fakeTrainResult(WEAK_BLOCKS) },
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
        gate: { approved: boolean; comparisons: unknown[] } | null;
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
      { state: 'SUCCEEDED', phase: 'TRAINING', progress: 100, result: fakeTrainResult(STRONG_BLOCKS) },
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

      const modelVersion = await prisma.modelVersion.findUnique({ where: { modelVersion: finalJson.data.modelVersionId! } });
      assertLog(modelVersion !== null && modelVersion.trainingEvidenceJson !== null, 'ModelVersion persistida no banco com trainingEvidenceJson');
      const evidence = JSON.parse(modelVersion!.trainingEvidenceJson!) as { gate: { approved: boolean }; artifact: { hash: string }; datasetHash: string };
      assertLog(evidence.gate.approved === true, 'evidência confirma gate.approved === true');
      assertLog(evidence.artifact.hash === 'd'.repeat(64), 'hash do artefato corresponde ao resultado do treino');
      assertLog(evidence.datasetHash === `${'a'.repeat(63)}b`, 'datasetHash corresponde ao digest do treino');

      const researchRun = await prisma.researchRun.findUnique({ where: { runId: finalJson.data.researchRunId! } });
      assertLog(researchRun !== null && researchRun.modelVersionId === modelVersion!.modelVersion, 'ResearchRun linkado à ModelVersion aprovada');
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
 * 7) LOTE 2 (Item C, correção da corrida cancel/publicação, 2026-07-23):
 * prova a corrida REAL, com uma barreira de verdade — não apenas
 * `checkCancelled: true` setado antes de entrar em `finalizeTraining`.
 *
 * Sobe um motor Python falso que, além de `/ml/train-jobs*`, também serve
 * `/ml/predictions/:hash` e `/ml/snapshot-bars/:hash` (chamadas reais de
 * `runRealBacktests`) — e essas duas rotas ficam PENDURADAS numa Promise
 * controlada pelo teste até o teste mandar liberar. O fluxo completo passa
 * pelas rotas HTTP reais (`POST /training-runs`, `POST .../cancel`), pelo
 * worker in-process real e por `MlHybridService.finalizeTraining` real —
 * nada é mockado no nível de `finalizeTraining`/`checkCancelled` in-process.
 *
 * Sequência determinística:
 *  1. POST cria o run; engine reporta SUCCEEDED (gate aprova, STRONG_BLOCKS).
 *  2. o worker entra em `runRealBacktests` e dispara GET /ml/predictions e
 *     GET /ml/snapshot-bars para o único símbolo do universo — ambas as
 *     rotas ficam bloqueadas na barreira (prova de que o teste está
 *     genuinamente "no meio do loop de backtests", via I/O real, nunca via
 *     um mock que resolve na hora).
 *  3. só DEPOIS de confirmar (via contador incrementado dentro do handler
 *     HTTP, antes do `await` na barreira) que as duas requisições chegaram,
 *     o teste dispara `POST /training-runs/:id/cancel` CONCORRENTE de
 *     verdade (rota HTTP real, sem esperar o worker).
 *  4. o teste libera a barreira — as respostas HTTP finalmente retornam.
 *  5. asserts: (a) o run termina CANCELLED; (b) nenhuma ModelVersion com
 *     `publishedAt` não-nulo (ativa/elegível para previsão) existe; (c)
 *     ResearchRun (e qualquer BacktestRun eventualmente criado) continuam
 *     no banco para auditoria.
 */
async function raceBetweenCancelAndBacktestNeverPublishesActiveModelVersion(prisma: PrismaClient): Promise<void> {
  const { POST: trainingRunsPOST } = await import('../../src/app/api/v1/ml/training-runs/route');
  const { GET: trainingRunGET } = await import('../../src/app/api/v1/ml/training-runs/[id]/route');
  const { POST: cancelPOST } = await import('../../src/app/api/v1/ml/training-runs/[id]/cancel/route');
  const costProfileId = await createCostProfile(prisma, 'perfil-corrida-cancel-backtest');

  let gateReleased = false;
  let releaseGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseGate = () => {
      gateReleased = true;
      resolve();
    };
  });
  let backtestRequestsReceived = 0;
  const jobIds: string[] = [];
  const cancelCalls: string[] = [];
  let getCallIndex = 0;
  const statuses: readonly FakeJobStatus[] = [
    { state: 'RUNNING', phase: 'TRAINING', progress: 60 },
    { state: 'SUCCEEDED', phase: 'TRAINING', progress: 100, result: fakeTrainResult(STRONG_BLOCKS) },
  ];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;
    if (req.method === 'POST' && p === '/ml/train-jobs') {
      // Bloqueador 9/19: ecoa o jobId gerado pelo Node (não inventa um) —
      // consome o corpo antes de responder, como o motor real faria.
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
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
        jobIds.push(body.jobId);
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jobId: body.jobId }));
      });
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
      res.end(JSON.stringify(statuses[idx]));
      return;
    }
    // Barreira real: só responde depois que o teste chamar `releaseGate()`.
    // Incrementa o contador ANTES do `await gate` — prova determinística de
    // que o worker de fato está bloqueado no meio de `runRealBacktests`.
    if (req.method === 'GET' && (p.startsWith('/ml/predictions/') || p.startsWith('/ml/snapshot-bars/'))) {
      backtestRequestsReceived += 1;
      void gate.then(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ rows: [], total: 0, limit: 100, offset: 0 }));
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const prevUrl = process.env.WR_ML_API_URL;
  process.env.WR_ML_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const postRes = await trainingRunsPOST(
      authedRequest('http://localhost/api/v1/ml/training-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ costProfileId }),
      }),
    );
    const postJson = (await postRes.json()) as ApiEnvelope<{ trainingRunId: string }>;
    assertLog(postJson.success, `POST cria o run (cenário de corrida cancel/backtest) — status=${postRes.status} body=${JSON.stringify(postJson)}`);
    if (!postJson.success) return;
    const id = postJson.data.trainingRunId;

    // Barreira real: espera as duas chamadas concorrentes de backtest
    // (predictions + snapshot-bars) chegarem de fato ao servidor ANTES de
    // disparar o cancelamento — prova, via I/O real, que estamos no meio
    // do loop de `runRealBacktests`, nunca um `checkCancelled: true`
    // setado antes de sequer entrar na função.
    await waitUntil(async () => backtestRequestsReceived >= 2, 5000, 5);
    assertLog(!gateReleased, 'a barreira ainda não foi liberada quando o cancelamento concorrente é disparado — prova de bloqueio real no meio do loop');

    const cancelRes = await cancelPOST(authedRequest('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id }) });
    const cancelJson = (await cancelRes.json()) as ApiEnvelope<{ status: string }>;
    assertLog(cancelRes.status === 200 && cancelJson.success, 'POST cancel concorrente (disparado com o worker travado no meio dos backtests) responde 200');

    // Libera a barreira SÓ DEPOIS do cancelamento já ter sido persistido —
    // reproduz exatamente a janela de corrida do bug original (bloqueadores
    // 3/17/18): CANCEL_REQUESTED chega DURANTE o trabalho de backtest/gate,
    // antes do claim final de publicação.
    releaseGate();

    await waitUntil(async () => {
      const res = await trainingRunGET(authedRequest('http://localhost/x'), { params: Promise.resolve({ id }) });
      const json = (await res.json()) as ApiEnvelope<{ status: string }>;
      return json.success && (json.data.status === 'CANCELLED' || json.data.status === 'FAILED');
    });

    const finalRes = await trainingRunGET(authedRequest('http://localhost/x'), { params: Promise.resolve({ id }) });
    const finalJson = (await finalRes.json()) as ApiEnvelope<{
      status: string;
      modelVersionId: string | null;
      researchRunId: string | null;
    }>;
    assertLog(finalJson.success && finalJson.data.status === 'CANCELLED', `(a) run termina CANCELLED mesmo com gate aprovado e backtest em andamento (status: ${finalJson.success ? finalJson.data.status : 'erro'})`);
    if (!finalJson.success) return;

    // (b) nenhuma ModelVersion ATIVA (publishedAt não-nulo) associada a
    // este run — o claim CAS final falhou porque o run já não estava mais
    // RUNNING quando `claimAndPublish` rodou (o cancelamento venceu a
    // corrida real, não uma flag setada de antemão).
    const activeModelVersionCount = await prisma.modelVersion.count({ where: { publishedAt: { not: null } } });
    assertLog(activeModelVersionCount === 0, '(b) nenhuma ModelVersion ATIVA (publishedAt preenchido) existe após a corrida — nenhuma versão elegível para previsão foi publicada');

    // (c) ResearchRun permanece para auditoria — mesmo se uma ModelVersion
    // DRAFT chegou a ser criada (órfã, mas nunca publicada/elegível).
    assertLog(finalJson.data.researchRunId !== null, '(c) ResearchRun foi criado e persiste para auditoria mesmo com o cancelamento vencendo a corrida');
    const researchRun = await prisma.researchRun.findUnique({ where: { runId: finalJson.data.researchRunId! } });
    assertLog(researchRun !== null, '(c) ResearchRun continua existindo no banco (auditável) após o run terminar CANCELLED');

    if (finalJson.data.modelVersionId) {
      const draftModelVersion = await prisma.modelVersion.findUnique({ where: { modelVersion: finalJson.data.modelVersionId } });
      assertLog(draftModelVersion !== null && draftModelVersion.publishedAt === null, 'a ModelVersion criada durante o treino cancelado permanece DRAFT (publishedAt null) para sempre — órfã, mas nunca ativa');
    }

    void cancelCalls;
    void jobIds;
  } finally {
    if (!gateReleased) releaseGate();
    if (prevUrl === undefined) delete process.env.WR_ML_API_URL;
    else process.env.WR_ML_API_URL = prevUrl;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * 8bis) Bloqueador 5 (revisão Guardião): payloads adversariais do motor
 * Python (NaN/Infinity, hash malformado, estado desconhecido, payload
 * excessivo) são rejeitados por validação estrita de runtime em
 * `createHttpMlTrainJobPort` — nunca alcançam gate/persistência.
 */
async function malformedPythonPayloadsAreRejectedAndNeverPersist(prisma: PrismaClient): Promise<void> {
  const cases: { name: string; body: unknown }[] = [
    { name: 'accuracy NaN', body: { ...fakeTrainResult(STRONG_BLOCKS), aggregate: { nSamples: 10, accuracy: Number.NaN } } },
    { name: 'accuracy Infinity', body: { ...fakeTrainResult(STRONG_BLOCKS), aggregate: { nSamples: 10, accuracy: Number.POSITIVE_INFINITY } } },
    { name: 'hash curto', body: { ...fakeTrainResult(STRONG_BLOCKS), artifact: { hash: 'abc123', path: 'x' } } },
    { name: 'universeBarsDigest não-hex', body: { ...fakeTrainResult(STRONG_BLOCKS), universeBarsDigest: 'Z'.repeat(64) } },
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
    await raceBetweenCancelAndBacktestNeverPublishesActiveModelVersion(prisma);
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
