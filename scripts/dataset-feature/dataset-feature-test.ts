import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';
import {
  insertSnapshotForTest,
  PrismaDatasetSnapshotRepository,
} from '../../src/adapters/prisma/dataset-snapshot';
import {
  FeatureValueSubmissionSchema,
  insertFeatureValueForTest,
  PrismaFeatureValueRepository,
} from '../../src/adapters/prisma/feature-value';
import { PrismaIngestionLedger, PrismaReferenceDataIngestionUnitOfWork } from '../../src/adapters/prisma/reference-data';
import { createDatasetSnapshotService } from '../../src/application/dataset-snapshot';
import { createFeatureValueService } from '../../src/application/feature-value';
import { rawToDecimalString } from '../../src/application/feature-value/decimal';
import { ReadModelError } from '../../src/application/read-models-v1/errors';
import { jsonError } from '../../src/app/api/v1/_shared/http';

const SOURCE = 'dataset-feature:test-source';

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
    '20260713225531_add_dataset_feature_foundation',
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
  assert.match(sql, /CREATE TABLE "DatasetSnapshot"/);
  assert.match(sql, /CREATE TABLE "FeatureValue"/);
  assert.match(sql, /CREATE UNIQUE INDEX "FeatureValue_featureId_decisionTime_knowledgeTime_key"/);
  console.log('migration additivity: OK (somente CREATE TABLE/INDEX/UNIQUE INDEX, sem ALTER/DROP)');
}

async function seedSucceededRun(prisma: PrismaClient, startedAt: string, completedAt: string): Promise<string> {
  const refUow = new PrismaReferenceDataIngestionUnitOfWork(prisma);
  const runId = await refUow.begin(SOURCE, startedAt);
  await refUow.commit(runId, completedAt, '{"message":"seed run"}', { issuers: [], instrumentVersions: [] });
  return runId;
}

async function knowledgeTimeBoundaryValidationTests(prisma: PrismaClient): Promise<void> {
  const snapshotService = createDatasetSnapshotService(prisma);
  const featureService = createFeatureValueService(prisma);

  await expectRejection(
    snapshotService.getSnapshots({ decisionTime: '2026-01-01T00:00:00.000Z', knowledgeTime: '2026-01-02T00:00:00.000Z' }),
    ReadModelError,
    'DatasetSnapshot service: knowledgeTime > decisionTime',
  );

  await expectRejection(
    featureService.getValues({ decisionTime: '2026-01-01T00:00:00.000Z', knowledgeTime: '2026-01-02T00:00:00.000Z' }),
    ReadModelError,
    'FeatureValue service: knowledgeTime > decisionTime',
  );

  // Confirm the rejection carries the 400-equivalent status/code, and
  // that jsonError translates it without leaking internals.
  try {
    await snapshotService.getSnapshots({ decisionTime: '2026-01-01T00:00:00.000Z', knowledgeTime: '2026-01-02T00:00:00.000Z' });
    assert.fail('esperava ReadModelError');
  } catch (error) {
    assert.ok(error instanceof ReadModelError);
    assert.equal((error as ReadModelError).status, 400);
    const response = jsonError(error);
    assert.equal(response.status, 400);
  }

  console.log('knowledgeTime <= decisionTime: OK (rejeitado com 400-equivalente nos dois serviços)');
}

