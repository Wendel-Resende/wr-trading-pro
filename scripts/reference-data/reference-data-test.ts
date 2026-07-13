import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';
import {
  DuplicateCnpjError,
  InstrumentIntervalConflictError,
  InvalidReferenceDataInputError,
  IssuerIdentityConflictError,
  PrismaIngestionLedger,
  PrismaInstrumentRepository,
  PrismaIssuerRepository,
  PrismaReferenceDataIngestionUnitOfWork,
  RunChronologyError,
  RunNotRunningError,
  UnknownIssuerReferenceError,
} from '../../src/adapters/prisma/reference-data';
import type { ReferenceDataBatch } from '../../src/domain/v1/ports/reference-data-ingestion-unit-of-work';

const SOURCE = 'cvm:test-source';

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
    assert.ok(error instanceof ctor, `${label}: esperava ${ctor.name}, recebeu ${(error as Error)?.constructor?.name}: ${(error as Error)?.message}`);
  }
}

function migrationAdditivityTests(): void {
  const migrationPath = join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260712000000_add_reference_data_foundation',
    'migration.sql',
  );
  const sql = readFileSync(migrationPath, 'utf8');
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i, 'migração aditiva não pode conter ALTER TABLE');
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i, 'migração aditiva não pode conter DROP TABLE');
  assert.doesNotMatch(sql, /\bDROP\s+INDEX\b/i, 'migração aditiva não pode conter DROP INDEX');
  assert.match(sql, /CREATE TABLE "IngestionRun"/);
  assert.match(sql, /CREATE TABLE "Issuer"/);
  assert.match(sql, /CREATE TABLE "InstrumentVersion"/);
  assert.match(sql, /CREATE INDEX/);
  console.log('migration additivity: OK (somente CREATE TABLE/INDEX)');
}

async function runLifecycleTests(prisma: PrismaClient): Promise<void> {
  const uow = new PrismaReferenceDataIngestionUnitOfWork(prisma);
  const ledger = new PrismaIngestionLedger(prisma);

  const runId = await uow.begin(' CVM:Lifecycle ', '2026-07-12T12:00:00.000Z');
  const run = await ledger.getRun(runId);
  assert.ok(run);
  assert.equal(run?.sourceKey, 'cvm:lifecycle');
  assert.equal(run?.status, 'RUNNING');
  assert.equal(run?.completedAt, null);

  const emptyBatch: ReferenceDataBatch = { issuers: [], instrumentVersions: [] };
  await uow.commit(runId, '2026-07-12T12:05:00.000Z', '{"message":"ok"}', emptyBatch);
  const succeeded = await ledger.getRun(runId);
  assert.equal(succeeded?.status, 'SUCCEEDED');
  assert.equal(succeeded?.completedAt, '2026-07-12T12:05:00.000Z');

  await expectRejection(uow.commit(runId, '2026-07-12T12:06:00.000Z', '{"message":"again"}', emptyBatch), RunNotRunningError, 'commit on SUCCEEDED run');
  await expectRejection(uow.fail(runId, '2026-07-12T12:06:00.000Z', '{"message":"too late"}'), RunNotRunningError, 'fail on SUCCEEDED run');

  const failRunId = await uow.begin(SOURCE, '2026-07-12T12:10:00.000Z');
  await uow.fail(failRunId, '2026-07-12T12:11:00.000Z', '{"message":"boom"}');
  const failed = await ledger.getRun(failRunId);
  assert.equal(failed?.status, 'FAILED');
  await expectRejection(uow.commit(failRunId, '2026-07-12T12:12:00.000Z', '{"message":"nope"}', emptyBatch), RunNotRunningError, 'commit on FAILED run');

  const invalidSummaryRun = await uow.begin(SOURCE, '2026-07-12T12:20:00.000Z');
  for (const invalidSummary of ['not-json', 'null', '42', '[]', '"text"']) {
    await expectRejection(
      uow.commit(invalidSummaryRun, '2026-07-12T12:21:00.000Z', invalidSummary, emptyBatch),
      ZodError,
      `commit with invalid summary ${invalidSummary}`,
    );
  }

  const chronologyRun = await uow.begin(SOURCE, '2026-07-12T12:30:00.000Z');
  await expectRejection(
    uow.commit(chronologyRun, '2026-07-12T12:29:59.999Z', '{"message":"impossible"}', emptyBatch),
    RunChronologyError,
    'completedAt before startedAt',
  );
  await uow.commit(chronologyRun, '2026-07-12T12:30:00.000Z', '{"message":"equal is valid"}', emptyBatch);

  await expectRejection(
    uow.begin(SOURCE, '2026-07-12T12:40:00.000001Z'),
    InvalidReferenceDataInputError,
    'startedAt with sub-millisecond precision',
  );
  const precisionRun = await uow.begin(SOURCE, '2026-07-12T12:40:00.000Z');
  await expectRejection(
    uow.commit(precisionRun, '2026-07-12T12:40:00.000001Z', '{"message":"too precise"}', emptyBatch),
    InvalidReferenceDataInputError,
    'completedAt with sub-millisecond precision',
  );

  await expectRejection(uow.begin('', '2026-07-12T12:00:00.000Z'), ZodError, 'begin with empty sourceKey');
  await expectRejection(uow.begin(SOURCE, 'not-a-timestamp'), InvalidReferenceDataInputError, 'begin with invalid startedAt');
  console.log('run lifecycle: OK (RUNNING -> SUCCEEDED/FAILED guards fail closed)');
}

