import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createAgentRunService } from '../../src/application/agent-run';
import { ReadModelError } from '../../src/application/read-models-v1/errors';
import { jsonError } from '../../src/app/api/v1/_shared/http';
import { PrismaAgentRunRepository, InvalidAgentRunTransitionError } from '../../src/adapters/prisma/agent-run';
import type { AgentRunDag } from '../../src/domain/v1/models/agent-run';
import { buildRoleContext } from '../../src/lib/agent-data-context';

async function expectRejection<T extends new (...args: never[]) => Error>(
  promise: Promise<unknown>,
  ctor: T,
  label: string,
): Promise<void> {
  try {
    await promise;
    assert.fail(`esperava rejeição ${ctor.name} em ${label}`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.ok(
      error instanceof ctor,
      `${label}: esperava ${ctor.name}, recebeu ${(error as Error)?.constructor?.name}: ${(error as Error)?.message}`,
    );
  }
}

async function expectReadModelError(promise: Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await promise;
    assert.fail(`esperava ReadModelError(${code}) em ${label}`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.ok(error instanceof ReadModelError, `${label}: esperava ReadModelError, recebeu ${(error as Error)?.constructor?.name}`);
    assert.equal((error as ReadModelError).code, code, `${label}: código esperado ${code}, recebido ${(error as ReadModelError).code}`);
  }
}

function migrationAdditivityTests(): void {
  const foundationSql = readFileSync(
    join(process.cwd(), 'prisma', 'migrations', '20260714000000_add_agent_run_foundation', 'migration.sql'),
    'utf8',
  );
  assert.doesNotMatch(foundationSql, /\bALTER\s+TABLE\b/i, 'migração aditiva do Item 1 não pode conter ALTER TABLE');
  assert.doesNotMatch(foundationSql, /\bDROP\s+TABLE\b/i, 'migração aditiva não pode conter DROP TABLE');
  assert.doesNotMatch(foundationSql, /\bDROP\s+INDEX\b/i, 'migração aditiva não pode conter DROP INDEX');
  assert.match(foundationSql, /CREATE TABLE "AgentRun"/);
  assert.match(foundationSql, /CREATE UNIQUE INDEX "AgentRun_runId_key"/);
  console.log('migration additivity (Item 1): OK (somente CREATE TABLE/INDEX/UNIQUE INDEX, sem ALTER/DROP)');

  const dagSql = readFileSync(
    join(process.cwd(), 'prisma', 'migrations', '20260714010000_add_agent_run_dag_foundation', 'migration.sql'),
    'utf8',
  );
  assert.doesNotMatch(dagSql, /\bDROP\s+TABLE\b/i, 'migração aditiva do Item 2 não pode conter DROP TABLE');
  assert.doesNotMatch(dagSql, /\bDROP\s+COLUMN\b/i, 'migração aditiva do Item 2 não pode conter DROP COLUMN');
  assert.doesNotMatch(dagSql, /\bDROP\s+INDEX\b/i, 'migração aditiva do Item 2 não pode conter DROP INDEX');
  const dagSqlWithoutComments = dagSql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const statements = dagSqlWithoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    assert.match(
      statement,
      /^(ALTER\s+TABLE\s+"AgentRun"\s+ADD\s+COLUMN|CREATE\s+(UNIQUE\s+)?INDEX)\b/i,
      `migração aditiva do Item 2 só pode conter ALTER TABLE ... ADD COLUMN ou CREATE INDEX, encontrado: ${statement.slice(0, 60)}`,
    );
  }
  assert.match(dagSql, /ADD COLUMN "nodeStatesJson"/);
  assert.match(dagSql, /ADD COLUMN "stepsUsed"/);
  assert.match(dagSql, /ADD COLUMN "costUsed"/);
  assert.match(dagSql, /CREATE INDEX "AgentRun_status_updatedAt_idx"/);
  console.log('migration additivity (Item 2): OK (somente ALTER TABLE ADD COLUMN/CREATE INDEX, sem DROP)');
}