async function datasetSnapshotOrderingTests(prisma: PrismaClient): Promise<void> {
  const runId = await seedSucceededRun(prisma, '2026-07-13T10:00:00.000Z', '2026-07-13T10:01:00.000Z');
  const domains = {
    referenceData: { issuers: 10, instrumentVersions: 20 },
    cvm: { filings: 5, facts: 100, shareCapitalFacts: 8 },
    marketBars: { count: 1000 },
  };
  const decisionTime = '2026-07-13T12:00:00.000Z';

  await insertSnapshotForTest(prisma, runId, {
    snapshotId: 'snap-later',
    asOf: decisionTime,
    knowledgeTime: '2026-07-13T11:30:00.000Z',
    decisionTime,
    domains,
  });
  await insertSnapshotForTest(prisma, runId, {
    snapshotId: 'snap-earlier',
    asOf: decisionTime,
    knowledgeTime: '2026-07-13T10:30:00.000Z',
    decisionTime,
    domains,
  });

  const repo = new PrismaDatasetSnapshotRepository(prisma);
  const rows = await repo.findSnapshots({ decisionTime, knowledgeTime: '2026-07-13T12:00:00.000Z' });
  assert.equal(rows.length, 2, 'duas linhas com mesmo decisionTime e knowledgeTime distintos não conflitam');
  assert.equal(rows[0].snapshotId, 'snap-earlier');
  assert.equal(rows[1].snapshotId, 'snap-later');
  assert.ok(rows[0].knowledgeTime <= rows[1].knowledgeTime, 'ordenação deve ser knowledgeTime ASC');

  const service = createDatasetSnapshotService(prisma);
  const viaService = await service.getSnapshots({ decisionTime, knowledgeTime: '2026-07-13T12:00:00.000Z' });
  assert.equal(viaService.length, 2);
  assert.deepEqual(
    viaService.map((s) => s.snapshotId),
    ['snap-earlier', 'snap-later'],
  );
  assert.deepEqual(viaService[0].domains, domains, 'domains deve ser serializado/parseado sem perda');

  console.log('DatasetSnapshot ordering: OK (knowledgeTime ASC; mesmo decisionTime com knowledgeTime distintos coexistem)');
}

