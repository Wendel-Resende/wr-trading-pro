import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaMarketBarIngestionUnitOfWork } from '../../src/adapters/prisma/market-bar';
import { PrismaInstrumentRepository, PrismaReferenceDataIngestionUnitOfWork } from '../../src/adapters/prisma/reference-data';
import { createReconciliationService } from '../../src/application/reconciliation';
import { ReadModelError } from '../../src/application/read-models-v1/errors';
import { jsonError } from '../../src/app/api/v1/_shared/http';
import type { VersionedMarketBarSubmission } from '../../src/domain/v1/models/versioned-market-bar';

const SOURCE = 'reconciliation:test-source';

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
    '20260713235959_add_reconciliation_foundation',
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
  assert.match(sql, /CREATE TABLE "ReconciliationPlan"/);
  assert.match(sql, /CREATE TABLE "ReconciliationReport"/);
  assert.match(sql, /CREATE TABLE "ReconciliationRow"/);
  assert.match(sql, /CREATE UNIQUE INDEX "ReconciliationRow_planId_domain_key"/);
  console.log('migration additivity: OK (somente CREATE TABLE/INDEX/UNIQUE INDEX, sem ALTER/DROP)');
}

async function seedInstrumentVersion(
  prisma: PrismaClient,
  symbol: string,
  exchange: string,
  validFrom: string,
  startedAt: string,
  completedAt: string,
): Promise<string> {
  const refUow = new PrismaReferenceDataIngestionUnitOfWork(prisma);
  const runId = await refUow.begin('reference:reconciliation-seed', startedAt);
  await refUow.commit(runId, completedAt, '{"message":"seed instrument version"}', {
    issuers: [],
    instrumentVersions: [
      {
        symbol,
        exchange,
        currency: 'BRL',
        displayName: symbol,
        assetClass: 'equity',
        status: 'ACTIVE',
        validFromBasis: 'SOURCE_EFFECTIVE',
        validFrom,
      },
    ],
  });
  const instruments = new PrismaInstrumentRepository(prisma);
  const versions = await instruments.findInstrumentVersions(symbol, exchange, { knowledgeTime: completedAt });
  const version = versions.find((v) => v.validFrom === new Date(validFrom).toISOString());
  if (!version) throw new Error(`seedInstrumentVersion: versão não encontrada para ${symbol}/${exchange}`);
  return version.id;
}

function bar(overrides: Partial<VersionedMarketBarSubmission> & { instrumentVersionId: string }): VersionedMarketBarSubmission {
  return {
    sourceRecordKey: 'default-key',
    timeframe: '1d',
    openedAt: '2026-01-01T00:00:00.000Z',
    closedAt: '2026-01-02T00:00:00.000Z',
    sourceAvailableAt: '2026-01-02T00:00:00.000Z',
    openRaw: BigInt(1000),
    highRaw: BigInt(1100),
    lowRaw: BigInt(900),
    closeRaw: BigInt(1050),
    priceScalePow: -2,
    volumeRaw: BigInt(500),
    volumeScalePow: 0,
    volumeSemantics: 'SHARES',
    priceBasis: 'TRADE',
    quality: 'FINAL',
    rawSha256: 'a'.repeat(64),
    isRevision: false,
    ...overrides,
  };
}

async function seedVersionedBar(
  prisma: PrismaClient,
  instrumentVersionId: string,
  startedAt: string,
  completedAt: string,
  overrides: Partial<VersionedMarketBarSubmission>,
): Promise<void> {
  const uow = new PrismaMarketBarIngestionUnitOfWork(prisma);
  const runId = await uow.begin(SOURCE, startedAt);
  await uow.commit(runId, completedAt, '{"message":"reconciliation seed"}', {
    bars: [bar({ instrumentVersionId, ...overrides })],
  });
}