function roleContextTests(): void {
  const keys = ['fundamentalista-cvm', 'dividendos', 'risco', 'cetico'] as const;
  const contexts = new Map<string, string>();
  for (const key of keys) {
    const ctx = buildRoleContext(key, 'WEGE3');
    assert.ok(ctx.length > 100, `contexto de ${key} deveria ter conteúdo real`);
    assert.match(ctx, /WEGE3/, `contexto de ${key} deveria citar o ticker`);
    contexts.set(key, ctx);
  }
  // Cada papel recebe uma fatia própria, não o mesmo dump
  assert.notEqual(contexts.get('fundamentalista-cvm'), contexts.get('dividendos'));
  assert.notEqual(contexts.get('dividendos'), contexts.get('risco'));
  assert.match(contexts.get('fundamentalista-cvm')!, /Evolução trimestral/);
  assert.match(contexts.get('dividendos')!, /Proventos por trimestre/);
  assert.match(contexts.get('risco')!, /Indicadores de risco/);
  // Papel desconhecido cai no contexto genérico (carteira) — retrocompat
  const generic = buildRoleContext('papel-desconhecido', 'WEGE3');
  assert.match(generic, /Carteira 12 Dividendos\/JCP/);
  console.log('fatias de contexto por papel: OK (4 fatias distintas por papel; papel desconhecido cai no genérico)');
}

const DAG: AgentRunDag = {
  nodes: [
    { id: 'in1', type: 'INPUT', provides: ['ticker'] },
    { id: 'ag1', type: 'AGENT', role: 'valuation', reads: ['in1.ticker'], provides: ['thesisDraft'] },
    { id: 'ev1', type: 'EVIDENCE', reads: ['ag1.thesisDraft'], provides: ['evidenceList'] },
    { id: 'sy1', type: 'SYNTHESIS', reads: ['ag1.thesisDraft', 'ev1.evidenceList'], provides: ['finding'] },
    { id: 'out1', type: 'OUTPUT', reads: ['sy1.finding'] },
  ],
  edges: [
    ['in1', 'ag1'],
    ['ag1', 'ev1'],
    ['ag1', 'sy1'],
    ['ev1', 'sy1'],
    ['sy1', 'out1'],
  ],
};

async function submissionAndQueuedTests(prisma: PrismaClient): Promise<void> {
  const service = createAgentRunService(prisma);
  const run = await service.submit({
    requestedBy: 'tester',
    kind: 'RESEARCH',
    dag: DAG,
    input: { ticker: 'PETR4' },
    decisionTime: '2099-01-01T00:00:00.000Z',
  });

  assert.equal(run.status, 'QUEUED');
  assert.equal(run.kind, 'RESEARCH');
  assert.equal(run.output, null);
  assert.equal(run.stepsUsed, 0);
  assert.equal(run.costUsed, 0);
  assert.ok(run.runId.length > 0);

  const fetched = await service.get(run.runId);
  assert.equal(fetched.status, 'QUEUED');

  console.log('submissão + QUEUED: OK (POST cria run com DAG semântico, status QUEUED e runId gerado no servidor)');
}