async function issuerIdentityTests(prisma: PrismaClient): Promise<void> {
  const uow = new PrismaReferenceDataIngestionUnitOfWork(prisma);
  const issuers = new PrismaIssuerRepository(prisma);

  const runId1 = await uow.begin(SOURCE, '2026-07-12T13:00:00.000Z');
  await uow.commit(runId1, '2026-07-12T13:01:00.000Z', '{"message":"issuer batch 1"}', {
    issuers: [
      { cvmCode: '0099', cnpj: '11.222.333/0001-81', name: 'Empresa Um' },
      { cvmCode: '100', cnpj: null, name: 'Empresa Dois' },
      { cvmCode: '101', cnpj: null, name: 'Empresa Tres' },
    ],
    instrumentVersions: [],
  });

  assert.equal(
    await issuers.getIssuerByCvmCode('99', { knowledgeTime: '2026-07-12T13:00:59.999Z' }),
    null,
    'issuer não pode ser visível antes do completedAt da run criadora',
  );
  const view = { knowledgeTime: '2026-07-12T13:01:00.000Z' };
  const one = await issuers.getIssuerByCvmCode('99', view);
  assert.ok(one, 'cvmCode normalizado deve remover zeros à esquerda (0099 -> 99)');
  assert.equal(one?.cnpj, '11222333000181');
  const withoutCnpj = await issuers.findIssuers(view);
  assert.equal(withoutCnpj.filter((issuer) => issuer.cnpj === null).length, 2, 'múltiplos cnpj null devem ser aceitos');

  const runId2 = await uow.begin(SOURCE, '2026-07-12T13:05:00.000Z');
  await uow.commit(runId2, '2026-07-12T13:06:00.000Z', '{"message":"idempotent resubmission"}', {
    issuers: [{ cvmCode: '99', cnpj: '11222333000181', name: 'Empresa Um' }],
    instrumentVersions: [],
  });
  const afterIdempotent = await issuers.findIssuers({ knowledgeTime: '2026-07-12T13:06:00.000Z' });
  assert.equal(afterIdempotent.filter((issuer) => issuer.cvmCode === '99').length, 1, 'resubmissão idêntica não deve duplicar');

  const conflictRunId = await uow.begin(SOURCE, '2026-07-12T13:10:00.000Z');
  await expectRejection(
    uow.commit(conflictRunId, '2026-07-12T13:11:00.000Z', '{"message":"conflict"}', {
      issuers: [{ cvmCode: '99', cnpj: '11222333000181', name: 'Nome Diferente' }],
      instrumentVersions: [],
    }),
    IssuerIdentityConflictError,
    'conflicting name for existing cvmCode',
  );
  const conflictRun = await new PrismaIngestionLedger(prisma).getRun(conflictRunId);
  assert.equal(conflictRun?.status, 'RUNNING', 'run deve permanecer RUNNING após rollback (nada foi commitado)');

  const dupCnpjRunId = await uow.begin(SOURCE, '2026-07-12T13:15:00.000Z');
  await expectRejection(
    uow.commit(dupCnpjRunId, '2026-07-12T13:16:00.000Z', '{"message":"dup cnpj"}', {
      issuers: [{ cvmCode: '999', cnpj: '11222333000181', name: 'Outra Empresa' }],
      instrumentVersions: [],
    }),
    DuplicateCnpjError,
    'cnpj already bound to a different cvmCode',
  );
  const unregistered = await issuers.getIssuerByCvmCode('999', { knowledgeTime: '2026-07-12T13:17:00.000Z' });
  assert.equal(unregistered, null, 'batch rejeitado não deve deixar issuer parcial');

  console.log('issuer identity: OK (fail-closed em conflito, idempotente em resubmissão idêntica, cnpj null múltiplo aceito)');
}