async function lookaheadRejectionTests(prisma: PrismaClient): Promise<void> {
  const service = createReconciliationService(prisma);

  await expectRejection(
    service.getPlan({ decisionTime: '2026-01-01T00:00:00.000Z', knowledgeTime: '2026-01-02T00:00:00.000Z' }),
    ReadModelError,
    'plan: knowledgeTime > decisionTime',
  );
  await expectRejection(
    service.getReport({ decisionTime: '2026-01-01T00:00:00.000Z', knowledgeTime: '2026-01-02T00:00:00.000Z' }),
    ReadModelError,
    'report: knowledgeTime > decisionTime',
  );

  try {
    await service.getPlan({ decisionTime: '2026-01-01T00:00:00.000Z', knowledgeTime: '2026-01-02T00:00:00.000Z' });
    assert.fail('esperava ReadModelError');
  } catch (error) {
    assert.ok(error instanceof ReadModelError);
    assert.equal((error as ReadModelError).status, 400);
    const response = jsonError(error);
    assert.equal(response.status, 400);
  }

  console.log('lookahead protection: OK (knowledgeTime > decisionTime rejeitado nos dois endpoints)');
}

async function planDomainsAndCountsTests(prisma: PrismaClient): Promise<void> {
  const decisionTime = '2026-02-01T12:00:00.000Z';
  const knowledgeTime = decisionTime;
  const symbol = 'RECN3';

  await prisma.historicalCandle.create({
    data: { symbol, timeframe: '1d', time: new Date('2026-01-15T00:00:00.000Z'), open: 10, high: 11, low: 9, close: 10.5, volume: 1000 },
  });

  const ivId = await seedInstrumentVersion(prisma, symbol, 'B3', '2026-01-01T00:00:00.000Z', '2026-01-20T00:00:00.000Z', '2026-01-20T00:01:00.000Z');
  await seedVersionedBar(prisma, ivId, '2026-01-21T00:00:00.000Z', '2026-01-21T00:01:00.000Z', {
    sourceRecordKey: `${symbol}-bar-1`,
    openedAt: '2026-01-15T00:00:00.000Z',
    closedAt: '2026-01-16T00:00:00.000Z',
    sourceAvailableAt: '2026-01-16T00:00:00.000Z',
  });

  const service = createReconciliationService(prisma);
  const rows = await service.getPlan({ decisionTime, knowledgeTime, subjectId: symbol });

  assert.equal(rows.length, 3, 'sem filtro de domínio, plan deve retornar as 3 linhas de domínio');
  const byDomain = new Map(rows.map((r) => [r.domain, r]));
  assert.ok(byDomain.has('cvm-facts'));
  assert.ok(byDomain.has('market-bars'));
  assert.ok(byDomain.has('stock-monitoring'));

  const marketBarsRow = byDomain.get('market-bars')!;
  assert.equal(marketBarsRow.legacyCount, 1, 'legacyCount deve contar o HistoricalCandle seedado');
  assert.equal(marketBarsRow.newCount, 1, 'newCount deve contar o VersionedMarketBar seedado');
  assert.equal(marketBarsRow.matchedSamples, 1, 'mesmo symbol/timeframe/data deve casar por rótulo canônico');
  assert.equal(marketBarsRow.mismatchSamples, 0);

  const cvmRow = byDomain.get('cvm-facts')!;
  assert.equal(cvmRow.legacyCount, 0, 'não existe fundação legada estruturada para fatos CVM');

  console.log('plan domínios/contagens: OK (3 domínios retornados; contagens de market-bars corretas)');
}

async function reportMismatchTests(prisma: PrismaClient): Promise<void> {
  const decisionTime = '2026-03-01T12:00:00.000Z';
  const symbol = 'MISM3';

  await prisma.historicalCandle.create({
    data: { symbol, timeframe: '1d', time: new Date('2026-02-15T00:00:00.000Z'), open: 20, high: 21, low: 19, close: 20.5, volume: 2000 },
  });
  // No corresponding VersionedMarketBar is seeded for MISM3: legacy has a
  // sample the new foundation does not, so the label cannot match.

  const service = createReconciliationService(prisma);
  const report = await service.getReport({
    decisionTime,
    domain: 'market-bars',
    from: '2026-02-01T00:00:00.000Z',
    to: decisionTime,
  });

  assert.equal(report.domains.length, 1);
  assert.equal(report.domains[0].mismatchSamples > 0, true, 'linha isolada de market-bars deve ter mismatch > 0');
  assert.equal(report.overall, 'SEM_PARIDADE', 'único domínio pedido com mismatch > 0 deve resultar em SEM_PARIDADE');

  console.log('report SEM_PARIDADE: OK (mismatch > 0 em domínio único gera SEM_PARIDADE)');
}