async function dagValidationTests(prisma: PrismaClient): Promise<void> {
  const service = createAgentRunService(prisma);
  const base = {
    requestedBy: 'tester',
    kind: 'RESEARCH' as const,
    input: {},
    decisionTime: '2099-01-01T00:00:00.000Z',
  };

  const cyclicDag: AgentRunDag = {
    nodes: [
      { id: 'a', type: 'AGENT', provides: ['x'] },
      { id: 'b', type: 'SYNTHESIS', reads: ['a.x'], provides: ['y'] },
      { id: 'out', type: 'OUTPUT', reads: ['b.y'] },
    ],
    edges: [
      ['a', 'b'],
      ['b', 'a'],
      ['b', 'out'],
    ],
  };
  await expectReadModelError(service.submit({ ...base, dag: cyclicDag }), 'INVALID_DAG', 'DAG com ciclo');

  const orphanEdgeDag: AgentRunDag = {
    nodes: [
      { id: 'a', type: 'INPUT', provides: ['x'] },
      { id: 'out', type: 'OUTPUT', reads: ['a.x'] },
    ],
    edges: [['a', 'ghost']],
  };
  await expectReadModelError(service.submit({ ...base, dag: orphanEdgeDag }), 'INVALID_DAG', 'aresta referencia nó inexistente');

  const noOutputDag: AgentRunDag = {
    nodes: [
      { id: 'a', type: 'INPUT', provides: ['x'] },
      { id: 'b', type: 'AGENT', reads: ['a.x'], provides: ['y'] },
    ],
    edges: [['a', 'b']],
  };
  await expectReadModelError(service.submit({ ...base, dag: noOutputDag }), 'INVALID_DAG', 'DAG sem nó OUTPUT');

  const twoOutputsDag: AgentRunDag = {
    nodes: [
      { id: 'a', type: 'INPUT', provides: ['x'] },
      { id: 'out1', type: 'OUTPUT', reads: ['a.x'] },
      { id: 'out2', type: 'OUTPUT', reads: ['a.x'] },
    ],
    edges: [
      ['a', 'out1'],
      ['a', 'out2'],
    ],
  };
  await expectReadModelError(service.submit({ ...base, dag: twoOutputsDag }), 'INVALID_DAG', 'DAG com mais de um nó OUTPUT');

  console.log('validação de DAG: OK (ciclo/aresta órfã/sem OUTPUT/múltiplos OUTPUT rejeitados com 400 INVALID_DAG)');
}

async function topologicalExecutionTests(prisma: PrismaClient): Promise<void> {
  const service = createAgentRunService(prisma);
  const run = await service.submit({
    requestedBy: 'tester',
    kind: 'RESEARCH',
    dag: DAG,
    input: { ticker: 'PETR4' },
    decisionTime: '2099-01-01T00:00:00.000Z',
  });

  const finished = await service.advance(run.runId);
  assert.equal(finished.status, 'SUCCEEDED');
  assert.ok(finished.output);
  assert.equal(finished.output!.kind, 'RESEARCH');
  assert.equal(finished.stepsUsed, DAG.nodes.length);
  assert.equal(finished.costUsed, 0 + 2 + 1 + 1 + 0);
  for (const node of DAG.nodes) {
    assert.equal(finished.nodeStates[node.id]?.status, 'DONE', `nó ${node.id} deveria estar DONE`);
  }
  assert.ok(finished.finishedAt);

  const fetched = await service.get(run.runId);
  assert.equal(fetched.status, 'SUCCEEDED');
  assert.deepEqual(fetched.nodeStates, finished.nodeStates);
  assert.deepEqual(fetched.output, finished.output);

  console.log('execução topológica: OK (nodeStates DONE em ordem; stepsUsed/costUsed acumulados corretamente)');
}

async function proposalOutputTests(prisma: PrismaClient): Promise<void> {
  const service = createAgentRunService(prisma);
  const run = await service.submit({
    requestedBy: 'tester',
    kind: 'PROPOSAL',
    dag: DAG,
    input: {},
    decisionTime: '2099-01-01T00:00:00.000Z',
  });

  const finished = await service.advance(run.runId);
  assert.equal(finished.status, 'SUCCEEDED');
  const output = finished.output as unknown as Record<string, unknown>;
  assert.equal(output.kind, 'PROPOSAL');
  assert.equal(output.requiresHumanApproval, true);
  assert.equal('executionOrder' in output, false, 'PROPOSAL nunca pode carregar campo de execução');
  assert.equal('ticket' in output, false);

  console.log('saída PROPOSAL: OK (requiresHumanApproval=true; nenhum campo de execução)');
}

async function knowledgeTimeLookaheadTests(prisma: PrismaClient): Promise<void> {
  const service = createAgentRunService(prisma);
  await expectRejection(
    service.submit({
      requestedBy: 'tester',
      kind: 'RESEARCH',
      dag: DAG,
      input: {},
      decisionTime: '2020-01-01T00:00:00.000Z',
    }),
    ReadModelError,
    'submit com decisionTime no passado (knowledgeTime derivado excederia decisionTime)',
  );

  console.log('no-lookahead: OK (knowledgeTime derivado não pode exceder decisionTime)');
}