async function bigintExactDecimalTests(prisma: PrismaClient): Promise<void> {
  const runId = await seedSucceededRun(prisma, '2026-07-14T10:00:00.000Z', '2026-07-14T10:01:00.000Z');
  const decisionTime = '2026-07-14T11:00:00.000Z';
  const knowledgeTime = '2026-07-14T11:00:00.000Z';

  await insertFeatureValueForTest(prisma, runId, {
    featureId: 'feat-bigint-1',
    subjectId: 'subject-1',
    featureType: 'BIGINT',
    valueRaw: '123456789012345678',
    scalePow: -9,
    knowledgeTime,
    decisionTime,
  });

  const repo = new PrismaFeatureValueRepository(prisma);
  const rows = await repo.findValues({ featureId: 'feat-bigint-1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].valueRaw, '123456789012345678');
  assert.equal(rows[0].scalePow, -9);

  // Exact decimal-string reconstruction, never Number()/parseFloat.
  const decimal = rawToDecimalString('123456789012345678', -9);
  assert.equal(decimal, '123456789.012345678');

  const viaService = await createFeatureValueService(prisma).getValues({ featureId: 'feat-bigint-1' });
  assert.equal(viaService.length, 1);
  assert.ok(viaService[0].bigintValue);
  assert.equal(viaService[0].bigintValue?.decimal, '123456789.012345678');
  assert.equal(viaService[0].bigintValue?.raw, '123456789012345678');
  assert.equal(viaService[0].bigintValue?.scalePow, -9);

  // scalePow outside [-18,18] must be rejected by the schema, even
  // though it is not generally true that
  // Number.isInteger(BigInt(raw) * 10n**BigInt(scalePow)) for negative
  // scalePow (10n ** negative is not a valid BigInt operation at all) —
  // the exact-decimal-string comparison above is the correct assertion.
  assert.throws(
    () =>
      FeatureValueSubmissionSchema.parse({
        featureId: 'feat-bigint-oob',
        subjectId: 'subject-1',
        featureType: 'BIGINT',
        valueRaw: '1',
        scalePow: 19,
        knowledgeTime,
        decisionTime,
      }),
    ZodError,
    'scalePow=19 deve ser rejeitado (fora de [-18,18])',
  );
  assert.throws(
    () =>
      FeatureValueSubmissionSchema.parse({
        featureId: 'feat-bigint-oob2',
        subjectId: 'subject-1',
        featureType: 'BIGINT',
        valueRaw: '1',
        scalePow: -19,
        knowledgeTime,
        decisionTime,
      }),
    ZodError,
    'scalePow=-19 deve ser rejeitado (fora de [-18,18])',
  );
  // Boundary values are accepted.
  FeatureValueSubmissionSchema.parse({
    featureId: 'feat-bigint-bound-1',
    subjectId: 'subject-1',
    featureType: 'BIGINT',
    valueRaw: '1',
    scalePow: 18,
    knowledgeTime,
    decisionTime,
  });
  FeatureValueSubmissionSchema.parse({
    featureId: 'feat-bigint-bound-2',
    subjectId: 'subject-1',
    featureType: 'BIGINT',
    valueRaw: '1',
    scalePow: -18,
    knowledgeTime,
    decisionTime,
  });

  console.log('FeatureValue BIGINT: OK (reconstrução decimal exata por string; scalePow limitado a [-18,18])');
}

function forbiddenFeatureTypeTests(): void {
  const knowledgeTime = '2026-07-15T00:00:00.000Z';
  const decisionTime = '2026-07-15T00:00:00.000Z';

  // Runtime rejection simulating an externally-sourced payload bypassing
  // the TypeScript FeatureType union via an `as any` cast.
  const badPayload = {
    featureId: 'feat-float',
    subjectId: 'subject-1',
    featureType: 'FLOAT' as unknown as 'STRING',
    valueRaw: '1.5',
    knowledgeTime,
    decisionTime,
  };
  assert.throws(() => FeatureValueSubmissionSchema.parse(badPayload), ZodError, 'featureType=FLOAT deve ser rejeitado');

  const scoringPayload = {
    featureId: 'feat-scoring',
    subjectId: 'subject-1',
    featureType: 'AGENT_SIGNAL' as unknown as 'STRING',
    valueRaw: 'BUY',
    knowledgeTime,
    decisionTime,
  };
  assert.throws(
    () => FeatureValueSubmissionSchema.parse(scoringPayload),
    ZodError,
    'featureType de scoring/narrativa de agente deve ser rejeitado',
  );

  console.log('featureType restrito: OK (FLOAT e tipos de scoring/narrativa rejeitados em runtime)');
}

async function paginationDeterminismTests(prisma: PrismaClient): Promise<void> {
  const runId = await seedSucceededRun(prisma, '2026-07-16T10:00:00.000Z', '2026-07-16T10:01:00.000Z');
  const decisionTime = '2026-07-16T12:00:00.000Z';
  const sameKnowledgeTime = '2026-07-16T11:00:00.000Z';

  // Multiple rows sharing the exact same knowledgeTime: id must be the
  // deterministic secondary sort key.
  const ids: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const id = await insertFeatureValueForTest(prisma, runId, {
      featureId: `feat-page-${i}`,
      subjectId: 'subject-page',
      featureType: 'STRING',
      valueRaw: `value-${i}`,
      knowledgeTime: sameKnowledgeTime,
      decisionTime,
    });
    ids.push(id);
  }

  const repo = new PrismaFeatureValueRepository(prisma);
  const page1a = await repo.findValues({ subjectId: 'subject-page', limit: 2, offset: 0 });
  const page1b = await repo.findValues({ subjectId: 'subject-page', limit: 2, offset: 0 });
  assert.deepEqual(
    page1a.map((r) => r.id),
    page1b.map((r) => r.id),
    'mesma query + limit/offset deve retornar a mesma ordenação em execuções repetidas',
  );

  const page2 = await repo.findValues({ subjectId: 'subject-page', limit: 2, offset: 2 });
  const overlap = page1a.filter((a) => page2.some((b) => b.id === a.id));
  assert.equal(overlap.length, 0, 'páginas consecutivas não devem se sobrepor');

  const all = await repo.findValues({ subjectId: 'subject-page', limit: 10, offset: 0 });
  assert.equal(all.length, 5);
  const sortedIds = [...all.map((r) => r.id)].sort();
  assert.deepEqual(
    all.map((r) => r.id),
    sortedIds,
    'com knowledgeTime empatado, id deve ser o critério de desempate determinístico',
  );

  console.log('paginação determinística: OK (mesma query repetida é estável; id é desempate secundário)');
}

async function appendOnlyStructuralTests(prisma: PrismaClient): Promise<void> {
  const snapshotRepo = new PrismaDatasetSnapshotRepository(prisma);
  const featureRepo = new PrismaFeatureValueRepository(prisma);

  for (const repo of [snapshotRepo, featureRepo] as const) {
    assert.equal(typeof (repo as unknown as Record<string, unknown>).update, 'undefined', 'update não deve existir no repositório');
    assert.equal(typeof (repo as unknown as Record<string, unknown>).delete, 'undefined', 'delete não deve existir no repositório');
    assert.equal(typeof (repo as unknown as Record<string, unknown>).upsert, 'undefined', 'upsert não deve existir no repositório');
    assert.equal(typeof (repo as unknown as Record<string, unknown>).remove, 'undefined', 'remove não deve existir no repositório');
  }

  console.log('append-only estrutural: OK (repositórios não expõem update/delete/upsert/remove)');
}

async function duplicateFeatureKeyTests(prisma: PrismaClient): Promise<void> {
  const runId = await seedSucceededRun(prisma, '2026-07-17T10:00:00.000Z', '2026-07-17T10:01:00.000Z');
  const decisionTime = '2026-07-17T12:00:00.000Z';
  const knowledgeTime = '2026-07-17T11:00:00.000Z';

  await insertFeatureValueForTest(prisma, runId, {
    featureId: 'feat-dup',
    subjectId: 'subject-dup',
    featureType: 'STRING',
    valueRaw: 'a',
    knowledgeTime,
    decisionTime,
  });

  // Idempotency/uniqueness: same (featureId, decisionTime, knowledgeTime)
  // is rejected by the DB unique constraint before any duplicate write.
  await assert.rejects(
    insertFeatureValueForTest(prisma, runId, {
      featureId: 'feat-dup',
      subjectId: 'subject-dup',
      featureType: 'STRING',
      valueRaw: 'b',
      knowledgeTime,
      decisionTime,
    }),
    'segunda inserção com a mesma chave (featureId, decisionTime, knowledgeTime) deve ser rejeitada pela constraint única',
  );

  const count = await prisma.featureValue.count({ where: { featureId: 'feat-dup' } });
  assert.equal(count, 1, 'nenhuma linha duplicada deve ter sido persistida');

  console.log('unicidade de chave: OK (featureId+decisionTime+knowledgeTime duplicado falha antes da escrita)');
}

async function internalErrorSanitizationTests(): Promise<void> {
  const fakePrismaError = Object.assign(new Error('SELECT * FROM "FeatureValue" WHERE ... syntax error near "%^&"'), {
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
  forbiddenFeatureTypeTests();
  await internalErrorSanitizationTests();

  const prisma = new PrismaClient();
  try {
    await knowledgeTimeBoundaryValidationTests(prisma);
    await datasetSnapshotOrderingTests(prisma);
    await bigintExactDecimalTests(prisma);
    await paginationDeterminismTests(prisma);
    await appendOnlyStructuralTests(prisma);
    await duplicateFeatureKeyTests(prisma);

    // Sanity check that IngestionLedger is reachable through the same
    // composed services (provenance resolution round-trips).
    const ledger = new PrismaIngestionLedger(prisma);
    const anyRun = await ledger.findRuns({ sourceKey: SOURCE });
    assert.ok(anyRun.length > 0, 'runs seedadas neste harness devem ser enumeráveis via IngestionLedger');
  } finally {
    await prisma.$disconnect();
  }
  console.log('Fase 2 / Item 5 — DatasetSnapshot e FeatureValue: TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
