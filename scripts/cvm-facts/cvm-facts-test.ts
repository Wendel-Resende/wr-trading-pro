import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';
import {
  DuplicateFactError,
  DuplicateShareCapitalFactError,
  FilingChainViolationError,
  FilingProtocolConflictError,
  InvalidCvmInputError,
  PredecessorAlreadySupersededError,
  PrismaCvmFactRepository,
  PrismaCvmFilingRepository,
  PrismaCvmIngestionUnitOfWork,
  PrismaShareCapitalFactRepository,
  RunChronologyError,
  RunNotRunningError,
  UnknownFilingReferenceError,
  UnknownIssuerReferenceError,
  UnknownPredecessorFilingError,
} from '../../src/adapters/prisma/cvm';
import { PrismaIngestionLedger, PrismaReferenceDataIngestionUnitOfWork } from '../../src/adapters/prisma/reference-data';
import type { CvmIngestionBatch } from '../../src/domain/v1/ports/cvm-ingestion-unit-of-work';

const SOURCE = 'cvm:facts-test-source';

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

const emptyBatch: CvmIngestionBatch = { filings: [], facts: [], shareCapitalFacts: [] };

function migrationAdditivityTests(): void {
  const migrationPath = join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260713000000_add_cvm_facts_foundation',
    'migration.sql',
  );
  const sql = readFileSync(migrationPath, 'utf8');
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i, 'migração aditiva não pode conter ALTER TABLE');
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i, 'migração aditiva não pode conter DROP TABLE');
  assert.doesNotMatch(sql, /\bDROP\s+INDEX\b/i, 'migração aditiva não pode conter DROP INDEX');
  assert.match(sql, /CREATE TABLE "CvmFiling"/);
  assert.match(sql, /CREATE TABLE "CvmFact"/);
  assert.match(sql, /CREATE TABLE "ShareCapitalFact"/);
  assert.match(sql, /CREATE UNIQUE INDEX "CvmFiling_supersedesFilingId_key"/);
  assert.match(sql, /CREATE UNIQUE INDEX "CvmFiling_issuerId_documentType_referenceDate_versionNumber_key"/);
  assert.match(sql, /CREATE INDEX/);
  console.log('migration additivity: OK (somente CREATE TABLE/INDEX)');
}

/** Helper: creates an Issuer via the reference-data foundation (the CVM batch itself never creates issuers). */
async function seedIssuer(prisma: PrismaClient, cvmCode: string, name: string, startedAt: string, completedAt: string): Promise<void> {
  const refUow = new PrismaReferenceDataIngestionUnitOfWork(prisma);
  const runId = await refUow.begin(SOURCE, startedAt);
  await refUow.commit(runId, completedAt, '{"message":"seed issuer"}', {
    issuers: [{ cvmCode, cnpj: null, name }],
    instrumentVersions: [],
  });
}