async function reportParityTests(prisma: PrismaClient): Promise<void> {
  const decisionTime = '2026-04-01T12:00:00.000Z';
  const symbol = 'PARI3';

  await prisma.historicalCandle.create({
    data: { symbol, timeframe: '1d', time: new Date('2026-03-15T00:00:00.000Z'), open: 30, high: 31, low: 29, close: 30.5, volume: 3000 },
  });
  const ivId = await seedInstrumentVersion(prisma, symbol, 'B3', '2026-03-01T00:00:00.000Z', '2026-03-20T00:00:00.000Z', '2026-03-20T00:01:00.000Z');
  await seedVersionedBar(prisma, ivId, '2026-03-21T00:00:00.000Z', '2026-03-21T00:01:00.000Z', {
    sourceRecordKey: `${symbol}-bar-1`,
    openedAt: '2026-03-15T00:00:00.000Z',
    closedAt: '2026-03-16T00:00:00.000Z',
    sourceAvailableAt: '2026-03-16T00:00:00.000Z',
  });

  const service = createReconciliationService(prisma);
  const report = await service.getReport({
    decisionTime,
    domain: 'market-bars',
    from: '2026-03-01T00:00:00.000Z',
    to: decisionTime,
  });

  assert.equal(report.domains.length, 1);
  assert.equal(report.domains[0].mismatchSamples, 0, 'legacy e new casando por rótulo canônico não deve ter mismatch');
  assert.equal(report.overall, 'PARIDADE', 'amostras coincidentes em todos os domínios pedidos deve gerar PARIDADE');

  console.log('report PARIDADE: OK (amostras coincidentes geram PARIDADE)');
}

async function paginationDeterminismTests(prisma: PrismaClient): Promise<void> {
  const decisionTime = '2026-05-01T12:00:00.000Z';
  const service = createReconciliationService(prisma);

  const page1a = await service.getPlan({ decisionTime, limit: 1, offset: 0 });
  const page1b = await service.getPlan({ decisionTime, limit: 1, offset: 0 });
  assert.deepEqual(page1a.map((r) => r.domain), page1b.map((r) => r.domain), 'mesma query + limit/offset deve retornar a mesma linha em execuções repetidas');
  assert.deepEqual(page1a.map((r) => r.domain), ['cvm-facts'], 'ordenação determinística alfabética por domínio');

  const page2 = await service.getPlan({ decisionTime, limit: 1, offset: 1 });
  assert.deepEqual(page2.map((r) => r.domain), ['market-bars']);

  const page3 = await service.getPlan({ decisionTime, limit: 1, offset: 2 });
  assert.deepEqual(page3.map((r) => r.domain), ['stock-monitoring']);

  const all = await service.getPlan({ decisionTime, limit: 10, offset: 0 });
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((r) => r.domain), ['cvm-facts', 'market-bars', 'stock-monitoring']);

  console.log('paginação determinística: OK (mesma query repetida é estável; ordenação alfabética por domínio é o desempate)');
}

async function internalErrorSanitizationTests(): Promise<void> {
  const fakePrismaError = Object.assign(new Error('SELECT * FROM "VersionedMarketBar" WHERE ... syntax error near "%^&"'), {
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
    await lookaheadRejectionTests(prisma);
    await planDomainsAndCountsTests(prisma);
    await reportMismatchTests(prisma);
    await reportParityTests(prisma);
    await paginationDeterminismTests(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log('Fase 2 / Item 6 — Reconciliação e paridade com legado: TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