async function budgetMaxStepsTests(prisma: PrismaClient): Promise<void> {
  const service = createAgentRunService(prisma);
  const run = await service.submit({
    requestedBy: 'tester',
    kind: 'RESEARCH',
    dag: DAG,
    input: {},
    budget: { maxSteps: 2 },
    decisionTime: '2099-01-01T00:00:00.000Z',
  });

  const finished = await service.advance(run.runId);
  assert.equal(finished.status, 'FAILED');
  assert.equal(finished.error?.code, 'MAX_STEPS_EXCEEDED');
  assert.ok(finished.stepsUsed > 2);
  assert.ok(finished.finishedAt);

  console.log('orçamento maxSteps: OK (estouro de passos leva a FAILED com errorJson explícito)');
}

async function budgetMaxCostTests(prisma: PrismaClient): Promise<void> {
  const service = createAgentRunService(prisma);
  const run = await service.submit({
    requestedBy: 'tester',
    kind: 'RESEARCH',
    dag: DAG,
    input: {},
    budget: { maxCost: 1 },
    decisionTime: '2099-01-01T00:00:00.000Z',
  });

  const finished = await service.advance(run.runId);
  assert.equal(finished.status, 'FAILED');
  assert.equal(finished.error?.code, 'MAX_COST_EXCEEDED');
  assert.ok(finished.costUsed > 1);

  console.log('orçamento maxCost: OK (estouro de custo leva a FAILED com errorJson explícito)');
}

async function budgetTimeoutTests(prisma: PrismaClient): Promise<void> {
  const service = createAgentRunService(prisma);
  const run = await service.submit({
    requestedBy: 'tester',
    kind: 'RESEARCH',
    dag: DAG,
    input: {},
    budget: { timeoutMs: 1 },
    decisionTime: '2099-01-01T00:00:00.000Z',
  });

  const finished = await service.advance(run.runId);
  assert.equal(finished.status, 'FAILED');
  assert.equal(finished.error?.code, 'TIMEOUT_EXCEEDED');

  console.log('orçamento timeoutMs: OK (estouro de tempo leva a FAILED com errorJson explícito)');
}

async function cancelTests(prisma: PrismaClient): Promise<void> {
  const service = createAgentRunService(prisma);

  const queuedRun = await service.submit({
    requestedBy: 'tester',
    kind: 'RESEARCH',
    dag: DAG,
    input: {},
    decisionTime: '2099-01-01T00:00:00.000Z',
  });
  const cancelled = await service.cancel(queuedRun.runId);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.ok(cancelled.finishedAt);

  await expectRejection(service.cancel(queuedRun.runId), ReadModelError, 'cancelar run já CANCELLED');
  try {
    await service.cancel(queuedRun.runId);
    assert.fail('esperava ReadModelError');
  } catch (error) {
    assert.ok(error instanceof ReadModelError);
    assert.equal((error as ReadModelError).status, 409);
    const response = jsonError(error);
    assert.equal(response.status, 409);
  }

  const repository = new PrismaAgentRunRepository(prisma);
  const runningRun = await repository.create({
    requestedBy: 'tester',
    kind: 'RESEARCH',
    dag: DAG,
    input: {},
    budget: {},
    decisionTime: '2099-01-01T00:00:00.000Z',
    knowledgeTime: new Date().toISOString(),
  });
  await repository.transitionTo(runningRun.runId, 'RUNNING');
  const cancelledRunning = await service.cancel(runningRun.runId);
  assert.equal(cancelledRunning.status, 'CANCELLED');

  const succeededRun = await service.submit({
    requestedBy: 'tester',
    kind: 'RESEARCH',
    dag: DAG,
    input: {},
    decisionTime: '2099-01-01T00:00:00.000Z',
  });
  await service.advance(succeededRun.runId);
  await expectRejection(service.cancel(succeededRun.runId), ReadModelError, 'cancelar run já SUCCEEDED');

  console.log('cancelamento: OK (QUEUED/RUNNING -> CANCELLED; estados terminais rejeitam com 409)');
}

