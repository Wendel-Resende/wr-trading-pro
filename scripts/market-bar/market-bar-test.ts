import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';
import {
  BarChainViolationError,
  BarConflictError,
  DuplicateSourceRecordError,
  InstrumentVersionNotKnownError,
  InvalidMarketBarInputError,
  OpenedAtOutOfKnownRangeError,
  PredecessorAlreadySupersededError,
  PrismaMarketBarIngestionUnitOfWork,
  PrismaMarketBarRepository,
  RunChronologyError,
  RunNotRunningError,
  SourceSymbolRuleViolationError,
  UnknownInstrumentVersionReferenceError,
  UnknownPredecessorBarError,
} from '../../src/adapters/prisma/market-bar';
import { PrismaInstrumentRepository, PrismaReferenceDataIngestionUnitOfWork } from '../../src/adapters/prisma/reference-data';
import type { MarketBarIngestionBatch } from '../../src/domain/v1/ports/market-bar-ingestion-unit-of-work';
import type { VersionedMarketBarSubmission } from '../../src/domain/v1/models/versioned-market-bar';

const SOURCE = 'mt5:xp';
const SQX_SOURCE = 'sqx:wdo-win-long';

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

const emptyBatch: MarketBarIngestionBatch = { bars: [] };

function migrationAdditivityTests(): void {
  const migrationPath = join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260713131546_add_market_bar_foundation',
    'migration.sql',
  );
  const sql = readFileSync(migrationPath, 'utf8');
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i, 'migração aditiva não pode conter ALTER TABLE');
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i, 'migração aditiva não pode conter DROP TABLE');
  assert.doesNotMatch(sql, /\bDROP\s+INDEX\b/i, 'migração aditiva não pode conter DROP INDEX');
  assert.match(sql, /CREATE TABLE "VersionedMarketBar"/);
  assert.match(sql, /CREATE UNIQUE INDEX "VersionedMarketBar_supersedesBarId_key"/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "VersionedMarketBar_instrumentVersionId_timeframe_sourceKey_openedAt_revisionNumber_key"/,
  );
  assert.match(sql, /CREATE UNIQUE INDEX "VersionedMarketBar_sourceKey_sourceRecordKey_key"/);
  assert.match(sql, /CREATE INDEX "VersionedMarketBar_sourceAvailableAt_idx"/);
  assert.match(sql, /CREATE INDEX/);
  console.log('migration additivity: OK (somente CREATE TABLE/INDEX)');
}