async function runLifecycleTests(prisma: PrismaClient): Promise<void> {
  const uow = new PrismaCvmIngestionUnitOfWork(prisma);
  const ledger = new PrismaIngestionLedger(prisma);

  const runId = await uow.begin(' CVM:Lifecycle ', '2026-07-13T12:00:00.000Z');
  const run = await ledger.getRun(runId);
  assert.ok(run);
  assert.equal(run?.sourceKey, 'cvm:lifecycle');
  assert.equal(run?.status, 'RUNNING');

  await uow.commit(runId, '2026-07-13T12:05:00.000Z', '{"message":"ok"}', emptyBatch);
  const succeeded = await ledger.getRun(runId);
  assert.equal(succeeded?.status, 'SUCCEEDED');

  await expectRejection(uow.commit(runId, '2026-07-13T12:06:00.000Z', '{"message":"again"}', emptyBatch), RunNotRunningError, 'commit on SUCCEEDED run');
  await expectRejection(uow.fail(runId, '2026-07-13T12:06:00.000Z', '{"message":"too late"}'), RunNotRunningError, 'fail on SUCCEEDED run');

  const failRunId = await uow.begin(SOURCE, '2026-07-13T12:10:00.000Z');
  await uow.fail(failRunId, '2026-07-13T12:11:00.000Z', '{"message":"boom"}');
  const failed = await ledger.getRun(failRunId);
  assert.equal(failed?.status, 'FAILED');
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

async function unknownIssuerTests(prisma: PrismaClient): Promise<void> {
  const uow = new PrismaCvmIngestionUnitOfWork(prisma);
  const filings = new PrismaCvmFilingRepository(prisma);

  const runId = await uow.begin(SOURCE, '2026-07-14T00:00:00.000Z');
  await expectRejection(
    uow.commit(runId, '2026-07-14T00:01:00.000Z', '{"message":"unknown issuer"}', {
      filings: [
        {
          issuerCvmCode: '999999',
          documentType: 'DFP',
          cvmProtocol: 'PROTO-UNKNOWN-1',
          referenceDate: '2025-12-31',
          fiscalYear: 2025,
          fiscalQuarter: null,
          filedAt: '2026-03-01T00:00:00.000Z',
          publishedAt: '2026-03-02T00:00:00.000Z',
          isRestatement: false,
          sourceUrl: 'https://cvm.example/proto-unknown-1',
          rawSha256: 'a'.repeat(64),
        },
      ],
      facts: [],
      shareCapitalFacts: [],
    }),
    UnknownIssuerReferenceError,
    'filing referencing an unknown issuer',
  );
  const orphan = await filings.getFilingByCvmProtocol('PROTO-UNKNOWN-1', {
    decisionTime: '2026-07-14T00:01:00.000Z',
    knowledgeTime: '2026-07-14T00:01:00.000Z',
  });
  assert.equal(orphan, null, 'filing rejeitado por issuer desconhecido não deve deixar linha órfã');
  console.log('unknown issuer: OK (batch CVM nunca cria Issuer; referência desconhecida falha fechado)');
}

async function filingChronologyTests(prisma: PrismaClient): Promise<void> {
  await seedIssuer(prisma, '50009', 'Empresa Theta', '2026-07-13T20:00:00.000Z', '2026-07-13T20:01:00.000Z');
  const uow = new PrismaCvmIngestionUnitOfWork(prisma);

  const runId = await uow.begin(SOURCE, '2026-07-13T21:00:00.000Z');
  await expectRejection(
    uow.commit(runId, '2026-07-13T21:01:00.000Z', '{"message":"filedAt after publishedAt"}', {
      filings: [
        {
          issuerCvmCode: '50009',
          documentType: 'DFP',
          cvmProtocol: 'PROTO-THETA-BAD-CHRONOLOGY',
          referenceDate: '2025-12-31',
          fiscalYear: 2025,
          fiscalQuarter: null,
          filedAt: '2026-03-05T00:00:00.000Z',
          publishedAt: '2026-03-01T00:00:00.000Z', // before filedAt: impossible
          isRestatement: false,
          sourceUrl: 'https://cvm.example/theta-bad',
          rawSha256: 'a1'.padEnd(64, '0'),
        },
      ],
      facts: [],
      shareCapitalFacts: [],
    }),
    InvalidCvmInputError,
    'filedAt after publishedAt must fail closed',
  );
  console.log('filing chronology: OK (filedAt <= publishedAt exigido)');
}

async function protocolIdempotencyAndConflictTests(prisma: PrismaClient): Promise<void> {
  await seedIssuer(prisma, '50001', 'Empresa Alfa', '2026-07-15T00:00:00.000Z', '2026-07-15T00:01:00.000Z');
  const uow = new PrismaCvmIngestionUnitOfWork(prisma);
  const filings = new PrismaCvmFilingRepository(prisma);

  const filing = {
    issuerCvmCode: '50001',
    documentType: 'DFP' as const,
    cvmProtocol: 'PROTO-ALFA-2025-DFP',
    referenceDate: '2025-12-31',
    fiscalYear: 2025,
    fiscalQuarter: null,
    filedAt: '2026-03-01T00:00:00.000Z',
    publishedAt: '2026-03-02T00:00:00.000Z',
    isRestatement: false,
    sourceUrl: 'https://cvm.example/proto-alfa-2025-dfp',
    rawSha256: 'b'.repeat(64),
  };

  const run1 = await uow.begin(SOURCE, '2026-07-15T01:00:00.000Z');
  const t1 = '2026-07-15T01:01:00.000Z';
  await uow.commit(run1, t1, '{"message":"first submission"}', { filings: [filing], facts: [], shareCapitalFacts: [] });

  const view1 = { decisionTime: t1, knowledgeTime: t1 };
  const stored = await filings.getFilingByCvmProtocol(filing.cvmProtocol, view1);
  assert.ok(stored);
  assert.equal(stored?.versionNumber, 1);
  assert.equal(stored?.isRestatement, false);

  // Idempotent resubmission: identical content is a no-op (no new row, no conflict).
  const run2 = await uow.begin(SOURCE, '2026-07-15T01:05:00.000Z');
  const t2 = '2026-07-15T01:06:00.000Z';
  await uow.commit(run2, t2, '{"message":"idempotent resubmission"}', { filings: [filing], facts: [], shareCapitalFacts: [] });
  const afterResubmission = await filings.findFilingChain(stored!.issuerId, 'DFP', '2025-12-31', { decisionTime: t2, knowledgeTime: t2 });
  assert.equal(afterResubmission.length, 1, 'resubmissão idêntica não deve duplicar');

  // Same protocol, divergent content (different hash): fails closed.
  const run3 = await uow.begin(SOURCE, '2026-07-15T01:10:00.000Z');
  await expectRejection(
    uow.commit(run3, '2026-07-15T01:11:00.000Z', '{"message":"diverging hash"}', {
      filings: [{ ...filing, rawSha256: 'c'.repeat(64) }],
      facts: [],
      shareCapitalFacts: [],
    }),
    FilingProtocolConflictError,
    'same protocol with divergent rawSha256',
  );

  // Same protocol, divergent sourceUrl: also fails closed.
  const run4 = await uow.begin(SOURCE, '2026-07-15T01:15:00.000Z');
  await expectRejection(
    uow.commit(run4, '2026-07-15T01:16:00.000Z', '{"message":"diverging url"}', {
      filings: [{ ...filing, sourceUrl: 'https://cvm.example/different' }],
      facts: [],
      shareCapitalFacts: [],
    }),
    FilingProtocolConflictError,
    'same protocol with divergent sourceUrl',
  );

  console.log('protocol idempotency/conflict: OK (reenvio idêntico é no-op; qualquer divergência falha fechado)');
}

async function restatementChainTests(prisma: PrismaClient): Promise<void> {
  await seedIssuer(prisma, '50002', 'Empresa Beta', '2026-07-16T00:00:00.000Z', '2026-07-16T00:01:00.000Z');
  const uow = new PrismaCvmIngestionUnitOfWork(prisma);
  const filings = new PrismaCvmFilingRepository(prisma);

  const v1 = {
    issuerCvmCode: '50002',
    documentType: 'ITR' as const,
    cvmProtocol: 'PROTO-BETA-2026Q1-V1',
    referenceDate: '2026-03-31',
    fiscalYear: 2026,
    fiscalQuarter: 1,
    filedAt: '2026-04-15T00:00:00.000Z',
    publishedAt: '2026-04-16T00:00:00.000Z',
    isRestatement: false,
    sourceUrl: 'https://cvm.example/beta-2026q1-v1',
    rawSha256: 'd'.repeat(64),
  };
  const run1 = await uow.begin(SOURCE, '2026-07-16T01:00:00.000Z');
  const t1 = '2026-07-16T01:01:00.000Z';
  await uow.commit(run1, t1, '{"message":"v1"}', { filings: [v1], facts: [], shareCapitalFacts: [] });

  const v1Row = await filings.getFilingByCvmProtocol(v1.cvmProtocol, { decisionTime: t1, knowledgeTime: t1 });
  assert.ok(v1Row);

  // Visibility BEFORE the restatement exists: effective filing is v1.
  const beforeRestatement = await filings.findEffectiveFiling(v1Row!.issuerId, 'ITR', '2026-03-31', {
    decisionTime: t1,
    knowledgeTime: t1,
  });
  assert.equal(beforeRestatement?.cvmProtocol, v1.cvmProtocol);
  assert.equal(beforeRestatement?.versionNumber, 1);

  const restatement = {
    issuerCvmCode: '50002',
    documentType: 'ITR' as const,
    cvmProtocol: 'PROTO-BETA-2026Q1-V2',
    referenceDate: '2026-03-31',
    fiscalYear: 2026,
    fiscalQuarter: 1,
    filedAt: '2026-05-01T00:00:00.000Z',
    publishedAt: '2026-05-02T00:00:00.000Z',
    isRestatement: true,
    supersedesCvmProtocol: v1.cvmProtocol,
    sourceUrl: 'https://cvm.example/beta-2026q1-v2',
    rawSha256: 'e'.repeat(64),
  };
  const run2 = await uow.begin(SOURCE, '2026-07-17T00:00:00.000Z');
  const t2 = '2026-07-17T00:01:00.000Z';
  await uow.commit(run2, t2, '{"message":"restatement"}', { filings: [restatement], facts: [], shareCapitalFacts: [] });

  const v2Row = await filings.getFilingByCvmProtocol(restatement.cvmProtocol, { decisionTime: t2, knowledgeTime: t2 });
  assert.equal(v2Row?.versionNumber, 2);
  assert.equal(v2Row?.supersedesFilingId, v1Row?.id);

  // Visibility AFTER the restatement: effective filing is v2, but the chain preserves v1.
  const afterRestatement = await filings.findEffectiveFiling(v1Row!.issuerId, 'ITR', '2026-03-31', {
    decisionTime: t2,
    knowledgeTime: t2,
  });
  assert.equal(afterRestatement?.versionNumber, 2);
  const fullChain = await filings.findFilingChain(v1Row!.issuerId, 'ITR', '2026-03-31', { decisionTime: t2, knowledgeTime: t2 });
  assert.equal(fullChain.length, 2, 'a cadeia preserva todas as versões');

  // A restatement not yet visible under an earlier view never suppresses its predecessor.
  const stillOnlyV1 = await filings.findEffectiveFiling(v1Row!.issuerId, 'ITR', '2026-03-31', {
    decisionTime: t1,
    knowledgeTime: t1,
  });
  assert.equal(stillOnlyV1?.versionNumber, 1, 'restatement futura não pode vazar para view anterior');

  // A restatement must become public strictly after its predecessor.
  const samePublicationRun = await uow.begin(SOURCE, '2026-07-17T01:00:00.000Z');
  await expectRejection(
    uow.commit(samePublicationRun, '2026-07-17T01:01:00.000Z', '{"message":"same publication instant"}', {
      filings: [{
        ...restatement,
        cvmProtocol: 'PROTO-BETA-2026Q1-V3-SAME-TIME',
        supersedesCvmProtocol: restatement.cvmProtocol,
        filedAt: restatement.publishedAt,
        publishedAt: restatement.publishedAt,
        sourceUrl: 'https://cvm.example/beta-v3-same-time',
        rawSha256: '0'.repeat(64),
      }],
      facts: [],
      shareCapitalFacts: [],
    }),
    FilingChainViolationError,
    'restatement publishedAt equal to predecessor',
  );

  // Unknown predecessor: fails closed.
  const run3 = await uow.begin(SOURCE, '2026-07-18T00:00:00.000Z');
  await expectRejection(
    uow.commit(run3, '2026-07-18T00:01:00.000Z', '{"message":"unknown predecessor"}', {
      filings: [
        {
          issuerCvmCode: '50002',
          documentType: 'ITR',
          cvmProtocol: 'PROTO-BETA-ORPHAN',
          referenceDate: '2026-06-30',
          fiscalYear: 2026,
          fiscalQuarter: 2,
          filedAt: '2026-07-15T00:00:00.000Z',
          publishedAt: '2026-07-16T00:00:00.000Z',
          isRestatement: true,
          supersedesCvmProtocol: 'PROTO-DOES-NOT-EXIST',
          sourceUrl: 'https://cvm.example/orphan',
          rawSha256: 'f'.repeat(64),
        },
      ],
      facts: [],
      shareCapitalFacts: [],
    }),
    UnknownPredecessorFilingError,
    'restatement referencing a non-existent predecessor',
  );

  // Predecessor already superseded by another document: conflict.
  const run4 = await uow.begin(SOURCE, '2026-07-19T00:00:00.000Z');
  await expectRejection(
    uow.commit(run4, '2026-07-19T00:01:00.000Z', '{"message":"double supersede"}', {
      filings: [
        {
          issuerCvmCode: '50002',
          documentType: 'ITR',
          cvmProtocol: 'PROTO-BETA-2026Q1-V3-BAD',
          referenceDate: '2026-03-31',
          fiscalYear: 2026,
          fiscalQuarter: 1,
          filedAt: '2026-05-10T00:00:00.000Z',
          publishedAt: '2026-05-11T00:00:00.000Z',
          isRestatement: true,
          supersedesCvmProtocol: v1.cvmProtocol,
          sourceUrl: 'https://cvm.example/double-supersede',
          rawSha256: '1'.repeat(64),
        },
      ],
      facts: [],
      shareCapitalFacts: [],
    }),
    PredecessorAlreadySupersededError,
    'predecessor already superseded by a different filing',
  );

  // Late/out-of-order restatement (predecessor missing entirely, distinct chain): fails closed, no reconciliation.
  const run5 = await uow.begin(SOURCE, '2026-07-20T00:00:00.000Z');
  await expectRejection(
    uow.commit(run5, '2026-07-20T00:01:00.000Z', '{"message":"late restatement, no predecessor"}', {
      filings: [
        {
          issuerCvmCode: '50002',
          documentType: 'DFP',
          cvmProtocol: 'PROTO-BETA-LATE-RESTATEMENT',
          referenceDate: '2025-12-31',
          fiscalYear: 2025,
          fiscalQuarter: null,
          filedAt: '2026-06-01T00:00:00.000Z',
          publishedAt: '2026-06-02T00:00:00.000Z',
          isRestatement: true,
          supersedesCvmProtocol: 'PROTO-BETA-DFP-2025-V1-NEVER-SENT',
          sourceUrl: 'https://cvm.example/late',
          rawSha256: '2'.repeat(64),
        },
      ],
      facts: [],
      shareCapitalFacts: [],
    }),
    UnknownPredecessorFilingError,
    'late-arriving restatement must fail closed until predecessor exists',
  );

  // Non-restatement submitted against a chain that already has a first version: chain violation.
  const run6 = await uow.begin(SOURCE, '2026-07-21T00:00:00.000Z');
  await expectRejection(
    uow.commit(run6, '2026-07-21T00:01:00.000Z', '{"message":"duplicate first version"}', {
      filings: [
        {
          issuerCvmCode: '50002',
          documentType: 'ITR',
          cvmProtocol: 'PROTO-BETA-2026Q1-DUPLICATE-FIRST',
          referenceDate: '2026-03-31',
          fiscalYear: 2026,
          fiscalQuarter: 1,
          filedAt: '2026-04-20T00:00:00.000Z',
          publishedAt: '2026-04-21T00:00:00.000Z',
          isRestatement: false,
          sourceUrl: 'https://cvm.example/duplicate-first',
          rawSha256: '3'.repeat(64),
        },
      ],
      facts: [],
      shareCapitalFacts: [],
    }),
    FilingChainViolationError,
    'non-restatement submitted when the chain already has a first version',
  );

  console.log('restatement chain: OK (visibilidade antes/depois, predecessor desconhecido, já supersedido, late history, primeira versão duplicada)');
}

async function publishedAtVsKnowledgeTimeTests(prisma: PrismaClient): Promise<void> {
  await seedIssuer(prisma, '50003', 'Empresa Gama', '2026-07-22T00:00:00.000Z', '2026-07-22T00:01:00.000Z');
  const uow = new PrismaCvmIngestionUnitOfWork(prisma);
  const filings = new PrismaCvmFilingRepository(prisma);

  // publishedAt is deliberately far in the past relative to the ingestion run,
  // simulating a document whose public availability long predates when the
  // platform got around to ingesting it. Both axes must be honored independently.
  const filing = {
    issuerCvmCode: '50003',
    documentType: 'DFP' as const,
    cvmProtocol: 'PROTO-GAMA-2025-DFP',
    referenceDate: '2025-12-31',
    fiscalYear: 2025,
    fiscalQuarter: null,
    filedAt: '2026-01-10T00:00:00.000Z',
    publishedAt: '2026-01-15T00:00:00.000Z', // market availability
    isRestatement: false,
    sourceUrl: 'https://cvm.example/gama-2025-dfp',
    rawSha256: '4'.repeat(64),
  };
  const runId = await uow.begin(SOURCE, '2026-08-01T00:00:00.000Z');
  const completedAt = '2026-08-01T00:05:00.000Z'; // knowledgeTime: ingested much later
  await uow.commit(runId, completedAt, '{"message":"gama"}', { filings: [filing], facts: [], shareCapitalFacts: [] });

  // decisionTime after publishedAt but knowledgeTime before the run completed: invisible (platform didn't know yet).
  const notYetKnown = await filings.getFilingByCvmProtocol(filing.cvmProtocol, {
    decisionTime: '2026-08-01T12:00:00.000Z',
    knowledgeTime: '2026-08-01T00:04:59.999Z',
  });
  assert.equal(notYetKnown, null, 'knowledgeTime anterior ao completedAt da run não pode ver o filing');

  // decisionTime before publishedAt (even with knowledgeTime satisfied): invisible (not yet public at that decision instant).
  const notYetPublished = await filings.getFilingByCvmProtocol(filing.cvmProtocol, {
    decisionTime: '2026-01-14T23:59:59.999Z',
    knowledgeTime: '2026-01-14T23:59:59.999Z',
  });
  assert.equal(notYetPublished, null, 'decisionTime anterior a publishedAt não pode ver o filing, mesmo com knowledgeTime satisfeito');

  // Both axes satisfied: visible.
  const visible = await filings.getFilingByCvmProtocol(filing.cvmProtocol, {
    decisionTime: completedAt,
    knowledgeTime: completedAt,
  });
  assert.ok(visible, 'filing deve ser visível quando publishedAt <= decisionTime e run completou <= knowledgeTime');

  // Reject knowledgeTime > decisionTime outright (the boundary itself, independent of any specific row).
  await assert.rejects(
    async () =>
      filings.getFilingByCvmProtocol(filing.cvmProtocol, {
        decisionTime: '2026-08-01T00:00:00.000Z',
        knowledgeTime: '2026-08-01T00:00:00.001Z',
      }),
    (error: unknown) => error instanceof ZodError,
    'knowledgeTime > decisionTime deve ser rejeitado',
  );

  console.log('publishedAt vs knowledgeTime: OK (dois eixos independentes; knowledgeTime > decisionTime rejeitado)');
}

async function factDurationAndValueTests(prisma: PrismaClient): Promise<void> {
  await seedIssuer(prisma, '50004', 'Empresa Delta', '2026-08-02T00:00:00.000Z', '2026-08-02T00:01:00.000Z');
  const uow = new PrismaCvmIngestionUnitOfWork(prisma);
  const facts = new PrismaCvmFactRepository(prisma);
  const filings = new PrismaCvmFilingRepository(prisma);

  const filing = {
    issuerCvmCode: '50004',
    documentType: 'DFP' as const,
    cvmProtocol: 'PROTO-DELTA-2025-DFP',
    referenceDate: '2025-12-31',
    fiscalYear: 2025,
    fiscalQuarter: null,
    filedAt: '2026-03-01T00:00:00.000Z',
    publishedAt: '2026-03-02T00:00:00.000Z',
    isRestatement: false,
    sourceUrl: 'https://cvm.example/delta-2025-dfp',
    rawSha256: '5'.repeat(64),
  };

  // INSTANT with periodStart !== periodEnd must be rejected (runtime Zod
  // guard against an externally-sourced payload bypassing the TS type).
  const invalidInstant = await uow.begin(SOURCE, '2026-08-02T01:00:00.000Z');
  await expectRejection(
    uow.commit(invalidInstant, '2026-08-02T01:01:00.000Z', '{"message":"instant mismatch"}', {
      filings: [filing],
      facts: [
        {
          filingCvmProtocol: filing.cvmProtocol,
          statementType: 'BPA',
          scope: 'CON',
          accountCode: '1',
          accountLabel: 'Ativo Total',
          periodStart: '2025-01-01',
          periodEnd: '2025-12-31',
          durationType: 'INSTANT',
          valueRaw: BigInt(1000),
          scalePow: 0,
          originalScale: 'UNIT' as const,
          currency: 'BRL',
          quality: 'AUDITED' as const,
        },
      ],
      shareCapitalFacts: [],
    }),
    ZodError,
    'INSTANT with periodStart !== periodEnd',
  );

  // DURATION with periodStart > periodEnd must be rejected.
  const invalidDuration = await uow.begin(SOURCE, '2026-08-02T01:05:00.000Z');
  await expectRejection(
    uow.commit(invalidDuration, '2026-08-02T01:06:00.000Z', '{"message":"duration reversed"}', {
      filings: [filing],
      facts: [
        {
          filingCvmProtocol: filing.cvmProtocol,
          statementType: 'DRE',
          scope: 'CON',
          accountCode: '3.01',
          accountLabel: 'Receita Liquida',
          periodStart: '2025-12-31',
          periodEnd: '2025-01-01',
          durationType: 'DURATION',
          valueRaw: BigInt(500),
          scalePow: 0,
          originalScale: 'UNIT' as const,
          currency: 'BRL',
          quality: 'AUDITED' as const,
        },
      ],
      shareCapitalFacts: [],
    }),
    ZodError,
    'DURATION with periodStart > periodEnd',
  );

  // BigInt out of signed 64-bit range must be rejected.
  const invalidRange = await uow.begin(SOURCE, '2026-08-02T01:10:00.000Z');
  await expectRejection(
    uow.commit(invalidRange, '2026-08-02T01:11:00.000Z', '{"message":"out of range"}', {
      filings: [filing],
      facts: [
        {
          filingCvmProtocol: filing.cvmProtocol,
          statementType: 'BPA',
          scope: 'CON',
          accountCode: '1',
          accountLabel: 'Ativo Total',
          periodStart: '2025-12-31',
          periodEnd: '2025-12-31',
          durationType: 'INSTANT',
          valueRaw: BigInt('9223372036854775808'), // MAX_INT64 + 1
          scalePow: 0,
          originalScale: 'UNIT' as const,
          currency: 'BRL',
          quality: 'AUDITED' as const,
        },
      ],
      shareCapitalFacts: [],
    }),
    ZodError,
    'valueRaw exceeding signed 64-bit max',
  );

  const invalidScale = await uow.begin(SOURCE, '2026-08-02T01:20:00.000Z');
  await expectRejection(
    uow.commit(invalidScale, '2026-08-02T01:21:00.000Z', '{"message":"scale outside contract"}', {
      filings: [filing],
      facts: [{
        filingCvmProtocol: filing.cvmProtocol,
        statementType: 'BPA',
        scope: 'CON',
        accountCode: '1',
        accountLabel: 'Ativo Total',
        periodStart: '2025-12-31',
        periodEnd: '2025-12-31',
        durationType: 'INSTANT',
        valueRaw: BigInt(1),
        scalePow: -19,
        originalScale: 'UNIT' as const,
        currency: 'BRL',
        quality: 'AUDITED' as const,
      }],
      shareCapitalFacts: [],
    }),
    ZodError,
    'scalePow outside documented technical contract',
  );

  // Valid batch: filing + INSTANT and DURATION facts at the signed 64-bit and scale boundaries.
  const validRun = await uow.begin(SOURCE, '2026-08-02T02:00:00.000Z');
  const t = '2026-08-02T02:01:00.000Z';
  await uow.commit(validRun, t, '{"message":"valid facts"}', {
    filings: [filing],
    facts: [
      {
        filingCvmProtocol: filing.cvmProtocol,
        statementType: 'BPA',
        scope: 'CON',
        accountCode: '1',
        accountLabel: 'Ativo Total',
        periodStart: '2025-12-31',
        periodEnd: '2025-12-31',
        durationType: 'INSTANT',
        valueRaw: BigInt('9223372036854775807'), // exact max
        scalePow: -18,
        originalScale: 'THOUSAND' as const,
        currency: 'BRL',
        quality: 'AUDITED' as const,
      },
      {
        filingCvmProtocol: filing.cvmProtocol,
        statementType: 'DRE',
        scope: 'CON',
        accountCode: '3.01',
        accountLabel: 'Receita Liquida',
        periodStart: '2025-01-01',
        periodEnd: '2025-12-31',
        durationType: 'DURATION',
        valueRaw: BigInt('-9223372036854775808'), // exact min
        scalePow: 18,
        originalScale: 'UNIT' as const,
        currency: 'BRL',
        quality: 'AUDITED' as const,
      },
    ],
    shareCapitalFacts: [],
  });

  const filingRow = await filings.getFilingByCvmProtocol(filing.cvmProtocol, { decisionTime: t, knowledgeTime: t });
  const factsResult = await facts.findFacts({ issuerId: filingRow!.issuerId }, { decisionTime: t, knowledgeTime: t });
  assert.equal(factsResult.length, 2);
  const instant = factsResult.find((f) => f.durationType === 'INSTANT');
  assert.equal(instant?.valueRaw, BigInt('9223372036854775807'));
  assert.equal(instant?.scalePow, -18);
  const duration = factsResult.find((f) => f.durationType === 'DURATION');
  assert.equal(duration?.valueRaw, BigInt('-9223372036854775808'));
  assert.equal(duration?.scalePow, 18);

  // Exact duplicate fact key within the same batch fails closed.
  const dupRun = await uow.begin(SOURCE, '2026-08-02T03:00:00.000Z');
  await expectRejection(
    uow.commit(dupRun, '2026-08-02T03:01:00.000Z', '{"message":"duplicate fact"}', {
      filings: [],
      facts: [
        {
          filingCvmProtocol: filing.cvmProtocol,
          statementType: 'BPA',
          scope: 'CON',
          accountCode: '1',
          accountLabel: 'Ativo Total (dup)',
          periodStart: '2025-12-31',
          periodEnd: '2025-12-31',
          durationType: 'INSTANT',
          valueRaw: BigInt(1),
          scalePow: 0,
          originalScale: 'UNIT' as const,
          currency: 'BRL',
          quality: 'AUDITED' as const,
        },
      ],
      shareCapitalFacts: [],
    }),
    DuplicateFactError,
    'exact duplicate fact key (already persisted)',
  );

  const exactDuplicateInBatch = {
    filingCvmProtocol: filing.cvmProtocol,
    statementType: 'BPP' as const,
    scope: 'CON' as const,
    accountCode: '2.99',
    accountLabel: 'Duplicata exata no lote',
    periodStart: '2025-12-31',
    periodEnd: '2025-12-31',
    durationType: 'INSTANT' as const,
    valueRaw: BigInt(7),
    scalePow: 0,
    originalScale: 'UNIT' as const,
    currency: 'BRL',
    quality: 'AUDITED' as const,
  };
  const exactBatchRun = await uow.begin(SOURCE, '2026-08-02T03:10:00.000Z');
  await expectRejection(
    uow.commit(exactBatchRun, '2026-08-02T03:11:00.000Z', '{"message":"exact in-batch duplicate"}', {
      filings: [],
      facts: [exactDuplicateInBatch, exactDuplicateInBatch],
      shareCapitalFacts: [],
    }),
    DuplicateFactError,
    'exact duplicate fact repeated inside the same batch',
  );

  // Unresolved filingCvmProtocol reference fails closed.
  const unknownFilingRun = await uow.begin(SOURCE, '2026-08-02T04:00:00.000Z');
  await expectRejection(
    uow.commit(unknownFilingRun, '2026-08-02T04:01:00.000Z', '{"message":"unknown filing ref"}', {
      filings: [],
      facts: [
        {
          filingCvmProtocol: 'PROTO-DOES-NOT-EXIST-EVER',
          statementType: 'BPA',
          scope: 'CON',
          accountCode: '2',
          accountLabel: 'Passivo Total',
          periodStart: '2025-12-31',
          periodEnd: '2025-12-31',
          durationType: 'INSTANT',
          valueRaw: BigInt(1),
          scalePow: 0,
          originalScale: 'UNIT' as const,
          currency: 'BRL',
          quality: 'AUDITED' as const,
        },
      ],
      shareCapitalFacts: [],
    }),
    UnknownFilingReferenceError,
    'fact referencing a non-existent filing',
  );

  console.log('CvmFact duration/value: OK (INSTANT/DURATION cronologia, limites signed 64-bit, duplicata e filing desconhecido falham fechado)');
}

async function shareCapitalFactTests(prisma: PrismaClient): Promise<void> {
  await seedIssuer(prisma, '50005', 'Empresa Epsilon', '2026-08-03T00:00:00.000Z', '2026-08-03T00:01:00.000Z');
  const uow = new PrismaCvmIngestionUnitOfWork(prisma);
  const shareCapital = new PrismaShareCapitalFactRepository(prisma);
  const filings = new PrismaCvmFilingRepository(prisma);

  const filing = {
    issuerCvmCode: '50005',
    documentType: 'DFP' as const,
    cvmProtocol: 'PROTO-EPSILON-2025-DFP',
    referenceDate: '2025-12-31',
    fiscalYear: 2025,
    fiscalQuarter: null,
    filedAt: '2026-03-01T00:00:00.000Z',
    publishedAt: '2026-03-02T00:00:00.000Z',
    isRestatement: false,
    sourceUrl: 'https://cvm.example/epsilon-2025-dfp',
    rawSha256: '6'.repeat(64),
  };

  // Negative quantity must be rejected.
  const negativeRun = await uow.begin(SOURCE, '2026-08-03T01:00:00.000Z');
  await expectRejection(
    uow.commit(negativeRun, '2026-08-03T01:01:00.000Z', '{"message":"negative quantity"}', {
      filings: [filing],
      facts: [],
      shareCapitalFacts: [
        {
          filingCvmProtocol: filing.cvmProtocol,
          shareClass: 'ON',
          periodStart: '2025-12-31',
          periodEnd: '2025-12-31',
          quantity: BigInt(-1),
          quantityType: 'ISSUED',
          quality: 'AUDITED' as const,
        },
      ],
    }),
    ZodError,
    'negative share quantity',
  );

  // periodStart !== periodEnd must be rejected.
  const mismatchRun = await uow.begin(SOURCE, '2026-08-03T01:05:00.000Z');
  await expectRejection(
    uow.commit(mismatchRun, '2026-08-03T01:06:00.000Z', '{"message":"period mismatch"}', {
      filings: [filing],
      facts: [],
      shareCapitalFacts: [
        {
          filingCvmProtocol: filing.cvmProtocol,
          shareClass: 'ON',
          periodStart: '2025-01-01',
          periodEnd: '2025-12-31',
          quantity: BigInt(100),
          quantityType: 'ISSUED',
          quality: 'AUDITED' as const,
        },
      ],
    }),
    ZodError,
    'periodStart !== periodEnd for share capital fact',
  );

  // Valid batch: ON/PN classes, multiple quantityTypes.
  const validRun = await uow.begin(SOURCE, '2026-08-03T02:00:00.000Z');
  const t = '2026-08-03T02:01:00.000Z';
  await uow.commit(validRun, t, '{"message":"share capital"}', {
    filings: [filing],
    facts: [],
    shareCapitalFacts: [
      { filingCvmProtocol: filing.cvmProtocol, shareClass: 'on', periodStart: '2025-12-31', periodEnd: '2025-12-31', quantity: BigInt(1_000_000), quantityType: 'ISSUED', quality: 'AUDITED' },
      { filingCvmProtocol: filing.cvmProtocol, shareClass: 'on', periodStart: '2025-12-31', periodEnd: '2025-12-31', quantity: BigInt(950_000), quantityType: 'OUTSTANDING', quality: 'AUDITED' },
      { filingCvmProtocol: filing.cvmProtocol, shareClass: 'on', periodStart: '2025-12-31', periodEnd: '2025-12-31', quantity: BigInt(50_000), quantityType: 'TREASURY', quality: 'AUDITED' },
      { filingCvmProtocol: filing.cvmProtocol, shareClass: 'pn', periodStart: '2025-12-31', periodEnd: '2025-12-31', quantity: BigInt(2_000_000), quantityType: 'ISSUED', quality: 'AUDITED' },
    ],
  });

  const filingRow = await filings.getFilingByCvmProtocol(filing.cvmProtocol, { decisionTime: t, knowledgeTime: t });
  const onFacts = await shareCapital.findShareCapitalFacts({ issuerId: filingRow!.issuerId, shareClass: 'ON' }, { decisionTime: t, knowledgeTime: t });
  assert.equal(onFacts.length, 3, 'classe ON deve ter 3 tipos de quantidade');
  assert.ok(onFacts.every((f) => f.shareClass === 'ON'));
  const treasury = onFacts.find((f) => f.quantityType === 'TREASURY');
  assert.equal(treasury?.quantity, BigInt(50_000));

  const pnFacts = await shareCapital.findShareCapitalFacts({ issuerId: filingRow!.issuerId, shareClass: 'PN' }, { decisionTime: t, knowledgeTime: t });
  assert.equal(pnFacts.length, 1);
  assert.equal(pnFacts[0].quantity, BigInt(2_000_000));

  const allFacts = await shareCapital.findShareCapitalFacts({ issuerId: filingRow!.issuerId }, { decisionTime: t, knowledgeTime: t });
  assert.equal(allFacts.length, 4);

  // Exact duplicate key (filingId + shareClass + periodEnd + quantityType) fails closed.
  const dupRun = await uow.begin(SOURCE, '2026-08-03T03:00:00.000Z');
  await expectRejection(
    uow.commit(dupRun, '2026-08-03T03:01:00.000Z', '{"message":"dup share capital"}', {
      filings: [],
      facts: [],
      shareCapitalFacts: [
        { filingCvmProtocol: filing.cvmProtocol, shareClass: 'ON', periodStart: '2025-12-31', periodEnd: '2025-12-31', quantity: BigInt(999), quantityType: 'ISSUED', quality: 'AUDITED' },
      ],
    }),
    DuplicateShareCapitalFactError,
    'duplicate share capital fact key',
  );

  console.log('ShareCapitalFact: OK (por classe/tipo, negativo/period rejeitados, duplicata falha fechado)');
}

async function fullRollbackTests(prisma: PrismaClient): Promise<void> {
  await seedIssuer(prisma, '50006', 'Empresa Zeta', '2026-08-04T00:00:00.000Z', '2026-08-04T00:01:00.000Z');
  const uow = new PrismaCvmIngestionUnitOfWork(prisma);
  const filings = new PrismaCvmFilingRepository(prisma);

  const runId = await uow.begin(SOURCE, '2026-08-04T01:00:00.000Z');
  await expectRejection(
    uow.commit(runId, '2026-08-04T01:01:00.000Z', '{"message":"partial then fail"}', {
      filings: [
        {
          issuerCvmCode: '50006',
          documentType: 'DFP',
          cvmProtocol: 'PROTO-ZETA-VALID',
          referenceDate: '2025-12-31',
          fiscalYear: 2025,
          fiscalQuarter: null,
          filedAt: '2026-03-01T00:00:00.000Z',
          publishedAt: '2026-03-02T00:00:00.000Z',
          isRestatement: false,
          sourceUrl: 'https://cvm.example/zeta-valid',
          rawSha256: '7'.repeat(64),
        },
      ],
      facts: [
        {
          filingCvmProtocol: 'PROTO-ZETA-DOES-NOT-EXIST',
          statementType: 'BPA',
          scope: 'CON',
          accountCode: '1',
          accountLabel: 'x',
          periodStart: '2025-12-31',
          periodEnd: '2025-12-31',
          durationType: 'INSTANT',
          valueRaw: BigInt(1),
          scalePow: 0,
          originalScale: 'UNIT' as const,
          currency: 'BRL',
          quality: 'AUDITED' as const,
        },
      ],
      shareCapitalFacts: [],
    }),
    UnknownFilingReferenceError,
    'batch with a valid filing and an invalid fact reference',
  );

  const orphanFiling = await filings.getFilingByCvmProtocol('PROTO-ZETA-VALID', {
    decisionTime: '2026-08-04T01:01:00.000Z',
    knowledgeTime: '2026-08-04T01:01:00.000Z',
  });
  assert.equal(orphanFiling, null, 'nenhuma linha de filing deve sobreviver a um rollback, mesmo se válida isoladamente');

  console.log('full rollback: OK (lote inteiro reverte quando qualquer item falha; nenhuma linha parcial)');
}

async function deterministicOrderTests(prisma: PrismaClient): Promise<void> {
  await seedIssuer(prisma, '50007', 'Empresa Eta', '2026-08-05T00:00:00.000Z', '2026-08-05T00:01:00.000Z');
  const uow = new PrismaCvmIngestionUnitOfWork(prisma);
  const filings = new PrismaCvmFilingRepository(prisma);

  const v1 = {
    issuerCvmCode: '50007',
    documentType: 'DFP' as const,
    cvmProtocol: 'PROTO-ETA-V1',
    referenceDate: '2025-12-31',
    fiscalYear: 2025,
    fiscalQuarter: null,
    filedAt: '2026-03-01T00:00:00.000Z',
    publishedAt: '2026-03-02T00:00:00.000Z',
    isRestatement: false,
    sourceUrl: 'https://cvm.example/eta-v1',
    rawSha256: '8'.repeat(64),
  };
  const v2 = {
    issuerCvmCode: '50007',
    documentType: 'DFP' as const,
    cvmProtocol: 'PROTO-ETA-V2',
    referenceDate: '2025-12-31',
    fiscalYear: 2025,
    fiscalQuarter: null,
    filedAt: '2026-05-01T00:00:00.000Z',
    publishedAt: '2026-05-02T00:00:00.000Z',
    isRestatement: true,
    supersedesCvmProtocol: 'PROTO-ETA-V1',
    sourceUrl: 'https://cvm.example/eta-v2',
    rawSha256: '9'.repeat(64),
  };

  // Submit the restatement BEFORE the first version in the raw array; the
  // unit of work must still process them in canonical order (first version
  // before restatement), never depending on array position.
  const runId = await uow.begin(SOURCE, '2026-08-05T01:00:00.000Z');
  const t = '2026-08-05T01:01:00.000Z';
  await uow.commit(runId, t, '{"message":"reversed order in batch"}', { filings: [v2, v1], facts: [], shareCapitalFacts: [] });

  const v1Row = await filings.getFilingByCvmProtocol('PROTO-ETA-V1', { decisionTime: t, knowledgeTime: t });
  const v2Row = await filings.getFilingByCvmProtocol('PROTO-ETA-V2', { decisionTime: t, knowledgeTime: t });
  assert.equal(v1Row?.versionNumber, 1);
  assert.equal(v2Row?.versionNumber, 2);
  assert.equal(v2Row?.supersedesFilingId, v1Row?.id);

  console.log('deterministic order: OK (ordem canônica independente da ordem de entrada no array)');
}

async function idempotentFactResubmissionTests(prisma: PrismaClient): Promise<void> {
  await seedIssuer(prisma, '50010', 'Empresa Iota', '2026-08-06T00:00:00.000Z', '2026-08-06T00:01:00.000Z');
  const uow = new PrismaCvmIngestionUnitOfWork(prisma);
  const filing = {
    issuerCvmCode: '50010', documentType: 'DFP' as const, cvmProtocol: 'PROTO-IOTA-V1',
    referenceDate: '2025-12-31', fiscalYear: 2025, fiscalQuarter: null,
    filedAt: '2026-03-01T00:00:00.000Z', publishedAt: '2026-03-02T00:00:00.000Z',
    isRestatement: false, sourceUrl: 'https://cvm.example/iota-v1', rawSha256: 'a'.repeat(64),
  };
  const fact = {
    filingCvmProtocol: filing.cvmProtocol, statementType: 'BPA' as const, scope: 'CON' as const,
    accountCode: '1', accountLabel: 'Ativo Total', periodStart: '2025-12-31', periodEnd: '2025-12-31',
    durationType: 'INSTANT' as const, valueRaw: BigInt(100), scalePow: 0,
    originalScale: 'UNIT' as const, currency: 'BRL', quality: 'AUDITED' as const,
  };
  const capital = {
    filingCvmProtocol: filing.cvmProtocol, shareClass: 'ON', periodStart: '2025-12-31', periodEnd: '2025-12-31',
    quantity: BigInt(1000), quantityType: 'ISSUED' as const, quality: 'AUDITED' as const,
  };
  const run1 = await uow.begin(SOURCE, '2026-08-06T01:00:00.000Z');
  await uow.commit(run1, '2026-08-06T01:01:00.000Z', '{"message":"first"}', { filings: [filing], facts: [fact], shareCapitalFacts: [capital] });

  const run2 = await uow.begin(SOURCE, '2026-08-06T02:00:00.000Z');
  await uow.commit(run2, '2026-08-06T02:01:00.000Z', '{"message":"same payload again"}', { filings: [filing], facts: [fact], shareCapitalFacts: [capital] });
  assert.equal(await prisma.cvmFact.count({ where: { filing: { cvmProtocol: filing.cvmProtocol } } }), 1);
  assert.equal(await prisma.shareCapitalFact.count({ where: { filing: { cvmProtocol: filing.cvmProtocol } } }), 1);

  const run3 = await uow.begin(SOURCE, '2026-08-06T03:00:00.000Z');
  await expectRejection(
    uow.commit(run3, '2026-08-06T03:01:00.000Z', '{"message":"same key divergent content"}', {
      filings: [], facts: [{ ...fact, valueRaw: BigInt(101) }], shareCapitalFacts: [],
    }),
    DuplicateFactError,
    'same fact key with divergent content',
  );
  console.log('fact idempotency: OK (reenvio idêntico no-op; divergência na mesma chave falha fechado)');
}

async function effectiveVersionRemovalTests(prisma: PrismaClient): Promise<void> {
  await seedIssuer(prisma, '50011', 'Empresa Kappa', '2026-08-07T00:00:00.000Z', '2026-08-07T00:01:00.000Z');
  const uow = new PrismaCvmIngestionUnitOfWork(prisma);
  const filingRepo = new PrismaCvmFilingRepository(prisma);
  const factRepo = new PrismaCvmFactRepository(prisma);
  const capitalRepo = new PrismaShareCapitalFactRepository(prisma);
  const v1 = {
    issuerCvmCode: '50011', documentType: 'ITR' as const, cvmProtocol: 'PROTO-KAPPA-V1',
    referenceDate: '2026-03-31', fiscalYear: 2026, fiscalQuarter: 1,
    filedAt: '2026-04-10T00:00:00.000Z', publishedAt: '2026-04-11T00:00:00.000Z',
    isRestatement: false, sourceUrl: 'https://cvm.example/kappa-v1', rawSha256: 'b'.repeat(64),
  };
  const oldFact = {
    filingCvmProtocol: v1.cvmProtocol, statementType: 'BPA' as const, scope: 'CON' as const,
    accountCode: '9.99', accountLabel: 'Conta removida', periodStart: '2026-03-31', periodEnd: '2026-03-31',
    durationType: 'INSTANT' as const, valueRaw: BigInt(10), scalePow: 0,
    originalScale: 'UNIT' as const, currency: 'BRL', quality: 'REVIEWED' as const,
  };
  const oldCapital = {
    filingCvmProtocol: v1.cvmProtocol, shareClass: 'PNA', periodStart: '2026-03-31', periodEnd: '2026-03-31',
    quantity: BigInt(10), quantityType: 'ISSUED' as const, quality: 'REVIEWED' as const,
  };
  const run1 = await uow.begin(SOURCE, '2026-08-07T01:00:00.000Z');
  const t1 = '2026-08-07T01:01:00.000Z';
  await uow.commit(run1, t1, '{"message":"v1"}', { filings: [v1], facts: [oldFact], shareCapitalFacts: [oldCapital] });
  const filingV1 = await filingRepo.getFilingByCvmProtocol(v1.cvmProtocol, { decisionTime: t1, knowledgeTime: t1 });
  assert.equal((await factRepo.findFacts({ issuerId: filingV1!.issuerId, accountCode: '9.99' }, { decisionTime: t1, knowledgeTime: t1 })).length, 1);

  const v2 = {
    ...v1, cvmProtocol: 'PROTO-KAPPA-V2', filedAt: '2026-05-10T00:00:00.000Z', publishedAt: '2026-05-11T00:00:00.000Z',
    isRestatement: true, supersedesCvmProtocol: v1.cvmProtocol,
    sourceUrl: 'https://cvm.example/kappa-v2', rawSha256: 'c'.repeat(64),
  };
  const run2 = await uow.begin(SOURCE, '2026-08-08T01:00:00.000Z');
  const t2 = '2026-08-08T01:01:00.000Z';
  await uow.commit(run2, t2, '{"message":"v2 removes old fact"}', { filings: [v2], facts: [], shareCapitalFacts: [] });
  assert.equal((await factRepo.findFacts({ issuerId: filingV1!.issuerId, accountCode: '9.99' }, { decisionTime: t2, knowledgeTime: t2 })).length, 0, 'fato ausente na versão efetiva não pode sobreviver da versão antiga');
  assert.equal((await capitalRepo.findShareCapitalFacts({ issuerId: filingV1!.issuerId, shareClass: 'PNA' }, { decisionTime: t2, knowledgeTime: t2 })).length, 0, 'capital ausente na versão efetiva não pode sobreviver da versão antiga');
  console.log('effective version removal: OK (retificação pode remover fatos sem vazamento da versão anterior)');
}

async function deepInBatchRestatementChainTests(prisma: PrismaClient): Promise<void> {
  await seedIssuer(prisma, '50012', 'Empresa Lambda', '2026-08-09T00:00:00.000Z', '2026-08-09T00:01:00.000Z');
  const uow = new PrismaCvmIngestionUnitOfWork(prisma);
  const filings = new PrismaCvmFilingRepository(prisma);
  const base = {
    issuerCvmCode: '50012', documentType: 'DFP' as const, referenceDate: '2025-12-31', fiscalYear: 2025, fiscalQuarter: null,
  };
  const v1 = { ...base, cvmProtocol: 'PROTO-Z-LAMBDA-V1', filedAt: '2026-03-01T00:00:00.000Z', publishedAt: '2026-03-02T00:00:00.000Z', isRestatement: false, sourceUrl: 'https://cvm.example/lambda-v1', rawSha256: 'd'.repeat(64) };
  const v2 = { ...base, cvmProtocol: 'PROTO-A-LAMBDA-V2', filedAt: '2026-04-01T00:00:00.000Z', publishedAt: '2026-04-02T00:00:00.000Z', isRestatement: true, supersedesCvmProtocol: v1.cvmProtocol, sourceUrl: 'https://cvm.example/lambda-v2', rawSha256: 'e'.repeat(64) };
  const v3 = { ...base, cvmProtocol: 'PROTO-B-LAMBDA-V3', filedAt: '2026-05-01T00:00:00.000Z', publishedAt: '2026-05-02T00:00:00.000Z', isRestatement: true, supersedesCvmProtocol: v2.cvmProtocol, sourceUrl: 'https://cvm.example/lambda-v3', rawSha256: 'f'.repeat(64) };
  const run = await uow.begin(SOURCE, '2026-08-09T01:00:00.000Z');
  const t = '2026-08-09T01:01:00.000Z';
  await uow.commit(run, t, '{"message":"deep reversed chain"}', { filings: [v3, v2, v1], facts: [], shareCapitalFacts: [] });
  const row = await filings.getFilingByCvmProtocol(v3.cvmProtocol, { decisionTime: t, knowledgeTime: t });
  assert.equal(row?.versionNumber, 3);

  const cycleAProtocol = 'PROTO-LAMBDA-CYCLE-A';
  const cycleBProtocol = 'PROTO-LAMBDA-CYCLE-B';
  const cycleRun = await uow.begin(SOURCE, '2026-08-09T02:00:00.000Z');
  await expectRejection(
    uow.commit(cycleRun, '2026-08-09T02:01:00.000Z', '{"message":"cycle"}', {
      filings: [
        { ...base, cvmProtocol: cycleAProtocol, filedAt: '2026-06-01T00:00:00.000Z', publishedAt: '2026-06-02T00:00:00.000Z', isRestatement: true, supersedesCvmProtocol: cycleBProtocol, sourceUrl: 'https://cvm.example/lambda-cycle-a', rawSha256: '1'.repeat(64) },
        { ...base, cvmProtocol: cycleBProtocol, filedAt: '2026-06-03T00:00:00.000Z', publishedAt: '2026-06-04T00:00:00.000Z', isRestatement: true, supersedesCvmProtocol: cycleAProtocol, sourceUrl: 'https://cvm.example/lambda-cycle-b', rawSha256: '2'.repeat(64) },
      ],
      facts: [],
      shareCapitalFacts: [],
    }),
    FilingChainViolationError,
    'cycle between filings in the same batch',
  );

  console.log('deep in-batch chain: OK (ordenação topológica, cadeia profunda e ciclo fail-closed)');
}

async function main(): Promise<void> {
  migrationAdditivityTests();
  const prisma = new PrismaClient();
  try {
    await runLifecycleTests(prisma);
    await unknownIssuerTests(prisma);
    await filingChronologyTests(prisma);
    await protocolIdempotencyAndConflictTests(prisma);
    await restatementChainTests(prisma);
    await publishedAtVsKnowledgeTimeTests(prisma);
    await factDurationAndValueTests(prisma);
    await shareCapitalFactTests(prisma);
    await fullRollbackTests(prisma);
    await deterministicOrderTests(prisma);
    await idempotentFactResubmissionTests(prisma);
    await effectiveVersionRemovalTests(prisma);
    await deepInBatchRestatementChainTests(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log('Fase 2 / Item 2 — CVM filings e fatos point-in-time: TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