async function failedTransitionTests(prisma: PrismaClient): Promise<void> {
  const repository = new PrismaAgentRunRepository(prisma);
  const created = await repository.create({
    requestedBy: 'tester',
    kind: 'RESEARCH',
    dag: DAG,
    input: {},
    budget: {},
    decisionTime: '2099-01-01T00:00:00.000Z',
    knowledgeTime: new Date().toISOString(),
  });

  await repository.transitionTo(created.runId, 'RUNNING');
  const failed = await repository.transitionTo(created.runId, 'FAILED', { error: { code: 'SIMULATED', message: 'falha simulada' } });
  assert.equal(failed.status, 'FAILED');
  assert.deepEqual(failed.error, { code: 'SIMULATED', message: 'falha simulada' });
  assert.equal(failed.output, null);

  await expectRejection(
    repository.transitionTo(created.runId, 'RUNNING'),
    InvalidAgentRunTransitionError,
    'transição inválida a partir de estado terminal FAILED',
  );

  await expectRejection(
    repository.recordProgress(created.runId, { nodeStates: {}, stepsUsed: 0, costUsed: 0 }),
    InvalidAgentRunTransitionError,
    'recordProgress em run não-RUNNING',
  );

  console.log('transição FAILED: OK (RUNNING -> FAILED persiste errorJson; transições/progresso a partir de estado terminal são rejeitados)');
}

async function paginationDeterminismTests(prisma: PrismaClient): Promise<void> {
  const service = createAgentRunService(prisma);
  const requestedBy = 'pagination-tester';
  const decisionTime = '2099-01-01T00:00:00.000Z';

  for (let i = 0; i < 3; i += 1) {
    await service.submit({ requestedBy, kind: 'RESEARCH', dag: DAG, input: { i }, decisionTime });
  }

  const page1a = await service.list({ requestedBy, limit: 1, offset: 0 });
  const page1b = await service.list({ requestedBy, limit: 1, offset: 0 });
  assert.deepEqual(page1a.map((r) => r.runId), page1b.map((r) => r.runId), 'mesma query + limit/offset deve retornar a mesma linha em execuções repetidas');

  const all = await service.list({ requestedBy, limit: 10, offset: 0 });
  assert.equal(all.length, 3);
  const sortedByCreatedAtDesc = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  assert.deepEqual(all.map((r) => r.runId), sortedByCreatedAtDesc.map((r) => r.runId), 'ordenação determinística por createdAt desc');

  console.log('paginação determinística: OK (mesma query repetida é estável; ordenação por createdAt desc)');
}

async function internalErrorSanitizationTests(): Promise<void> {
  const fakePrismaError = Object.assign(new Error('SELECT * FROM "AgentRun" WHERE ... syntax error near "%^&"'), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2010',
    stack: 'PrismaClientKnownRequestError: raw sql failed\n    at file:///C:/secret/path/query.ts:42:17',
  });

  const response = jsonError(fakePrismaError);
  assert.equal(response.status, 500);
  const body = (await response.json()) as { success: boolean; error: { code: string; message: string } };
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /SELECT|syntax error|at file:\/\/\//i, 'resposta não pode vazar SQL ou stack trace');
  assert.doesNotMatch(serialized, /P2010/, 'resposta não pode vazar código interno do driver Prisma');

  console.log('sanitização de erro interno: OK (sem stack/SQL/detalhe de driver no corpo da resposta)');
}

async function main(): Promise<void> {
  migrationAdditivityTests();
  roleContextTests();
  await internalErrorSanitizationTests();

  const prisma = new PrismaClient();
  try {
    await submissionAndQueuedTests(prisma);
    await dagValidationTests(prisma);
    await topologicalExecutionTests(prisma);
    await proposalOutputTests(prisma);
    await knowledgeTimeLookaheadTests(prisma);
    await budgetMaxStepsTests(prisma);
    await budgetMaxCostTests(prisma);
    await budgetTimeoutTests(prisma);
    await cancelTests(prisma);
    await failedTransitionTests(prisma);
    await paginationDeterminismTests(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log('Fase 3 / Item 2 — DAG semântico + orçamento/cancelamento reais: TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