async function instrumentScd2Tests(prisma: PrismaClient): Promise<void> {
  const uow = new PrismaReferenceDataIngestionUnitOfWork(prisma);
  const instruments = new PrismaInstrumentRepository(prisma);
  const symbol = 'petr4';
  const exchange = ' b3 ';

  const run1 = await uow.begin(SOURCE, '2026-08-01T10:00:00.000Z');
  await uow.commit(run1, '2026-08-01T10:01:00.000Z', '{"message":"v1"}', {
    issuers: [],
    instrumentVersions: [
      {
        symbol,
        exchange,
        currency: 'brl',
        displayName: 'Petrobras PN',
        assetClass: 'equity',
        status: 'ACTIVE',
        priceScalePow: -2,
        quantityScalePow: 0,
        lotSize: 100,
        validFrom: '2026-01-01T00:00:00.000Z',
        validFromBasis: 'SOURCE_EFFECTIVE',
      },
    ],
  });

  const afterV1 = await instruments.findInstrumentVersions('PETR4', 'B3', { knowledgeTime: '2026-08-01T10:01:00.000Z' });
  assert.equal(afterV1.length, 1);
  assert.equal(afterV1[0].validTo, null);
  assert.equal(afterV1[0].symbol, 'PETR4');
  assert.equal(afterV1[0].exchange, 'B3');
  assert.equal(afterV1[0].currency, 'BRL');

  // Rejects a SOURCE_EFFECTIVE version without validFrom. The domain type
  // itself forbids this (discriminated union), so this exercises the runtime
  // Zod guard against an externally-sourced payload that bypasses TypeScript.
  const invalidRun = await uow.begin(SOURCE, '2026-08-01T10:02:00.000Z');
  const missingValidFromBatch = {
    issuers: [],
    instrumentVersions: [
      {
        symbol,
        exchange,
        currency: 'BRL',
        displayName: 'x',
        assetClass: 'equity',
        status: 'ACTIVE',
        validFromBasis: 'SOURCE_EFFECTIVE',
      },
    ],
  } as unknown as ReferenceDataBatch;
  await expectRejection(
    uow.commit(invalidRun, '2026-08-01T10:03:00.000Z', '{"message":"missing validFrom"}', missingValidFromBatch),
    ZodError,
    'SOURCE_EFFECTIVE version without validFrom',
  );

  // Rejects new validFrom at/before the currently open interval's validFrom.
  const beforeOpenRun = await uow.begin(SOURCE, '2026-08-01T10:04:00.000Z');
  await expectRejection(
    uow.commit(beforeOpenRun, '2026-08-01T10:05:00.000Z', '{"message":"before open"}', {
      issuers: [],
      instrumentVersions: [
        {
          symbol,
          exchange,
          currency: 'BRL',
          displayName: 'Petrobras PN',
          assetClass: 'equity',
          status: 'ACTIVE',
          validFrom: '2026-01-01T00:00:00.000Z',
          validFromBasis: 'SOURCE_EFFECTIVE',
        },
      ],
    }),
    InstrumentIntervalConflictError,
    'new validFrom equal to open interval validFrom',
  );

  // SCD-2: a later version closes the prior open interval exactly at its own validFrom.
  const run2 = await uow.begin(SOURCE, '2026-09-01T09:00:00.000Z');
  await uow.commit(run2, '2026-09-01T09:05:00.000Z', '{"message":"v2"}', {
    issuers: [],
    instrumentVersions: [
      {
        symbol,
        exchange,
        currency: 'BRL',
        displayName: 'Petrobras PN (novo lote)',
        assetClass: 'equity',
        status: 'ACTIVE',
        priceScalePow: -2,
        quantityScalePow: 0,
        lotSize: 100,
        validFrom: '2026-06-01T00:00:00.000Z',
        validFromBasis: 'SOURCE_EFFECTIVE',
      },
    ],
  });

  const fullyKnown = await instruments.findInstrumentVersions('PETR4', 'B3', { knowledgeTime: '2026-09-01T09:05:00.000Z' });
  assert.equal(fullyKnown.length, 2);
  const closed = fullyKnown.find((v) => v.validFrom === '2026-01-01T00:00:00.000Z');
  const open = fullyKnown.find((v) => v.validFrom === '2026-06-01T00:00:00.000Z');
  assert.equal(closed?.validTo, '2026-06-01T00:00:00.000Z');
  assert.equal(closed?.closedByRunId, run2);
  assert.equal(open?.validTo, null);

  // Duplicate validFrom is rejected (exact match on an existing row).
  const dupFromRun = await uow.begin(SOURCE, '2026-09-02T09:00:00.000Z');
  await expectRejection(
    uow.commit(dupFromRun, '2026-09-02T09:01:00.000Z', '{"message":"dup validFrom"}', {
      issuers: [],
      instrumentVersions: [
        {
          symbol,
          exchange,
          currency: 'BRL',
          displayName: 'x',
          assetClass: 'equity',
          status: 'ACTIVE',
          validFrom: '2026-01-01T00:00:00.000Z',
          validFromBasis: 'SOURCE_EFFECTIVE',
        },
      ],
    }),
    InstrumentIntervalConflictError,
    'duplicate validFrom for a closed interval',
  );

  // Overlap with a closed historical interval is rejected.
  const overlapRun = await uow.begin(SOURCE, '2026-09-02T09:02:00.000Z');
  await expectRejection(
    uow.commit(overlapRun, '2026-09-02T09:03:00.000Z', '{"message":"overlap"}', {
      issuers: [],
      instrumentVersions: [
        {
          symbol,
          exchange,
          currency: 'BRL',
          displayName: 'x',
          assetClass: 'equity',
          status: 'ACTIVE',
          validFrom: '2026-03-01T00:00:00.000Z',
          validFromBasis: 'SOURCE_EFFECTIVE',
        },
      ],
    }),
    InstrumentIntervalConflictError,
    'validFrom falling inside a closed historical interval',
  );

  // Exact boundary as-of reads: validFrom is inclusive, validTo is exclusive.
  const atOldStart = await instruments.findInstrumentVersions('PETR4', 'B3', {
    knowledgeTime: '2026-09-01T09:05:00.000Z',
    asOf: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(atOldStart.length, 1);
  assert.equal(atOldStart[0].validFrom, '2026-01-01T00:00:00.000Z');

  const atBoundaryExclusive = await instruments.findInstrumentVersions('PETR4', 'B3', {
    knowledgeTime: '2026-09-01T09:05:00.000Z',
    asOf: '2026-06-01T00:00:00.000Z',
  });
  assert.equal(atBoundaryExclusive.length, 1);
  assert.equal(atBoundaryExclusive[0].validFrom, '2026-06-01T00:00:00.000Z', 'validTo é exclusivo: asOf == validTo pertence à nova versão');

  const justBeforeBoundary = await instruments.findInstrumentVersions('PETR4', 'B3', {
    knowledgeTime: '2026-09-01T09:05:00.000Z',
    asOf: '2026-05-31T23:59:59.999Z',
  });
  assert.equal(justBeforeBoundary.length, 1);
  assert.equal(justBeforeBoundary[0].validFrom, '2026-01-01T00:00:00.000Z');

  console.log('instrument SCD-2: OK (fecha intervalo aberto exatamente no novo validFrom; rejeita duplicata/overlap/anterior-ao-aberto; fronteiras as-of corretas)');
}

async function observedAtDefaultTests(prisma: PrismaClient): Promise<void> {
  const uow = new PrismaReferenceDataIngestionUnitOfWork(prisma);
  const instruments = new PrismaInstrumentRepository(prisma);
  const runId = await uow.begin(SOURCE, '2026-07-15T00:00:00.000Z');
  const completedAt = '2026-07-15T00:03:00.000Z';
  await uow.commit(runId, completedAt, '{"message":"observed-at default"}', {
    issuers: [],
    instrumentVersions: [
      {
        symbol: 'MGLU3',
        exchange: 'B3',
        currency: 'BRL',
        displayName: 'Magazine Luiza ON',
        assetClass: 'equity',
        status: 'ACTIVE',
        validFromBasis: 'OBSERVED_AT',
      },
    ],
  });
  const versions = await instruments.findInstrumentVersions('MGLU3', 'B3', { knowledgeTime: completedAt });
  assert.equal(versions.length, 1);
  assert.equal(versions[0].validFrom, completedAt, 'OBSERVED_AT sem validFrom explícito deve usar o completedAt da run, nunca um relógio interno do domínio');
  assert.equal(versions[0].validFromBasis, 'OBSERVED_AT');
  console.log('OBSERVED_AT default: OK (validFrom conservador = completedAt da run)');
}

async function bitemporalVisibilityTests(prisma: PrismaClient): Promise<void> {
  const uow = new PrismaReferenceDataIngestionUnitOfWork(prisma);
  const instruments = new PrismaInstrumentRepository(prisma);
  const symbol = 'VALE3';
  const exchange = 'B3';

  const run1 = await uow.begin(SOURCE, '2026-10-01T08:00:00.000Z');
  const t1 = '2026-10-01T08:01:00.000Z';
  await uow.commit(run1, t1, '{"message":"v1"}', {
    issuers: [],
    instrumentVersions: [
      {
        symbol,
        exchange,
        currency: 'BRL',
        displayName: 'Vale ON',
        assetClass: 'equity',
        status: 'ACTIVE',
        validFrom: '2026-01-01T00:00:00.000Z',
        validFromBasis: 'SOURCE_EFFECTIVE',
      },
    ],
  });

  // knowledgeTime strictly before the creator run's completedAt: invisible.
  const beforeCreated = await instruments.findInstrumentVersions(symbol, exchange, { knowledgeTime: '2026-10-01T08:00:59.999Z' });
  assert.equal(beforeCreated.length, 0, 'run ainda não concluída não deve ser visível');

  // Inclusive boundary: knowledgeTime === completedAt is visible.
  const atCreated = await instruments.findInstrumentVersions(symbol, exchange, { knowledgeTime: t1 });
  assert.equal(atCreated.length, 1);
  assert.equal(atCreated[0].validTo, null);

  const run2 = await uow.begin(SOURCE, '2026-10-05T08:00:00.000Z');
  const t2 = '2026-10-05T08:05:00.000Z';
  const closeAt = '2026-06-01T00:00:00.000Z';
  await uow.commit(run2, t2, '{"message":"v2"}', {
    issuers: [],
    instrumentVersions: [
      {
        symbol,
        exchange,
        currency: 'BRL',
        displayName: 'Vale ON (novo lote)',
        assetClass: 'equity',
        status: 'ACTIVE',
        validFrom: closeAt,
        validFromBasis: 'SOURCE_EFFECTIVE',
      },
    ],
  });

  // The DB row for v1 now physically has validTo set and closedByRunId = run2,
  // committed atomically with run2.completedAt = t2. A knowledgeTime that
  // predates t2 (even though queried AFTER run2 has committed) must NOT see
  // that close: the interval must still read as open, and v2 must be
  // entirely invisible (its own creator run completed after that knowledgeTime).
  const betweenRuns = await instruments.findInstrumentVersions(symbol, exchange, { knowledgeTime: t1 });
  assert.equal(betweenRuns.length, 1, 'v2 não deve vazar para uma visão anterior à conclusão de run2');
  assert.equal(betweenRuns[0].validTo, null, 'um closedByRun posterior ao knowledgeTime não pode fechar o intervalo nessa visão');
  assert.equal(betweenRuns[0].closedByRunId, null, 'closedByRunId não pode vazar antes do knowledgeTime da run que fechou');

  const justBeforeT2 = await instruments.findInstrumentVersions(symbol, exchange, {
    knowledgeTime: '2026-10-05T08:04:59.999Z',
  });
  assert.equal(justBeforeT2.length, 1);
  assert.equal(justBeforeT2[0].validTo, null, 'um instante imediatamente anterior a completedAt de run2 ainda não deve ver o fechamento');

  // At/after t2, the close is fully visible.
  const atT2 = await instruments.findInstrumentVersions(symbol, exchange, { knowledgeTime: t2 });
  assert.equal(atT2.length, 2);
  const v1AtT2 = atT2.find((v) => v.validFrom === '2026-01-01T00:00:00.000Z');
  assert.equal(v1AtT2?.validTo, closeAt);
  assert.equal(v1AtT2?.closedByRunId, run2);

  console.log('bitemporal visibility: OK (closedByRun posterior nunca vaza para knowledgeTime anterior; limites inclusivos corretos)');
}

async function issuerReferenceIntegrityTests(prisma: PrismaClient): Promise<void> {
  const uow = new PrismaReferenceDataIngestionUnitOfWork(prisma);
  const instruments = new PrismaInstrumentRepository(prisma);

  const unknownRefRun = await uow.begin(SOURCE, '2026-11-01T00:00:00.000Z');
  await expectRejection(
    uow.commit(unknownRefRun, '2026-11-01T00:01:00.000Z', '{"message":"unknown issuer"}', {
      issuers: [],
      instrumentVersions: [
        {
          symbol: 'ITUB4',
          exchange: 'B3',
          currency: 'BRL',
          displayName: 'Itau PN',
          assetClass: 'equity',
          status: 'ACTIVE',
          validFrom: '2026-01-01T00:00:00.000Z',
          validFromBasis: 'SOURCE_EFFECTIVE',
          issuerCvmCode: '9999999',
        },
      ],
    }),
    UnknownIssuerReferenceError,
    'instrument referencing a non-existent issuer',
  );
  const orphanCheck = await instruments.findInstrumentVersions('ITUB4', 'B3', { knowledgeTime: '2026-11-01T00:01:00.000Z' });
  assert.equal(orphanCheck.length, 0, 'FK rejeitada não deve deixar linha órfã');

  // FK resolved within the same batch (issuer + instrument in one commit).
  const sameBatchRun = await uow.begin(SOURCE, '2026-11-02T00:00:00.000Z');
  await uow.commit(sameBatchRun, '2026-11-02T00:01:00.000Z', '{"message":"issuer + instrument together"}', {
    issuers: [{ cvmCode: '20000', cnpj: null, name: 'Itau Unibanco' }],
    instrumentVersions: [
      {
        symbol: 'ITUB4',
        exchange: 'B3',
        currency: 'BRL',
        displayName: 'Itau PN',
        assetClass: 'equity',
        status: 'ACTIVE',
        validFrom: '2026-01-01T00:00:00.000Z',
        validFromBasis: 'SOURCE_EFFECTIVE',
        issuerCvmCode: '20000',
      },
    ],
  });
  const resolved = await instruments.findInstrumentVersions('ITUB4', 'B3', { knowledgeTime: '2026-11-02T00:01:00.000Z' });
  assert.equal(resolved.length, 1);
  assert.ok(resolved[0].issuerId, 'issuerId deve ser resolvido quando o emissor está no mesmo lote');

  console.log('issuer FK integrity: OK (rejeita referência desconhecida sem deixar linha órfã; resolve referências dentro do mesmo lote)');
}

async function fullRollbackTests(prisma: PrismaClient): Promise<void> {
  const uow = new PrismaReferenceDataIngestionUnitOfWork(prisma);
  const instruments = new PrismaInstrumentRepository(prisma);
  const issuers = new PrismaIssuerRepository(prisma);

  const runId = await uow.begin(SOURCE, '2026-12-01T00:00:00.000Z');
  await expectRejection(
    uow.commit(runId, '2026-12-01T00:01:00.000Z', '{"message":"partial then fail"}', {
      issuers: [{ cvmCode: '30000', cnpj: null, name: 'Empresa Valida' }],
      instrumentVersions: [
        {
          symbol: 'VALID1',
          exchange: 'B3',
          currency: 'BRL',
          displayName: 'x',
          assetClass: 'equity',
          status: 'ACTIVE',
          validFrom: '2026-01-01T00:00:00.000Z',
          validFromBasis: 'SOURCE_EFFECTIVE',
          issuerCvmCode: '30000',
        },
        {
          symbol: 'INVALID2',
          exchange: 'B3',
          currency: 'BRL',
          displayName: 'x',
          assetClass: 'equity',
          status: 'ACTIVE',
          validFrom: '2026-01-01T00:00:00.000Z',
          validFromBasis: 'SOURCE_EFFECTIVE',
          issuerCvmCode: '999999999',
        },
      ],
    }),
    UnknownIssuerReferenceError,
    'batch with one valid and one invalid instrument version',
  );

  const orphanIssuer = await issuers.getIssuerByCvmCode('30000', { knowledgeTime: '2026-12-01T00:01:00.000Z' });
  assert.equal(orphanIssuer, null, 'nenhuma linha de issuer deve sobreviver a um rollback, mesmo se válida isoladamente');
  const orphanInstrument = await instruments.findInstrumentVersions('VALID1', 'B3', { knowledgeTime: '2026-12-01T00:01:00.000Z' });
  assert.equal(orphanInstrument.length, 0, 'nenhuma linha de instrumento válida deve sobreviver a um rollback do lote');

  console.log('full rollback: OK (lote inteiro reverte quando qualquer item falha; nenhuma linha parcial)');
}

async function deterministicBatchAndLateHistoryTests(prisma: PrismaClient): Promise<void> {
  const uow = new PrismaReferenceDataIngestionUnitOfWork(prisma);
  const instruments = new PrismaInstrumentRepository(prisma);
  const makeVersion = (validFrom: string, displayName: string) => ({
    symbol: 'CHAIN3', exchange: 'B3', currency: 'BRL', displayName,
    assetClass: 'equity' as const, status: 'ACTIVE' as const,
    validFrom, validFromBasis: 'SOURCE_EFFECTIVE' as const,
  });

  const chainRun = await uow.begin(SOURCE, '2027-01-01T00:00:00.000Z');
  await uow.commit(chainRun, '2027-01-01T00:01:00.000Z', '{"message":"unordered chain"}', {
    issuers: [],
    instrumentVersions: [
      makeVersion('2022-01-01T00:00:00.000Z', 'v3'),
      makeVersion('2020-01-01T00:00:00.000Z', 'v1'),
      makeVersion('2021-01-01T00:00:00.000Z', 'v2'),
    ],
  });
  const chain = await instruments.findInstrumentVersions('CHAIN3', 'B3', { knowledgeTime: '2027-01-01T00:01:00.000Z' });
  assert.deepEqual(chain.map((v) => [v.validFrom, v.validTo]), [
    ['2020-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z'],
    ['2021-01-01T00:00:00.000Z', '2022-01-01T00:00:00.000Z'],
    ['2022-01-01T00:00:00.000Z', null],
  ], 'lote desordenado deve produzir cadeia cronológica determinística');

  const duplicateRun = await uow.begin(SOURCE, '2027-01-02T00:00:00.000Z');
  await expectRejection(
    uow.commit(duplicateRun, '2027-01-02T00:01:00.000Z', '{"message":"duplicate"}', {
      issuers: [],
      instrumentVersions: [
        { ...makeVersion('2020-01-01T00:00:00.000Z', 'dup-a'), symbol: 'DUPL3' },
        { ...makeVersion('2020-01-01T00:00:00.000Z', 'dup-b'), symbol: 'DUPL3' },
      ],
    }),
    InstrumentIntervalConflictError,
    'duplicate validFrom within one batch',
  );
  assert.equal((await instruments.findInstrumentVersions('DUPL3', 'B3', { knowledgeTime: '2027-01-02T00:01:00.000Z' })).length, 0,
    'duplicata deve reverter o lote inteiro');

  const lateRun = await uow.begin(SOURCE, '2027-01-03T00:00:00.000Z');
  await expectRejection(
    uow.commit(lateRun, '2027-01-03T00:01:00.000Z', '{"message":"late history"}', {
      issuers: [], instrumentVersions: [makeVersion('2019-01-01T00:00:00.000Z', 'late')],
    }),
    InstrumentIntervalConflictError,
    'late-arriving history must fail closed until chain reconstruction exists',
  );
  console.log('deterministic batch: OK (ordenação canônica, duplicata rollback e late history fail-closed)');
}

async function main(): Promise<void> {
  migrationAdditivityTests();
  const prisma = new PrismaClient();
  try {
    await runLifecycleTests(prisma);
    await issuerIdentityTests(prisma);
    await instrumentScd2Tests(prisma);
    await observedAtDefaultTests(prisma);
    await bitemporalVisibilityTests(prisma);
    await issuerReferenceIntegrityTests(prisma);
    await fullRollbackTests(prisma);
    await deterministicBatchAndLateHistoryTests(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log('Fase 2 / Item 1 — fundação de dados de referência: TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