/** Helper: creates an InstrumentVersion via the reference-data foundation (the market-bar batch itself never creates one). Returns its id. */
async function seedInstrumentVersion(
  prisma: PrismaClient,
  symbol: string,
  exchange: string,
  validFrom: string,
  startedAt: string,
  completedAt: string,
  validTo?: string,
): Promise<string> {
  const refUow = new PrismaReferenceDataIngestionUnitOfWork(prisma);
  const runId = await refUow.begin('reference:seed', startedAt);
  await refUow.commit(runId, completedAt, '{"message":"seed instrument version"}', {
    issuers: [],
    instrumentVersions: [
      {
        symbol,
        exchange,
        currency: 'BRL',
        displayName: symbol,
        assetClass: symbol.startsWith('WIN') || symbol.startsWith('WDO') ? 'future' : 'equity',
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
  if (validTo) {
    // Close the interval with a second run so tests can exercise out-of-range openedAt.
    const closeRunId = await refUow.begin('reference:seed-close', completedAt);
    await refUow.commit(closeRunId, validTo, '{"message":"close interval"}', {
      issuers: [],
      instrumentVersions: [
        {
          symbol,
          exchange,
          currency: 'BRL',
          displayName: symbol,
          assetClass: symbol.startsWith('WIN') || symbol.startsWith('WDO') ? 'future' : 'equity',
          status: 'ACTIVE',
          validFromBasis: 'SOURCE_EFFECTIVE',
          validFrom: validTo,
        },
      ],
    });
  }
  return version.id;
}

function bar(overrides: Partial<VersionedMarketBarSubmission> & { instrumentVersionId: string }): VersionedMarketBarSubmission {
  return {
    sourceRecordKey: 'default-key',
    timeframe: '1d',
    openedAt: '2026-07-13T00:00:00.000Z',
    closedAt: '2026-07-14T00:00:00.000Z',
    sourceAvailableAt: '2026-07-14T00:00:00.000Z',
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

async function runLifecycleTests(prisma: PrismaClient): Promise<void> {
  const uow = new PrismaMarketBarIngestionUnitOfWork(prisma);

  const runId = await uow.begin(' MT5:Lifecycle ', '2026-07-13T12:00:00.000Z');
  await uow.commit(runId, '2026-07-13T12:05:00.000Z', '{"message":"ok"}', emptyBatch);
  await expectRejection(uow.commit(runId, '2026-07-13T12:06:00.000Z', '{"message":"again"}', emptyBatch), RunNotRunningError, 'commit on SUCCEEDED run');
  await expectRejection(uow.fail(runId, '2026-07-13T12:06:00.000Z', '{"message":"too late"}'), RunNotRunningError, 'fail on SUCCEEDED run');

  const failRunId = await uow.begin(SOURCE, '2026-07-13T12:10:00.000Z');
  await uow.fail(failRunId, '2026-07-13T12:11:00.000Z', '{"message":"boom"}');
  await expectRejection(uow.commit(failRunId, '2026-07-13T12:12:00.000Z', '{"message":"nope"}', emptyBatch), RunNotRunningError, 'commit on FAILED run');

  const chronologyRun = await uow.begin(SOURCE, '2026-07-13T12:30:00.000Z');
  await expectRejection(
    uow.commit(chronologyRun, '2026-07-13T12:29:59.999Z', '{"message":"impossible"}', emptyBatch),
    RunChronologyError,
    'completedAt before startedAt',
  );
  await uow.commit(chronologyRun, '2026-07-13T12:30:00.000Z', '{"message":"equal is valid"}', emptyBatch);

  console.log('run lifecycle: OK (RUNNING -> SUCCEEDED/FAILED guards fail closed)');
}

async function unknownInstrumentAndRangeTests(prisma: PrismaClient): Promise<void> {
  const uow = new PrismaMarketBarIngestionUnitOfWork(prisma);

  const runId = await uow.begin(SOURCE, '2026-07-14T00:00:00.000Z');
  await expectRejection(
    uow.commit(runId, '2026-07-14T00:01:00.000Z', '{"message":"unknown instrument"}', {
      bars: [bar({ instrumentVersionId: 'does-not-exist', sourceRecordKey: 'unknown-1' })],
    }),
    UnknownInstrumentVersionReferenceError,
    'bar referencing an unknown instrumentVersionId',
  );
  console.log('unknown instrument: OK (unit of work nunca cria InstrumentVersion; referência desconhecida falha fechado)');

  // InstrumentVersion known only AFTER this run's completedAt: not-yet-known.
  const futureIvId = await seedInstrumentVersion(prisma, 'FUTV3', 'B3', '2026-07-15T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:01:00.000Z');
  const tooEarlyRun = await uow.begin(SOURCE, '2026-07-16T00:00:00.000Z');
  await expectRejection(
    uow.commit(tooEarlyRun, '2026-07-16T00:01:00.000Z', '{"message":"not yet known"}', {
      bars: [bar({ instrumentVersionId: futureIvId, sourceRecordKey: 'future-iv-1', openedAt: '2026-07-15T00:00:00.000Z', closedAt: '2026-07-16T00:00:00.000Z', sourceAvailableAt: '2026-07-16T00:00:00.000Z' })],
    }),
    InstrumentVersionNotKnownError,
    'InstrumentVersion not yet known at this run completedAt',
  );
  console.log('InstrumentVersion not-yet-known: OK (point-in-time gate falha fechado)');

  // openedAt before validFrom: out of range.
  const ivId = await seedInstrumentVersion(prisma, 'RNGV3', 'B3', '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', '2026-08-02T00:01:00.000Z');
  const outOfRangeRun = await uow.begin(SOURCE, '2026-08-03T00:00:00.000Z');
  await expectRejection(
    uow.commit(outOfRangeRun, '2026-08-03T00:01:00.000Z', '{"message":"before validFrom"}', {
      bars: [bar({ instrumentVersionId: ivId, sourceRecordKey: 'out-of-range-1', openedAt: '2026-07-01T00:00:00.000Z', closedAt: '2026-07-02T00:00:00.000Z', sourceAvailableAt: '2026-07-02T00:00:00.000Z' })],
    }),
    OpenedAtOutOfKnownRangeError,
    'openedAt before validFrom',
  );
  console.log('openedAt out of known business-time range: OK');
}

async function ohlcAndBigIntLimitTests(prisma: PrismaClient): Promise<void> {
  const ivId = await seedInstrumentVersion(prisma, 'OHLV3', 'B3', '2026-01-01T00:00:00.000Z', '2026-08-04T00:00:00.000Z', '2026-08-04T00:01:00.000Z');
  const uow = new PrismaMarketBarIngestionUnitOfWork(prisma);

  // high < low: invalid.
  const invalidOhlc = await uow.begin(SOURCE, '2026-08-05T00:00:00.000Z');
  await expectRejection(
    uow.commit(invalidOhlc, '2026-08-05T00:01:00.000Z', '{"message":"bad ohlc"}', {
      bars: [bar({ instrumentVersionId: ivId, sourceRecordKey: 'bad-ohlc-1', openedAt: '2026-01-02T00:00:00.000Z', closedAt: '2026-01-03T00:00:00.000Z', sourceAvailableAt: '2026-01-03T00:00:00.000Z', highRaw: BigInt(100), lowRaw: BigInt(200), openRaw: BigInt(150), closeRaw: BigInt(150) })],
    }),
    ZodError,
    'high < low',
  );

  // Non-positive price: invalid.
  const nonPositive = await uow.begin(SOURCE, '2026-08-05T01:00:00.000Z');
  await expectRejection(
    uow.commit(nonPositive, '2026-08-05T01:01:00.000Z', '{"message":"non-positive price"}', {
      bars: [bar({ instrumentVersionId: ivId, sourceRecordKey: 'non-positive-1', openedAt: '2026-01-04T00:00:00.000Z', closedAt: '2026-01-05T00:00:00.000Z', sourceAvailableAt: '2026-01-05T00:00:00.000Z', openRaw: BigInt(0) })],
    }),
    ZodError,
    'openRaw must be strictly positive',
  );

  // Negative volume: invalid.
  const negativeVolume = await uow.begin(SOURCE, '2026-08-05T02:00:00.000Z');
  await expectRejection(
    uow.commit(negativeVolume, '2026-08-05T02:01:00.000Z', '{"message":"negative volume"}', {
      bars: [bar({ instrumentVersionId: ivId, sourceRecordKey: 'negative-volume-1', openedAt: '2026-01-06T00:00:00.000Z', closedAt: '2026-01-07T00:00:00.000Z', sourceAvailableAt: '2026-01-07T00:00:00.000Z', volumeRaw: BigInt(-1) })],
    }),
    ZodError,
    'volumeRaw must be non-negative',
  );

  // BigInt above signed 64-bit max: invalid.
  const overMax = await uow.begin(SOURCE, '2026-08-05T03:00:00.000Z');
  await expectRejection(
    uow.commit(overMax, '2026-08-05T03:01:00.000Z', '{"message":"over max"}', {
      bars: [bar({ instrumentVersionId: ivId, sourceRecordKey: 'over-max-1', openedAt: '2026-01-08T00:00:00.000Z', closedAt: '2026-01-09T00:00:00.000Z', sourceAvailableAt: '2026-01-09T00:00:00.000Z', volumeRaw: BigInt('9223372036854775808') })],
    }),
    ZodError,
    'volumeRaw exceeding signed 64-bit max',
  );

  // Valid at the exact boundaries.
  const validRun = await uow.begin(SOURCE, '2026-08-05T04:00:00.000Z');
  const t = '2026-08-05T04:01:00.000Z';
  await uow.commit(validRun, t, '{"message":"valid boundaries"}', {
    bars: [
      bar({
        instrumentVersionId: ivId,
        sourceRecordKey: 'boundary-1',
        openedAt: '2026-01-10T00:00:00.000Z',
        closedAt: '2026-01-11T00:00:00.000Z',
        sourceAvailableAt: '2026-01-11T00:00:00.000Z',
        openRaw: BigInt(1),
        highRaw: BigInt('9223372036854775807'),
        lowRaw: BigInt(1),
        closeRaw: BigInt('9223372036854775807'),
        volumeRaw: BigInt('9223372036854775807'),
        tradeCount: BigInt('9223372036854775807'),
        priceScalePow: -18,
        volumeScalePow: 18,
      }),
    ],
  });
  const repo = new PrismaMarketBarRepository(prisma);
  const rows = await repo.findBars(ivId, SOURCE, '1d', '2026-01-09T00:00:00.000Z', '2026-01-12T00:00:00.000Z', { decisionTime: t, knowledgeTime: t });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].highRaw, BigInt('9223372036854775807'));
  assert.equal(rows[0].tradeCount, BigInt('9223372036854775807'));
  assert.equal(rows[0].priceScalePow, -18);
  assert.equal(rows[0].volumeScalePow, 18);

  const invalidScaleRun = await uow.begin(SOURCE, '2026-08-05T05:00:00.000Z');
  await expectRejection(
    uow.commit(invalidScaleRun, '2026-08-05T05:01:00.000Z', '{"message":"invalid scale"}', {
      bars: [bar({
        instrumentVersionId: ivId,
        sourceRecordKey: 'scale-outside-contract',
        openedAt: '2026-01-12T00:00:00.000Z',
        closedAt: '2026-01-13T00:00:00.000Z',
        sourceAvailableAt: '2026-01-13T00:00:00.000Z',
        priceScalePow: -19,
      })],
    }),
    ZodError,
    'priceScalePow outside the documented technical contract',
  );

  console.log('OHLC/BigInt limits: OK (cruzada OHLC, positividade, signed 64-bit e escalas -18..18)');
}

async function revisionChainTests(prisma: PrismaClient): Promise<void> {
  const ivId = await seedInstrumentVersion(prisma, 'REVV3', 'B3', '2026-01-01T00:00:00.000Z', '2026-08-06T00:00:00.000Z', '2026-08-06T00:01:00.000Z');
  const uow = new PrismaMarketBarIngestionUnitOfWork(prisma);
  const repo = new PrismaMarketBarRepository(prisma);

  const root = bar({ instrumentVersionId: ivId, sourceRecordKey: 'rev-root-1', openedAt: '2026-02-01T00:00:00.000Z', closedAt: '2026-02-02T00:00:00.000Z', sourceAvailableAt: '2026-02-02T00:00:00.000Z' });
  const run1 = await uow.begin(SOURCE, '2026-08-07T00:00:00.000Z');
  const t1 = '2026-08-07T00:01:00.000Z';
  await uow.commit(run1, t1, '{"message":"root"}', { bars: [root] });

  const beforeRevision = await repo.findBars(ivId, SOURCE, '1d', '2026-02-01T00:00:00.000Z', '2026-02-03T00:00:00.000Z', { decisionTime: t1, knowledgeTime: t1 });
  assert.equal(beforeRevision.length, 1);
  assert.equal(beforeRevision[0].revisionNumber, 1);

  const revision = bar({
    instrumentVersionId: ivId,
    sourceRecordKey: 'rev-child-1',
    openedAt: '2026-02-01T00:00:00.000Z',
    closedAt: '2026-02-02T00:00:00.000Z',
    sourceAvailableAt: '2026-02-03T00:00:00.000Z', // strictly after predecessor's
    quality: 'CORRECTED',
    isRevision: true,
    supersedesSourceRecordKey: 'rev-root-1',
  });
  const run2 = await uow.begin(SOURCE, '2026-08-08T00:00:00.000Z');
  const t2 = '2026-08-08T00:01:00.000Z'; // strictly after run1's completedAt
  await uow.commit(run2, t2, '{"message":"revision"}', { bars: [revision] });

  const afterRevision = await repo.findBars(ivId, SOURCE, '1d', '2026-02-01T00:00:00.000Z', '2026-02-03T00:00:00.000Z', { decisionTime: t2, knowledgeTime: t2 });
  assert.equal(afterRevision.length, 1, 'apenas a maior revisão visível deve aparecer por openedAt');
  assert.equal(afterRevision[0].revisionNumber, 2);
  assert.equal(afterRevision[0].quality, 'CORRECTED');

  // Future revision not yet visible under an earlier knowledgeTime never suppresses predecessor.
  const stillRoot = await repo.findBars(ivId, SOURCE, '1d', '2026-02-01T00:00:00.000Z', '2026-02-03T00:00:00.000Z', { decisionTime: t1, knowledgeTime: t1 });
  assert.equal(stillRoot.length, 1);
  assert.equal(stillRoot[0].revisionNumber, 1, 'revisão futura não pode vazar para view anterior');

  // Seed a second, unrelated root so the next test can reference it as a
  // deliberately-wrong predecessor (mismatched openedAt).
  const secondRootRun = await uow.begin(SOURCE, '2026-08-09T00:00:00.000Z');
  await uow.commit(secondRootRun, '2026-08-09T00:01:00.000Z', '{"message":"second root"}', {
    bars: [
      bar({ instrumentVersionId: ivId, sourceRecordKey: 'rev-root-2', openedAt: '2026-03-01T00:00:00.000Z', closedAt: '2026-03-02T00:00:00.000Z', sourceAvailableAt: '2026-03-02T00:00:00.000Z' }),
    ],
  });

  const mismatchedPredecessorRun = await uow.begin(SOURCE, '2026-08-09T01:00:00.000Z');
  await expectRejection(
    uow.commit(mismatchedPredecessorRun, '2026-08-09T01:01:00.000Z', '{"message":"mismatched predecessor"}', {
      bars: [
        bar({
          instrumentVersionId: ivId,
          sourceRecordKey: 'rev-child-mismatch',
          openedAt: '2026-03-05T00:00:00.000Z', // different from predecessor's openedAt
          closedAt: '2026-03-06T00:00:00.000Z',
          sourceAvailableAt: '2026-08-09T01:00:30.000Z',
          isRevision: true,
          supersedesSourceRecordKey: 'rev-root-1',
        }),
      ],
    }),
    BarChainViolationError,
    'revision predecessor mismatched openedAt/timeframe/instrumentVersionId',
  );

  // Unknown predecessor: fails closed.
  const unknownPredecessorRun = await uow.begin(SOURCE, '2026-08-09T02:00:00.000Z');
  await expectRejection(
    uow.commit(unknownPredecessorRun, '2026-08-09T02:01:00.000Z', '{"message":"unknown predecessor"}', {
      bars: [
        bar({
          instrumentVersionId: ivId,
          sourceRecordKey: 'rev-orphan-1',
          openedAt: '2026-04-01T00:00:00.000Z',
          closedAt: '2026-04-02T00:00:00.000Z',
          sourceAvailableAt: '2026-04-02T00:00:00.000Z',
          isRevision: true,
          supersedesSourceRecordKey: 'never-sent',
        }),
      ],
    }),
    UnknownPredecessorBarError,
    'revision referencing a non-existent predecessor',
  );

  // Predecessor already superseded by another revision: bifurcation conflict.
  const bifurcationRun = await uow.begin(SOURCE, '2026-08-10T00:00:00.000Z');
  await expectRejection(
    uow.commit(bifurcationRun, '2026-08-10T00:01:00.000Z', '{"message":"bifurcation"}', {
      bars: [
        bar({
          instrumentVersionId: ivId,
          sourceRecordKey: 'rev-child-2-bad',
          openedAt: '2026-02-01T00:00:00.000Z',
          closedAt: '2026-02-02T00:00:00.000Z',
          sourceAvailableAt: '2026-08-10T00:00:30.000Z',
          isRevision: true,
          supersedesSourceRecordKey: 'rev-root-1', // already superseded by rev-child-1
        }),
      ],
    }),
    PredecessorAlreadySupersededError,
    'predecessor already superseded by a different bar (bifurcation)',
  );

  // New root for an already-existing chain: chain violation.
  const newRootRun = await uow.begin(SOURCE, '2026-08-11T00:00:00.000Z');
  await expectRejection(
    uow.commit(newRootRun, '2026-08-11T00:01:00.000Z', '{"message":"duplicate root"}', {
      bars: [
        bar({ instrumentVersionId: ivId, sourceRecordKey: 'rev-root-1-duplicate', openedAt: '2026-02-01T00:00:00.000Z', closedAt: '2026-02-02T00:00:00.000Z', sourceAvailableAt: '2026-08-11T00:00:30.000Z' }),
      ],
    }),
    BarChainViolationError,
    'new root submitted for a chain that already exists',
  );

  console.log('revision chain: OK (visibilidade antes/depois, predecessor errado/desconhecido/já supersedido, novo root em cadeia existente)');
}

async function deepInBatchChainTests(prisma: PrismaClient): Promise<void> {
  const ivId = await seedInstrumentVersion(prisma, 'DEEPV3', 'B3', '2026-01-01T00:00:00.000Z', '2026-08-12T00:00:00.000Z', '2026-08-12T00:01:00.000Z');
  const uow = new PrismaMarketBarIngestionUnitOfWork(prisma);
  const repo = new PrismaMarketBarRepository(prisma);

  const base = {
    instrumentVersionId: ivId,
    openedAt: '2026-05-01T00:00:00.000Z',
    closedAt: '2026-05-02T00:00:00.000Z',
  };
  const v1 = bar({ ...base, sourceRecordKey: 'deep-v1', sourceAvailableAt: '2026-05-02T00:00:00.000Z' });
  const v2 = bar({ ...base, sourceRecordKey: 'deep-v2', sourceAvailableAt: '2026-05-03T00:00:00.000Z', isRevision: true, supersedesSourceRecordKey: 'deep-v1' });
  const v3 = bar({ ...base, sourceRecordKey: 'deep-v3', sourceAvailableAt: '2026-05-04T00:00:00.000Z', isRevision: true, supersedesSourceRecordKey: 'deep-v2' });
  const v4 = bar({ ...base, sourceRecordKey: 'deep-v4', sourceAvailableAt: '2026-05-05T00:00:00.000Z', isRevision: true, supersedesSourceRecordKey: 'deep-v3' });
  const v5 = bar({ ...base, sourceRecordKey: 'deep-v5', sourceAvailableAt: '2026-05-06T00:00:00.000Z', isRevision: true, supersedesSourceRecordKey: 'deep-v4' });

  // Submitted out of order in the raw array; the unit of work must still
  // process root-before-revision, never depending on array position. Each
  // revision's run.completedAt must be strictly increasing, so we submit
  // them one run at a time but shuffled within a single batch isn't
  // possible across separate runs — exercise shuffling for the in-batch part.
  const run1 = await uow.begin(SOURCE, '2026-08-13T00:00:00.000Z');
  const t1 = '2026-08-13T00:01:00.000Z';
  await uow.commit(run1, t1, '{"message":"deep chain shuffled"}', { bars: [v3, v1, v5, v2, v4] });

  const rows = await repo.findBars(ivId, SOURCE, '1d', '2026-05-01T00:00:00.000Z', '2026-05-02T00:00:00.001Z', { decisionTime: t1, knowledgeTime: t1 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].revisionNumber, 5);

  // Cycle detection: v6 supersedes v7 and v7 supersedes v6, both new in this batch.
  const cycleRun = await uow.begin(SOURCE, '2026-08-14T00:00:00.000Z');
  await expectRejection(
    uow.commit(cycleRun, '2026-08-14T00:01:00.000Z', '{"message":"cycle"}', {
      bars: [
        bar({ ...base, sourceRecordKey: 'cycle-a', sourceAvailableAt: '2026-08-14T00:00:00.000Z', isRevision: true, supersedesSourceRecordKey: 'cycle-b' }),
        bar({ ...base, sourceRecordKey: 'cycle-b', sourceAvailableAt: '2026-08-14T00:00:00.000Z', isRevision: true, supersedesSourceRecordKey: 'cycle-a' }),
      ],
    }),
    BarChainViolationError,
    'cycle detected within the same batch',
  );

  console.log('deep in-batch chain (5+): OK (ordenação topológica independente do input, ciclo detectado)');
}

async function idempotencyAndDuplicateTests(prisma: PrismaClient): Promise<void> {
  const ivId = await seedInstrumentVersion(prisma, 'IDEMV3', 'B3', '2026-01-01T00:00:00.000Z', '2026-08-15T00:00:00.000Z', '2026-08-15T00:01:00.000Z');
  const uow = new PrismaMarketBarIngestionUnitOfWork(prisma);

  const submission = bar({ instrumentVersionId: ivId, sourceRecordKey: 'idem-1', openedAt: '2026-06-01T00:00:00.000Z', closedAt: '2026-06-02T00:00:00.000Z', sourceAvailableAt: '2026-06-02T00:00:00.000Z' });
  const run1 = await uow.begin(SOURCE, '2026-08-16T00:00:00.000Z');
  await uow.commit(run1, '2026-08-16T00:01:00.000Z', '{"message":"first"}', { bars: [submission] });

  // Identical resubmission: no-op idempotent.
  const run2 = await uow.begin(SOURCE, '2026-08-16T01:00:00.000Z');
  await uow.commit(run2, '2026-08-16T01:01:00.000Z', '{"message":"idempotent resubmission"}', { bars: [submission] });
  assert.equal(await prisma.versionedMarketBar.count({ where: { sourceRecordKey: 'idem-1' } }), 1, 'reenvio idêntico não deve duplicar');

  // Divergent resubmission under same sourceRecordKey: conflict.
  const run3 = await uow.begin(SOURCE, '2026-08-16T02:00:00.000Z');
  await expectRejection(
    uow.commit(run3, '2026-08-16T02:01:00.000Z', '{"message":"divergent"}', {
      bars: [{ ...submission, volumeRaw: BigInt(999) }],
    }),
    BarConflictError,
    'same sourceRecordKey with divergent content',
  );

  // Duplicate sourceRecordKey within the same batch fails even if identical.
  const run4 = await uow.begin(SOURCE, '2026-08-16T03:00:00.000Z');
  await expectRejection(
    uow.commit(run4, '2026-08-16T03:01:00.000Z', '{"message":"in-batch duplicate"}', {
      bars: [
        bar({ instrumentVersionId: ivId, sourceRecordKey: 'in-batch-dup', openedAt: '2026-06-10T00:00:00.000Z', closedAt: '2026-06-11T00:00:00.000Z', sourceAvailableAt: '2026-06-11T00:00:00.000Z' }),
        bar({ instrumentVersionId: ivId, sourceRecordKey: 'in-batch-dup', openedAt: '2026-06-10T00:00:00.000Z', closedAt: '2026-06-11T00:00:00.000Z', sourceAvailableAt: '2026-06-11T00:00:00.000Z' }),
      ],
    }),
    DuplicateSourceRecordError,
    'duplicate sourceRecordKey within the same batch (identical payload)',
  );

  // Chain metadata is part of idempotent identity. Persist a root+revision,
  // then replay the revision payload while falsely declaring it as a root.
  const metadataRoot = bar({
    instrumentVersionId: ivId,
    sourceRecordKey: 'metadata-root',
    openedAt: '2026-06-20T00:00:00.000Z',
    closedAt: '2026-06-21T00:00:00.000Z',
    sourceAvailableAt: '2026-06-21T00:00:00.000Z',
  });
  const metadataRevision = bar({
    ...metadataRoot,
    sourceRecordKey: 'metadata-revision',
    sourceAvailableAt: '2026-06-22T00:00:00.000Z',
    quality: 'CORRECTED',
    isRevision: true,
    supersedesSourceRecordKey: 'metadata-root',
  });
  const metadataRun = await uow.begin(SOURCE, '2026-08-16T04:00:00.000Z');
  await uow.commit(metadataRun, '2026-08-16T04:01:00.000Z', '{"message":"metadata chain"}', {
    bars: [metadataRevision, metadataRoot],
  });
  const falseRootReplay = await uow.begin(SOURCE, '2026-08-16T05:00:00.000Z');
  await expectRejection(
    uow.commit(falseRootReplay, '2026-08-16T05:01:00.000Z', '{"message":"false root replay"}', {
      bars: [{ ...metadataRevision, isRevision: false, supersedesSourceRecordKey: null }],
    }),
    BarConflictError,
    'same sourceRecordKey/content with divergent revision metadata',
  );

  console.log('idempotency/duplicates: OK (conteúdo e identidade de cadeia integrais; duplicata no lote falha)');
}

async function sourceIsolationAndSqxRuleTests(prisma: PrismaClient): Promise<void> {
  const equityIvId = await seedInstrumentVersion(prisma, 'PETR4', 'B3', '2026-01-01T00:00:00.000Z', '2026-08-17T00:00:00.000Z', '2026-08-17T00:01:00.000Z');
  const winIvId = await seedInstrumentVersion(prisma, 'WINZ26', 'B3', '2026-01-01T00:00:00.000Z', '2026-08-17T01:00:00.000Z', '2026-08-17T01:01:00.000Z');
  const uow = new PrismaMarketBarIngestionUnitOfWork(prisma);
  const repo = new PrismaMarketBarRepository(prisma);

  // Two sources coexisting for the SAME instrument/timeframe/openedAt without merging.
  const openedAt = '2026-06-01T00:00:00.000Z';
  const closedAt = '2026-06-02T00:00:00.000Z';
  const runA = await uow.begin(SOURCE, '2026-08-18T00:00:00.000Z');
  const tA = '2026-08-18T00:01:00.000Z';
  await uow.commit(runA, tA, '{"message":"source A"}', {
    bars: [bar({ instrumentVersionId: equityIvId, sourceRecordKey: 'dual-source-a', openedAt, closedAt, sourceAvailableAt: closedAt, highRaw: BigInt(5000), closeRaw: BigInt(1111) })],
  });

  const runB = await uow.begin('b3:official', '2026-08-18T01:00:00.000Z');
  const tB = '2026-08-18T01:01:00.000Z';
  await uow.commit(runB, tB, '{"message":"source B"}', {
    bars: [bar({ instrumentVersionId: equityIvId, sourceRecordKey: 'dual-source-b', openedAt, closedAt, sourceAvailableAt: closedAt, highRaw: BigInt(5000), closeRaw: BigInt(2222) })],
  });

  const view = { decisionTime: tB, knowledgeTime: tB };
  const fromSourceA = await repo.findBars(equityIvId, SOURCE, '1d', '2026-05-31T00:00:00.000Z', '2026-06-03T00:00:00.000Z', view);
  const fromSourceB = await repo.findBars(equityIvId, 'b3:official', '1d', '2026-05-31T00:00:00.000Z', '2026-06-03T00:00:00.000Z', view);
  assert.equal(fromSourceA.length, 1);
  assert.equal(fromSourceA[0].closeRaw, BigInt(1111));
  assert.equal(fromSourceB.length, 1);
  assert.equal(fromSourceB[0].closeRaw, BigInt(2222));
  console.log('multi-source coexistence: OK (sourceKey obrigatório; sem fusão implícita entre fontes)');

  // SQX rule: sqx source with a non-WIN/WDO symbol fails closed.
  const sqxBadRun = await uow.begin(SQX_SOURCE, '2026-08-19T00:00:00.000Z');
  await expectRejection(
    uow.commit(sqxBadRun, '2026-08-19T00:01:00.000Z', '{"message":"sqx bad symbol"}', {
      bars: [bar({ instrumentVersionId: equityIvId, sourceRecordKey: 'sqx-bad-1', openedAt: '2026-06-05T00:00:00.000Z', closedAt: '2026-06-06T00:00:00.000Z', sourceAvailableAt: '2026-06-06T00:00:00.000Z' })],
    }),
    SourceSymbolRuleViolationError,
    'sqx source referencing a non-WIN/WDO symbol',
  );

  // SQX rule: sqx source with a WIN symbol succeeds.
  const sqxGoodRun = await uow.begin(SQX_SOURCE, '2026-08-19T01:00:00.000Z');
  const tGood = '2026-08-19T01:01:00.000Z';
  await uow.commit(sqxGoodRun, tGood, '{"message":"sqx good symbol"}', {
    bars: [bar({ instrumentVersionId: winIvId, sourceRecordKey: 'sqx-good-1', openedAt: '2026-06-05T00:00:00.000Z', closedAt: '2026-06-06T00:00:00.000Z', sourceAvailableAt: '2026-06-06T00:00:00.000Z' })],
  });
  const sqxRows = await repo.findBars(winIvId, SQX_SOURCE, '1d', '2026-06-04T00:00:00.000Z', '2026-06-07T00:00:00.000Z', { decisionTime: tGood, knowledgeTime: tGood });
  assert.equal(sqxRows.length, 1);
  console.log('SQX symbol rule: OK (sqx exige WIN/WDO; falha fechado ou sucesso conforme símbolo)');
}

async function pointInTimeAndFutureVisibilityTests(prisma: PrismaClient): Promise<void> {
  const ivId = await seedInstrumentVersion(prisma, 'PITV3', 'B3', '2026-01-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z', '2026-08-20T00:01:00.000Z');
  const uow = new PrismaMarketBarIngestionUnitOfWork(prisma);
  const repo = new PrismaMarketBarRepository(prisma);

  const submission = bar({
    instrumentVersionId: ivId,
    sourceRecordKey: 'pit-1',
    openedAt: '2026-07-01T00:00:00.000Z',
    closedAt: '2026-07-02T00:00:00.000Z',
    sourceAvailableAt: '2026-07-02T00:00:00.000Z',
  });
  const runId = await uow.begin(SOURCE, '2026-08-21T00:00:00.000Z');
  const completedAt = '2026-08-21T00:05:00.000Z';
  await uow.commit(runId, completedAt, '{"message":"pit"}', { bars: [submission] });

  // decisionTime after closedAt but knowledgeTime before the run completed: invisible.
  const notYetKnown = await repo.findBars(ivId, SOURCE, '1d', '2026-06-30T00:00:00.000Z', '2026-07-03T00:00:00.000Z', {
    decisionTime: '2026-08-21T12:00:00.000Z',
    knowledgeTime: '2026-08-21T00:04:59.999Z',
  });
  assert.equal(notYetKnown.length, 0, 'knowledgeTime anterior ao completedAt não pode ver a barra');

  // decisionTime before closedAt (even with knowledgeTime satisfied): invisible.
  const notYetClosed = await repo.findBars(ivId, SOURCE, '1d', '2026-06-30T00:00:00.000Z', '2026-07-03T00:00:00.000Z', {
    decisionTime: '2026-07-01T23:59:59.999Z',
    knowledgeTime: '2026-07-01T23:59:59.999Z',
  });
  assert.equal(notYetClosed.length, 0, 'decisionTime anterior a closedAt não pode ver a barra');

  // Both axes satisfied: visible.
  const visible = await repo.findBars(ivId, SOURCE, '1d', '2026-06-30T00:00:00.000Z', '2026-07-03T00:00:00.000Z', {
    decisionTime: completedAt,
    knowledgeTime: completedAt,
  });
  assert.equal(visible.length, 1);

  // Reject knowledgeTime > decisionTime outright.
  await assert.rejects(
    async () =>
      repo.findBars(ivId, SOURCE, '1d', '2026-06-30T00:00:00.000Z', '2026-07-03T00:00:00.000Z', {
        decisionTime: '2026-08-21T00:00:00.000Z',
        knowledgeTime: '2026-08-21T00:00:00.001Z',
      }),
    (error: unknown) => error instanceof ZodError,
    'knowledgeTime > decisionTime deve ser rejeitado',
  );

  await assert.rejects(
    async () =>
      repo.findBars(ivId, SOURCE, '1d', '2026-07-03T00:00:00.000Z', '2026-06-30T00:00:00.000Z', {
        decisionTime: completedAt,
        knowledgeTime: completedAt,
      }),
    (error: unknown) => error instanceof ZodError,
    'from >= to deve ser rejeitado, não tratado como resultado vazio',
  );

  console.log('point-in-time: OK (dois eixos independentes, range estrito e knowledgeTime <= decisionTime)');
}

async function timeframeAndExplicitClosedAtTests(prisma: PrismaClient): Promise<void> {
  const ivId = await seedInstrumentVersion(prisma, 'TFV3', 'B3', '2026-01-01T00:00:00.000Z', '2026-08-22T00:00:00.000Z', '2026-08-22T00:01:00.000Z');
  const uow = new PrismaMarketBarIngestionUnitOfWork(prisma);
  const repo = new PrismaMarketBarRepository(prisma);

  const dailyBar = bar({ instrumentVersionId: ivId, sourceRecordKey: 'daily-1', timeframe: '1d', openedAt: '2026-06-01T00:00:00.000Z', closedAt: '2026-06-02T00:00:00.000Z', sourceAvailableAt: '2026-06-02T00:00:00.000Z' });
  const weeklyBar = bar({ instrumentVersionId: ivId, sourceRecordKey: 'weekly-1', timeframe: '1w', openedAt: '2026-06-01T00:00:00.000Z', closedAt: '2026-06-08T00:00:00.000Z', sourceAvailableAt: '2026-06-08T00:00:00.000Z' });
  const offsetBar = bar({ instrumentVersionId: ivId, sourceRecordKey: 'offset-minus-three', timeframe: '1h', openedAt: '2026-06-10T09:00:00.000-03:00', closedAt: '2026-06-10T10:00:00.000-03:00', sourceAvailableAt: '2026-06-10T10:00:00.000-03:00' });
  const run = await uow.begin(SOURCE, '2026-08-23T00:00:00.000Z');
  const t = '2026-08-23T00:01:00.000Z';
  await uow.commit(run, t, '{"message":"daily+weekly+offset"}', { bars: [dailyBar, weeklyBar, offsetBar] });

  const dailyRows = await repo.findBars(ivId, SOURCE, '1d', '2026-05-31T00:00:00.000Z', '2026-06-03T00:00:00.000Z', { decisionTime: t, knowledgeTime: t });
  const weeklyRows = await repo.findBars(ivId, SOURCE, '1w', '2026-05-31T00:00:00.000Z', '2026-06-09T00:00:00.000Z', { decisionTime: t, knowledgeTime: t });
  const offsetRows = await repo.findBars(ivId, SOURCE, '1h', '2026-06-10T11:59:59.999Z', '2026-06-10T13:00:00.001Z', { decisionTime: t, knowledgeTime: t });
  assert.equal(dailyRows.length, 1);
  assert.equal(weeklyRows.length, 1);
  assert.equal(weeklyRows[0].closedAt, new Date(weeklyBar.closedAt).toISOString());
  assert.equal(offsetRows.length, 1);
  assert.equal(offsetRows[0].openedAt, '2026-06-10T12:00:00.000Z');
  assert.equal(offsetRows[0].closedAt, '2026-06-10T13:00:00.000Z');
  console.log('timeframes/offsets: OK (daily/weekly explícitos e -03:00 normalizado sem perda)');
}

async function fullRollbackTests(prisma: PrismaClient): Promise<void> {
  const ivId = await seedInstrumentVersion(prisma, 'ROLLV3', 'B3', '2026-01-01T00:00:00.000Z', '2026-08-24T00:00:00.000Z', '2026-08-24T00:01:00.000Z');
  const uow = new PrismaMarketBarIngestionUnitOfWork(prisma);

  // Seed an existing chain that will make the second item fail only after
  // the first item has already been inserted inside the same transaction.
  const seedRun = await uow.begin(SOURCE, '2026-08-25T00:00:00.000Z');
  await uow.commit(seedRun, '2026-08-25T00:01:00.000Z', '{"message":"seed conflict chain"}', {
    bars: [bar({
      instrumentVersionId: ivId,
      sourceRecordKey: 'rollback-existing-root',
      openedAt: '2026-07-10T00:00:00.000Z',
      closedAt: '2026-07-11T00:00:00.000Z',
      sourceAvailableAt: '2026-07-11T00:00:00.000Z',
    })],
  });

  const runId = await uow.begin(SOURCE, '2026-08-25T01:00:00.000Z');
  await expectRejection(
    uow.commit(runId, '2026-08-25T01:01:00.000Z', '{"message":"write then fail"}', {
      bars: [
        bar({
          instrumentVersionId: ivId,
          sourceRecordKey: 'a-rollback-valid-first',
          openedAt: '2026-07-01T00:00:00.000Z',
          closedAt: '2026-07-02T00:00:00.000Z',
          sourceAvailableAt: '2026-07-02T00:00:00.000Z',
        }),
        bar({
          instrumentVersionId: ivId,
          sourceRecordKey: 'z-rollback-conflicting-root',
          openedAt: '2026-07-10T00:00:00.000Z',
          closedAt: '2026-07-11T00:00:00.000Z',
          sourceAvailableAt: '2026-07-11T00:00:00.000Z',
        }),
      ],
    }),
    BarChainViolationError,
    'first insert followed by a conflicting root in the same transaction',
  );

  assert.equal(
    await prisma.versionedMarketBar.count({ where: { sourceRecordKey: 'a-rollback-valid-first' } }),
    0,
    'a primeira inserção deve ser revertida quando item posterior falha',
  );
  const runAfterFailure = await prisma.ingestionRun.findUnique({ where: { id: runId } });
  assert.equal(runAfterFailure?.status, 'RUNNING', 'falha no commit não pode transicionar a run');
  console.log('full rollback: OK (inserção efetiva é revertida quando item posterior falha)');
}

async function main(): Promise<void> {
  migrationAdditivityTests();
  const prisma = new PrismaClient();
  try {
    await runLifecycleTests(prisma);
    await unknownInstrumentAndRangeTests(prisma);
    await ohlcAndBigIntLimitTests(prisma);
    await revisionChainTests(prisma);
    await deepInBatchChainTests(prisma);
    await idempotencyAndDuplicateTests(prisma);
    await sourceIsolationAndSqxRuleTests(prisma);
    await pointInTimeAndFutureVisibilityTests(prisma);
    await timeframeAndExplicitClosedAtTests(prisma);
    await fullRollbackTests(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log('Fase 2 / Item 3 — MarketBar versionada point-in-time: TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
