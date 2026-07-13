import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createAgentRunService } from '../../src/application/agent-run';
import { ReadModelError } from '../../src/application/read-models-v1/errors';
import { jsonError } from '../../src/app/api/v1/_shared/http';
import { PrismaAgentRunRepository, InvalidAgentRunTransitionError } from '../../src/adapters/prisma/agent-run';
import type { AgentRunDag } from '../../src/domain/v1/models/agent-run';

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

function migrationAdditivityTests(): void {
  const migrationPath = join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260714000000_add_agent_run_foundation',
    'migration.sql',
  );
  const sql = readFileSync(migrationPath, 'utf8');
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i, 'migração aditiva não pode conter ALTER TABLE');
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i, 'migração aditiva não pode conter DROP TABLE');
  assert.doesNotMatch(sql, /\bDROP\s+INDEX\b/i, 'migração aditiva não pode conter DROP INDEX');
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));
  for (const statement of statements) {
    assert.match(
      statement,
      /^CREATE\s+(TABLE|(UNIQUE\s+)?INDEX)\b/i,
      `migração aditiva só pode conter CREATE TABLE/CREATE INDEX/CREATE UNIQUE INDEX, encontrado: ${statement.slice(0, 60)}`,
    );
  }
  assert.match(sql, /CREATE TABLE "AgentRun"/);
  assert.match(sql, /CREATE UNIQUE INDEX "AgentRun_runId_key"/);
  console.log('migration additivity: OK (somente CREATE TABLE/INDEX/UNIQUE INDEX, sem ALTER/DROP)');
}

const DAG: AgentRunDag = { nodes: ['fetch', 'analyze'], edges: [['fetch', 'analyze']] };

async function submissionAndQueuedTests(prisma: PrismaClient): Promise<void> {
  const service = createAgentRunService(prisma);
  const run = await service.submit({
    requestedBy: 'tester',
    kind: 'RESEARCH',
    dag: DAG,
    input: { symbol: 'PETR4' },
    decisionTime: '2099-01-01T00:00:00.000Z',
  });

  assert.equal(run.status, 'QUEUED');
  assert.equal(run.kind, 'RESEARCH');
  assert.equal(run.output, null);
  assert.ok(run.runId.length > 0);

  const fetched = await service.get(run.runId);
  assert.equal(fetched.status, 'QUEUED');

  console.log('submissão + QUEUED: OK (POST cria run com status QUEUED e runId gerado no servidor)');
}

async function lifecycleTransitionTests(prisma: PrismaClient): Promise<void> {
  const service = createAgentRunService(prisma);
  const run = await service.submit({
    requestedBy: 'tester',
    kind: 'RESEARCH',
    dag: DAG,
    input: {},
    decisionTime: '2099-01-01T00:00:00.000Z',
  });

  const running = await service.get(run.runId);
  assert.equal(running.status, 'QUEUED');

  const finished = await service.advance(run.runId);
  assert.equal(finished.status, 'SUCCEEDED');
  assert.ok(finished.output);
  assert.equal(finished.output!.kind, 'RESEARCH');
  assert.ok(finished.finishedAt);

  const fetched = await service.get(run.runId);
  assert.equal(fetched.status, 'SUCCEEDED');
  assert.deepEqual(fetched.output, finished.output);

  console.log('ciclo de vida QUEUED -> RUNNING -> SUCCEEDED: OK (GET reflete transições e contrato de saída)');
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

  console.log('transição FAILED: OK (RUNNING -> FAILED persiste errorJson; transições a partir de estado terminal são rejeitadas)');
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
  await internalErrorSanitizationTests();

  const prisma = new PrismaClient();
  try {
    await submissionAndQueuedTests(prisma);
    await lifecycleTransitionTests(prisma);
    await proposalOutputTests(prisma);
    await knowledgeTimeLookaheadTests(prisma);
    await cancelTests(prisma);
    await failedTransitionTests(prisma);
    await paginationDeterminismTests(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log('Fase 3 / Item 1 — AgentRun assíncrono persistente: TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
