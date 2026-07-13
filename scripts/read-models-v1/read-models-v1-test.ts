import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import {
  PrismaCvmFactRepository,
  PrismaCvmFilingRepository,
  PrismaCvmIngestionUnitOfWork,
  PrismaShareCapitalFactRepository,
} from '../../src/adapters/prisma/cvm';
import {
  PrismaIngestionLedger,
  PrismaInstrumentRepository,
  PrismaReferenceDataIngestionUnitOfWork,
} from '../../src/adapters/prisma/reference-data';
import { PrismaMarketBarIngestionUnitOfWork, PrismaMarketBarRepository } from '../../src/adapters/prisma/market-bar';
import type { VersionedMarketBarSubmission } from '../../src/domain/v1/models/versioned-market-bar';
import { ReadModelError, ReadModelV1Service, rawToDecimalString } from '../../src/application/read-models-v1';
import { GET as instrumentGET } from '../../src/app/api/v1/reference/instrument/route';
import { GET as effectiveFilingGET } from '../../src/app/api/v1/fundamentals/effective-filing/route';
import { GET as factsGET } from '../../src/app/api/v1/fundamentals/facts/route';
import { GET as shareCapitalGET } from '../../src/app/api/v1/fundamentals/share-capital/route';
import { GET as marketBarsGET } from '../../src/app/api/v1/market-bars/route';
import { prisma as appPrisma } from '../../src/lib/prisma';

const REF_SOURCE = 'reference:read-models-v1-seed';
const CVM_SOURCE = 'cvm:read-models-v1-seed';
const MB_SOURCE = 'mt5:read-models-v1-seed';

function service(prisma: PrismaClient): ReadModelV1Service {
  return new ReadModelV1Service({
    instrumentRepository: new PrismaInstrumentRepository(prisma),
    cvmFilingRepository: new PrismaCvmFilingRepository(prisma),
    cvmFactRepository: new PrismaCvmFactRepository(prisma),
    shareCapitalFactRepository: new PrismaShareCapitalFactRepository(prisma),
    marketBarRepository: new PrismaMarketBarRepository(prisma),
    ingestionLedger: new PrismaIngestionLedger(prisma),
  });
}

async function expectError(promise: Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await promise;
    assert.fail(`esperava ReadModelError(${code}) em ${label}`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.ok(error instanceof ReadModelError, `${label}: esperava ReadModelError, recebeu ${(error as Error)?.constructor?.name}: ${(error as Error)?.message}`);
    assert.equal((error as ReadModelError).code, code, `${label}: código esperado ${code}, recebeu ${(error as ReadModelError).code}`);
  }
}

/** Test 16: no route.ts under src/app/api/v1 exports a non-GET HTTP method. */
function noNonGetExportsTest(): void {
  const root = join(process.cwd(), 'src', 'app', 'api', 'v1');
  const forbidden = ['POST', 'PUT', 'PATCH', 'DELETE'];
  const routeFiles: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'route.ts') routeFiles.push(full);
    }
  };
  walk(root);
  assert.ok(routeFiles.length >= 5, `esperava >= 5 route.ts, encontrou ${routeFiles.length}`);
  for (const file of routeFiles) {
    const content = readFileSync(file, 'utf8');
    assert.match(content, /export\s+async\s+function\s+GET\s*\(/, `${file} deve exportar GET`);
    for (const method of forbidden) {
      assert.doesNotMatch(
        content,
        new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\s*\\(`),
        `${file} não pode exportar ${method}`,
      );
    }
  }
  console.log('no non-GET exports: OK (todas as rotas /api/v1 exportam somente GET)');
}

/** Test 17: no protected legacy file was modified in this working tree. */
function noLegacyFileModifiedTest(): void {
  // Note: docs/CODEX_HANDOFF.md is deliberately excluded from this check —
  // it is a preexisting, out-of-scope modification per the task brief and
  // must never be read or asserted on by this harness.
  const protectedPaths = [
    'prisma/schema.prisma',
    'src/services/historicalDataService.ts',
    'src/services/stockMonitoringService.ts',
    'src/services/tradingAgentsService.ts',
  ];
  const result = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status !== 0) {
    console.log('no legacy file modified: SKIPPED (git diff indisponível neste ambiente)');
    return;
  }
  const changed = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const protectedPath of protectedPaths) {
    assert.ok(!changed.includes(protectedPath), `arquivo legado protegido foi modificado: ${protectedPath}`);
  }
  console.log('no legacy file modified: OK (nenhum arquivo legado protegido no diff atual)');
}

/** Tests 9/10: exact scaled decimal conversion, no float/exponent, civil dates untouched by Date. */
function scaledDecimalTests(): void {
  assert.equal(rawToDecimalString(BigInt(0), -5), '0');
  assert.equal(rawToDecimalString(BigInt(12345), -2), '123.45');
  assert.equal(rawToDecimalString(BigInt(12345), 2), '1234500');
  assert.equal(rawToDecimalString(BigInt(-12345), -2), '-123.45');
  assert.equal(rawToDecimalString(BigInt('9223372036854775807'), -18), '9.223372036854775807');
  assert.equal(rawToDecimalString(BigInt('-9223372036854775808'), 18), '-9223372036854775808' + '0'.repeat(18));
  console.log('scaled decimal: OK (bigint > MAX_SAFE_INTEGER preservado como decimal exato, sem float)');
}

async function seedIssuer(prisma: PrismaClient, cvmCode: string, name: string, startedAt: string, completedAt: string): Promise<void> {
  const uow = new PrismaReferenceDataIngestionUnitOfWork(prisma);
  const runId = await uow.begin(REF_SOURCE, startedAt);
  await uow.commit(runId, completedAt, '{"message":"seed issuer"}', { issuers: [{ cvmCode, cnpj: null, name }], instrumentVersions: [] });
}

async function seedInstrumentVersion(
  prisma: PrismaClient,
  symbol: string,
  exchange: string,
  validFrom: string,
  startedAt: string,
  completedAt: string,
): Promise<string> {
  const uow = new PrismaReferenceDataIngestionUnitOfWork(prisma);
  const runId = await uow.begin(REF_SOURCE, startedAt);
  await uow.commit(runId, completedAt, '{"message":"seed instrument"}', {
    issuers: [],
    instrumentVersions: [
      { symbol, exchange, currency: 'BRL', displayName: symbol, assetClass: 'equity', status: 'ACTIVE', validFromBasis: 'SOURCE_EFFECTIVE', validFrom },
    ],
  });
  const repo = new PrismaInstrumentRepository(prisma);
  const versions = await repo.findInstrumentVersions(symbol, exchange, { knowledgeTime: completedAt });
  const version = versions.find((v) => v.validFrom === new Date(validFrom).toISOString());
  if (!version) throw new Error('seedInstrumentVersion: versão não encontrada');
  return version.id;
}

async function instrumentEndpointTests(prisma: PrismaClient): Promise<void> {
  const svc = service(prisma);
  const t0 = '2026-09-01T00:00:00.000Z';
  const t1 = '2026-09-01T00:01:00.000Z';
  const id = await seedInstrumentVersion(prisma, 'PETR4', 'B3', t0, t0, t1);
  void id;

  // Resolution correct: exact business-time/knowledge-time match.
  const found = await svc.getInstrument({ symbol: 'PETR4', exchange: 'B3', asOf: t1, knowledgeTime: t1 });
  assert.equal(found.symbol, 'PETR4');
  assert.equal(found.provenance.sourceKey, REF_SOURCE);
  assert.equal(found.provenance.completedAt, t1);

  // 404: unknown symbol.
  await expectError(
    svc.getInstrument({ symbol: 'DOESNOTEXIST', exchange: 'B3', asOf: t1, knowledgeTime: t1 }),
    'INSTRUMENT_NOT_FOUND',
    'unknown symbol',
  );

  // 404: asOf before validFrom (no version covers it).
  await expectError(
    svc.getInstrument({ symbol: 'PETR4', exchange: 'B3', asOf: '2020-01-01T00:00:00.000Z', knowledgeTime: t1 }),
    'INSTRUMENT_NOT_FOUND',
    'asOf before validFrom',
  );

  // Ambiguity: close v1 and open v2 covering distinct ranges is NOT ambiguous (asOf narrows to one);
  // ambiguity instead arises when asOf is omitted-equivalent broad range with overlapping versions is
  // structurally prevented by the repository's non-overlap invariant, so we assert the "one" success path
  // above is sufficient given the repository's documented invariant (never overlapping intervals).
  console.log('reference/instrument: OK (resolução correta, 404 símbolo desconhecido, 404 fora do intervalo de negócio)');

  // HTTP layer, exercised through the real GET handler: unknown/duplicate query params -> 400 INVALID_QUERY.
  const okUrl = `http://localhost/api/v1/reference/instrument?symbol=PETR4&exchange=B3&asOf=${encodeURIComponent(t1)}&knowledgeTime=${encodeURIComponent(t1)}`;
  const okResponse = await instrumentGET(new Request(okUrl));
  assert.equal(okResponse.status, 200);
  const okBody = (await okResponse.json()) as { success: boolean; data: { symbol: string } };
  assert.equal(okBody.success, true);
  assert.equal(okBody.data.symbol, 'PETR4');

  const unknownParamResponse = await instrumentGET(new Request(`${okUrl}&unexpected=1`));
  assert.equal(unknownParamResponse.status, 400);
  const unknownParamBody = (await unknownParamResponse.json()) as { error: { code: string } };
  assert.equal(unknownParamBody.error.code, 'INVALID_QUERY');

  const duplicateParamResponse = await instrumentGET(new Request(`${okUrl}&symbol=VALE3`));
  assert.equal(duplicateParamResponse.status, 400);
  const duplicateParamBody = (await duplicateParamResponse.json()) as { error: { code: string } };
  assert.equal(duplicateParamBody.error.code, 'INVALID_QUERY');

  const missingTimeUrl = 'http://localhost/api/v1/reference/instrument?symbol=PETR4&exchange=B3&asOf=2026-09-01T00:01:00.000Z';
  const missingTimeResponse = await instrumentGET(new Request(missingTimeUrl));
  assert.equal(missingTimeResponse.status, 400, 'ausência de knowledgeTime obrigatório deve retornar 400');

  const notFoundResponse = await instrumentGET(new Request(`http://localhost/api/v1/reference/instrument?symbol=DOESNOTEXIST&exchange=B3&asOf=${encodeURIComponent(t1)}&knowledgeTime=${encodeURIComponent(t1)}`));
  assert.equal(notFoundResponse.status, 404);
  const notFoundBody = (await notFoundResponse.json()) as { error: { code: string; message: string } };
  assert.equal(notFoundBody.error.code, 'INSTRUMENT_NOT_FOUND');
  assert.doesNotMatch(notFoundBody.error.message, /prisma|sql|at\s+\S+\.(ts|js):\d+/i, 'erro não pode vazar detalhes internos');

  console.log('HTTP layer (GET /api/v1/reference/instrument): OK (query desconhecida/duplicada -> 400, tempo ausente -> 400, 404 sanitizado)');
}

async function effectiveFilingAndFactsTests(prisma: PrismaClient): Promise<void> {
  await seedIssuer(prisma, '60001', 'Empresa RM1', '2026-09-02T00:00:00.000Z', '2026-09-02T00:01:00.000Z');
  const cvmUow = new PrismaCvmIngestionUnitOfWork(prisma);
  const filingRepo = new PrismaCvmFilingRepository(prisma);
  const svc = service(prisma);

  const v1 = {
    issuerCvmCode: '60001', documentType: 'DFP' as const, cvmProtocol: 'PROTO-RM1-V1',
    referenceDate: '2025-12-31', fiscalYear: 2025, fiscalQuarter: null,
    filedAt: '2026-03-01T00:00:00.000Z', publishedAt: '2026-03-02T00:00:00.000Z',
    isRestatement: false, sourceUrl: 'https://cvm.example/rm1-v1', rawSha256: 'a'.repeat(64),
  };
  const factInV1 = {
    filingCvmProtocol: v1.cvmProtocol, statementType: 'BPA' as const, scope: 'CON' as const,
    accountCode: '1.01', accountLabel: 'Caixa', periodStart: '2025-12-31', periodEnd: '2025-12-31',
    durationType: 'INSTANT' as const, valueRaw: BigInt('123456789012345'), scalePow: -2,
    originalScale: 'UNIT' as const, currency: 'BRL', quality: 'AUDITED' as const,
  };
  const removedFact = {
    filingCvmProtocol: v1.cvmProtocol, statementType: 'BPA' as const, scope: 'CON' as const,
    accountCode: '9.99', accountLabel: 'Conta que sera removida', periodStart: '2025-12-31', periodEnd: '2025-12-31',
    durationType: 'INSTANT' as const, valueRaw: BigInt(10), scalePow: 0,
    originalScale: 'UNIT' as const, currency: 'BRL', quality: 'AUDITED' as const,
  };
  const capital1 = {
    filingCvmProtocol: v1.cvmProtocol, shareClass: 'ON', periodStart: '2025-12-31', periodEnd: '2025-12-31',
    quantity: BigInt('9223372036854775807'), quantityType: 'ISSUED' as const, quality: 'AUDITED' as const,
  };

  const run1 = await cvmUow.begin(CVM_SOURCE, '2026-09-02T01:00:00.000Z');
  const t1 = '2026-09-02T01:01:00.000Z';
  await cvmUow.commit(run1, t1, '{"message":"v1"}', { filings: [v1], facts: [factInV1, removedFact], shareCapitalFacts: [capital1] });

  // Effective filing endpoint: before restatement.
  const filingBefore = await svc.getEffectiveFiling({ issuerId: (await filingRepo.getFilingByCvmProtocol(v1.cvmProtocol, { decisionTime: t1, knowledgeTime: t1 }))!.issuerId, documentType: 'DFP', referenceDate: '2025-12-31', decisionTime: t1, knowledgeTime: t1 });
  assert.equal(filingBefore.versionNumber, 1);
  assert.equal(filingBefore.provenance.sourceKey, CVM_SOURCE);
  const issuerId = filingBefore.issuerId;

  // 404: unknown chain.
  await expectError(
    svc.getEffectiveFiling({ issuerId, documentType: 'ITR', referenceDate: '2099-12-31', decisionTime: t1, knowledgeTime: t1 }),
    'FILING_NOT_FOUND',
    'unknown chain',
  );

  // Time-range invalid: knowledgeTime > decisionTime.
  await expectError(
    svc.getEffectiveFiling({ issuerId, documentType: 'DFP', referenceDate: '2025-12-31', decisionTime: t1, knowledgeTime: '2026-09-02T01:02:00.000Z' }),
    'INVALID_TIME_RANGE',
    'knowledgeTime > decisionTime (filing)',
  );

  // Facts endpoint: exact BigInt > MAX_SAFE_INTEGER preserved, exact civil dates.
  const factsBefore = await svc.getFacts({ issuerId, documentType: 'DFP', referenceDate: '2025-12-31', decisionTime: t1, knowledgeTime: t1, limit: 100, offset: 0 });
  assert.equal(factsBefore.facts.length, 2);
  const bigFact = factsBefore.facts.find((f) => f.accountCode === '1.01')!;
  assert.equal(bigFact.value.raw, '123456789012345');
  assert.equal(bigFact.value.decimal, '1234567890123.45');
  assert.equal(bigFact.periodEnd, '2025-12-31', 'data civil não sofre shift');
  assert.equal(factsBefore.effectiveFiling.versionNumber, 1);

  // Pagination determinism: same query twice, page 0 and page 1 are disjoint and stable.
  const page0 = await svc.getFacts({ issuerId, documentType: 'DFP', referenceDate: '2025-12-31', decisionTime: t1, knowledgeTime: t1, limit: 1, offset: 0 });
  const page1 = await svc.getFacts({ issuerId, documentType: 'DFP', referenceDate: '2025-12-31', decisionTime: t1, knowledgeTime: t1, limit: 1, offset: 1 });
  assert.equal(page0.facts.length, 1);
  assert.equal(page1.facts.length, 1);
  assert.notEqual(page0.facts[0].id, page1.facts[0].id);
  const page0Again = await svc.getFacts({ issuerId, documentType: 'DFP', referenceDate: '2025-12-31', decisionTime: t1, knowledgeTime: t1, limit: 1, offset: 0 });
  assert.equal(page0Again.facts[0].id, page0.facts[0].id, 'paginação deve ser determinística entre chamadas');

  // Share capital endpoint: exact quantity as string.
  const capitalResult = await svc.getShareCapital({ issuerId, documentType: 'DFP', referenceDate: '2025-12-31', decisionTime: t1, knowledgeTime: t1, limit: 100, offset: 0 });
  assert.equal(capitalResult.shareCapital.length, 1);
  assert.equal(capitalResult.shareCapital[0].quantity, '9223372036854775807');

  // Facts of another documentType/referenceDate never contaminate: seed an ITR chain for the same issuer,
  // with a fact sharing the same accountCode ('1.01'), and confirm the DFP chain is unaffected.
  const itr = {
    issuerCvmCode: '60001', documentType: 'ITR' as const, cvmProtocol: 'PROTO-RM1-ITR',
    referenceDate: '2026-03-31', fiscalYear: 2026, fiscalQuarter: 1,
    filedAt: '2026-04-10T00:00:00.000Z', publishedAt: '2026-04-11T00:00:00.000Z',
    isRestatement: false, sourceUrl: 'https://cvm.example/rm1-itr', rawSha256: 'c'.repeat(64),
  };
  const itrFact = {
    filingCvmProtocol: itr.cvmProtocol, statementType: 'BPA' as const, scope: 'CON' as const,
    accountCode: '1.01', accountLabel: 'Caixa ITR', periodStart: '2026-03-31', periodEnd: '2026-03-31',
    durationType: 'INSTANT' as const, valueRaw: BigInt(999), scalePow: 0,
    originalScale: 'UNIT' as const, currency: 'BRL', quality: 'AUDITED' as const,
  };
  const runItr = await cvmUow.begin(CVM_SOURCE, '2026-09-02T02:00:00.000Z');
  const tItr = '2026-09-02T02:01:00.000Z';
  await cvmUow.commit(runItr, tItr, '{"message":"itr chain"}', { filings: [itr], facts: [itrFact], shareCapitalFacts: [] });

  const dfpFactsAfterItr = await svc.getFacts({ issuerId, documentType: 'DFP', referenceDate: '2025-12-31', decisionTime: tItr, knowledgeTime: tItr, accountCode: '1.01', limit: 100, offset: 0 });
  assert.equal(dfpFactsAfterItr.facts.length, 1, 'DFP não deve enxergar o fato 1.01 do ITR (chains distintas)');
  assert.equal(dfpFactsAfterItr.facts[0].value.raw, '123456789012345', 'DFP deve manter seu próprio valor, não o do ITR');
  assert.equal(dfpFactsAfterItr.effectiveFiling.versionNumber, 1);

  const itrFactsOwn = await svc.getFacts({ issuerId, documentType: 'ITR', referenceDate: '2026-03-31', decisionTime: tItr, knowledgeTime: tItr, accountCode: '1.01', limit: 100, offset: 0 });
  assert.equal(itrFactsOwn.facts.length, 1);
  assert.equal(itrFactsOwn.facts[0].value.raw, '999', 'ITR deve enxergar seu próprio fato, não o do DFP');

  // Restatement: removed account does not leak even filtered by that account.
  const v2 = { ...v1, cvmProtocol: 'PROTO-RM1-V2', filedAt: '2026-05-01T00:00:00.000Z', publishedAt: '2026-05-02T00:00:00.000Z', isRestatement: true, supersedesCvmProtocol: v1.cvmProtocol, sourceUrl: 'https://cvm.example/rm1-v2', rawSha256: 'b'.repeat(64) };
  const run2 = await cvmUow.begin(CVM_SOURCE, '2026-09-03T00:00:00.000Z');
  const t2 = '2026-09-03T00:01:00.000Z';
  await cvmUow.commit(run2, t2, '{"message":"v2 removes account 9.99"}', { filings: [v2], facts: [], shareCapitalFacts: [] });

  const factsAfter = await svc.getFacts({ issuerId, documentType: 'DFP', referenceDate: '2025-12-31', decisionTime: t2, knowledgeTime: t2, accountCode: '9.99', limit: 100, offset: 0 });
  assert.equal(factsAfter.facts.length, 0, 'conta removida na retificação não pode vazar mesmo filtrando por ela');
  assert.equal(factsAfter.effectiveFiling.versionNumber, 2);

  console.log('fundamentals/effective-filing + facts + share-capital: OK (efetiva antes/depois, remoção não vaza, paginação determinística, isolamento entre chains, BigInt exato, datas civis intactas)');

  // HTTP layer: GET /api/v1/fundamentals/effective-filing — real wire round-trip.
  const efUrl = `http://localhost/api/v1/fundamentals/effective-filing?issuerId=${issuerId}&documentType=DFP&referenceDate=2025-12-31&decisionTime=${encodeURIComponent(t2)}&knowledgeTime=${encodeURIComponent(t2)}`;
  const efResponse = await effectiveFilingGET(new Request(efUrl));
  assert.equal(efResponse.status, 200);
  const efBody = (await efResponse.json()) as { success: boolean; data: { versionNumber: number; provenance: { runId: string } } };
  assert.equal(efBody.success, true);
  assert.equal(efBody.data.versionNumber, 2, 'deve refletir a filing efetiva pós-retificação');
  assert.ok(efBody.data.provenance.runId, 'provenance.runId deve estar presente');

  const efNotFoundUrl = `http://localhost/api/v1/fundamentals/effective-filing?issuerId=${issuerId}&documentType=ITR&referenceDate=2099-12-31&decisionTime=${encodeURIComponent(t2)}&knowledgeTime=${encodeURIComponent(t2)}`;
  const efNotFoundResponse = await effectiveFilingGET(new Request(efNotFoundUrl));
  assert.equal(efNotFoundResponse.status, 404);
  const efNotFoundBody = (await efNotFoundResponse.json()) as { error: { code: string } };
  assert.equal(efNotFoundBody.error.code, 'FILING_NOT_FOUND');

  const efInvalidDateUrl = `http://localhost/api/v1/fundamentals/effective-filing?issuerId=${issuerId}&documentType=DFP&referenceDate=2025-13-40&decisionTime=${encodeURIComponent(t2)}&knowledgeTime=${encodeURIComponent(t2)}`;
  const efInvalidDateResponse = await effectiveFilingGET(new Request(efInvalidDateUrl));
  assert.equal(efInvalidDateResponse.status, 400, 'data civil inválida deve retornar 400, nunca 500');
  const efInvalidDateBody = (await efInvalidDateResponse.json()) as { error: { code: string } };
  assert.equal(efInvalidDateBody.error.code, 'INVALID_QUERY');

  const knowledgeAfterDecision = '2026-09-03T00:02:00.000Z';
  const efLookaheadUrl = `http://localhost/api/v1/fundamentals/effective-filing?issuerId=${issuerId}&documentType=DFP&referenceDate=2025-12-31&decisionTime=${encodeURIComponent(t2)}&knowledgeTime=${encodeURIComponent(knowledgeAfterDecision)}`;
  const efLookaheadResponse = await effectiveFilingGET(new Request(efLookaheadUrl));
  assert.equal(efLookaheadResponse.status, 400, 'knowledgeTime posterior a decisionTime deve falhar fechado na borda HTTP');
  const efLookaheadBody = (await efLookaheadResponse.json()) as { error: { code: string } };
  assert.equal(efLookaheadBody.error.code, 'INVALID_TIME_RANGE');

  console.log('HTTP layer (GET /api/v1/fundamentals/effective-filing): OK (200 real, 404 FILING_NOT_FOUND, 400 data civil inválida/lookahead temporal)');

  // HTTP layer: GET /api/v1/fundamentals/facts — BigInt-as-string, meta.effectiveFiling, pagination, 400s.
  const factsUrl = `http://localhost/api/v1/fundamentals/facts?issuerId=${issuerId}&documentType=DFP&referenceDate=2025-12-31&decisionTime=${encodeURIComponent(t1)}&knowledgeTime=${encodeURIComponent(t1)}&limit=100&offset=0`;
  const factsResponse = await factsGET(new Request(factsUrl));
  assert.equal(factsResponse.status, 200);
  const factsBody = (await factsResponse.json()) as {
    success: boolean;
    data: Array<{ accountCode: string; value: { raw: string } }>;
    meta: { effectiveFiling: { versionNumber: number }; limit: number; offset: number; count: number };
  };
  assert.equal(factsBody.success, true);
  assert.equal(factsBody.data.length, 2);
  const wireBigFact = factsBody.data.find((f) => f.accountCode === '1.01')!;
  assert.equal(typeof wireBigFact.value.raw, 'string', 'BigInt deve ser serializado como string, nunca number');
  assert.equal(wireBigFact.value.raw, '123456789012345');
  assert.ok(factsBody.meta.effectiveFiling, 'meta.effectiveFiling deve estar presente');
  assert.equal(factsBody.meta.effectiveFiling.versionNumber, 1);
  assert.equal(factsBody.meta.limit, 100);
  assert.equal(factsBody.meta.offset, 0);

  const factsPage0Url = `http://localhost/api/v1/fundamentals/facts?issuerId=${issuerId}&documentType=DFP&referenceDate=2025-12-31&decisionTime=${encodeURIComponent(t1)}&knowledgeTime=${encodeURIComponent(t1)}&limit=1&offset=0`;
  const factsPage1Url = `http://localhost/api/v1/fundamentals/facts?issuerId=${issuerId}&documentType=DFP&referenceDate=2025-12-31&decisionTime=${encodeURIComponent(t1)}&knowledgeTime=${encodeURIComponent(t1)}&limit=1&offset=1`;
  const factsPage0Body = (await (await factsGET(new Request(factsPage0Url))).json()) as { data: Array<{ id: string }> };
  const factsPage1Body = (await (await factsGET(new Request(factsPage1Url))).json()) as { data: Array<{ id: string }> };
  assert.equal(factsPage0Body.data.length, 1);
  assert.equal(factsPage1Body.data.length, 1);
  assert.notEqual(factsPage0Body.data[0].id, factsPage1Body.data[0].id, 'paginação HTTP deve ser determinística e disjunta');

  const factsBadLimitUrl = `http://localhost/api/v1/fundamentals/facts?issuerId=${issuerId}&documentType=DFP&referenceDate=2025-12-31&decisionTime=${encodeURIComponent(t1)}&knowledgeTime=${encodeURIComponent(t1)}&limit=abc&offset=0`;
  const factsBadLimitResponse = await factsGET(new Request(factsBadLimitUrl));
  assert.equal(factsBadLimitResponse.status, 400);
  assert.equal(((await factsBadLimitResponse.json()) as { error: { code: string } }).error.code, 'INVALID_QUERY');

  const factsExpLimitUrl = `http://localhost/api/v1/fundamentals/facts?issuerId=${issuerId}&documentType=DFP&referenceDate=2025-12-31&decisionTime=${encodeURIComponent(t1)}&knowledgeTime=${encodeURIComponent(t1)}&limit=1e2&offset=0`;
  const factsExpLimitResponse = await factsGET(new Request(factsExpLimitUrl));
  assert.equal(factsExpLimitResponse.status, 400, 'notação exponencial em limit deve ser rejeitada, nunca aceita/500');

  const factsEmptyOffsetUrl = `http://localhost/api/v1/fundamentals/facts?issuerId=${issuerId}&documentType=DFP&referenceDate=2025-12-31&decisionTime=${encodeURIComponent(t1)}&knowledgeTime=${encodeURIComponent(t1)}&limit=1&offset=`;
  const factsEmptyOffsetResponse = await factsGET(new Request(factsEmptyOffsetUrl));
  assert.equal(factsEmptyOffsetResponse.status, 400, 'offset vazio deve ser rejeitado');

  console.log('HTTP layer (GET /api/v1/fundamentals/facts): OK (BigInt string, meta.effectiveFiling, paginação, 400 limit/offset inválidos)');

  // HTTP layer: GET /api/v1/fundamentals/share-capital — exact quantity string, meta.effectiveFiling, 400s.
  const capitalUrl = `http://localhost/api/v1/fundamentals/share-capital?issuerId=${issuerId}&documentType=DFP&referenceDate=2025-12-31&decisionTime=${encodeURIComponent(t1)}&knowledgeTime=${encodeURIComponent(t1)}&limit=100&offset=0`;
  const capitalResponse = await shareCapitalGET(new Request(capitalUrl));
  assert.equal(capitalResponse.status, 200);
  const capitalBody = (await capitalResponse.json()) as {
    success: boolean;
    data: Array<{ quantity: string }>;
    meta: { effectiveFiling: { versionNumber: number } };
  };
  assert.equal(capitalBody.success, true);
  assert.equal(capitalBody.data.length, 1);
  assert.equal(typeof capitalBody.data[0].quantity, 'string');
  assert.equal(capitalBody.data[0].quantity, '9223372036854775807');
  assert.ok(capitalBody.meta.effectiveFiling);

  const capitalMissingTimeUrl = `http://localhost/api/v1/fundamentals/share-capital?issuerId=${issuerId}&documentType=DFP&referenceDate=2025-12-31&decisionTime=${encodeURIComponent(t1)}&limit=100&offset=0`;
  const capitalMissingTimeResponse = await shareCapitalGET(new Request(capitalMissingTimeUrl));
  assert.equal(capitalMissingTimeResponse.status, 400, 'ausência de knowledgeTime obrigatório deve retornar 400');

  const capitalDuplicateUrl = `${capitalUrl}&issuerId=${issuerId}`;
  const capitalDuplicateResponse = await shareCapitalGET(new Request(capitalDuplicateUrl));
  assert.equal(capitalDuplicateResponse.status, 400, 'parâmetro duplicado deve retornar 400');

  console.log('HTTP layer (GET /api/v1/fundamentals/share-capital): OK (quantity string exato, meta.effectiveFiling, 400 tempo ausente/duplicado)');
}

async function marketBarsTests(prisma: PrismaClient): Promise<void> {
  const t0 = '2026-01-01T00:00:00.000Z';
  const t1 = '2026-01-01T00:01:00.000Z';
  const ivId = await seedInstrumentVersion(prisma, 'VALE3', 'B3', t0, t0, t1);
  const svc = service(prisma);
  const mbUow = new PrismaMarketBarIngestionUnitOfWork(prisma);

  const bar = (overrides: Partial<VersionedMarketBarSubmission>): VersionedMarketBarSubmission => ({
    instrumentVersionId: ivId,
    sourceRecordKey: 'default',
    timeframe: '1d',
    openedAt: '2026-07-01T00:00:00.000Z',
    closedAt: '2026-07-02T00:00:00.000Z',
    sourceAvailableAt: '2026-07-02T00:00:00.000Z',
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
    rawSha256: 'd'.repeat(64),
    isRevision: false,
    ...overrides,
  });

  const runA = await mbUow.begin(MB_SOURCE, '2026-09-05T01:00:00.000Z');
  const tA = '2026-09-05T01:01:00.000Z';
  await mbUow.commit(runA, tA, '{"message":"day1"}', {
    bars: [
      bar({ sourceRecordKey: 'day1' }),
      bar({ sourceRecordKey: 'day2', openedAt: '2026-07-02T00:00:00.000Z', closedAt: '2026-07-03T00:00:00.000Z', sourceAvailableAt: '2026-07-03T00:00:00.000Z' }),
    ],
  });

  const bars = await svc.getMarketBars({ instrumentVersionId: ivId, sourceKey: MB_SOURCE, timeframe: '1d', from: '2026-07-01T00:00:00.000Z', to: '2026-07-03T00:00:00.000Z', decisionTime: tA, knowledgeTime: tA, limit: 5000 });
  assert.equal(bars.length, 2);
  assert.equal(bars[0].open.raw, '1000');
  assert.equal(bars[0].open.decimal, '10.00');
  assert.equal(bars[0].provenance.sourceKey, MB_SOURCE);

  // Range/timeframe limit rejected before querying: 2 daily bars need limit>=2.
  await expectError(
    svc.getMarketBars({ instrumentVersionId: ivId, sourceKey: MB_SOURCE, timeframe: '1d', from: '2026-07-01T00:00:00.000Z', to: '2026-07-03T00:00:00.000Z', decisionTime: tA, knowledgeTime: tA, limit: 1 }),
    'RESULT_LIMIT_EXCEEDED',
    'theoretical interval count exceeds limit',
  );

  // Revision: a future revision must not suppress its still-visible predecessor at an earlier knowledgeTime.
  const runB = await mbUow.begin(MB_SOURCE, '2026-09-06T00:00:00.000Z');
  const tB = '2026-09-06T00:01:00.000Z';
  await mbUow.commit(runB, tB, '{"message":"revision of day1"}', {
    bars: [bar({ sourceRecordKey: 'day1-rev', openedAt: '2026-07-01T00:00:00.000Z', closedAt: '2026-07-02T00:00:00.000Z', sourceAvailableAt: '2026-07-02T12:00:00.000Z', isRevision: true, supersedesSourceRecordKey: 'day1', openRaw: BigInt(1234), highRaw: BigInt(1300), rawSha256: 'e'.repeat(64) })],
  });

  const barsAtOldKnowledge = await svc.getMarketBars({ instrumentVersionId: ivId, sourceKey: MB_SOURCE, timeframe: '1d', from: '2026-07-01T00:00:00.000Z', to: '2026-07-02T00:00:00.000Z', decisionTime: tA, knowledgeTime: tA, limit: 5000 });
  assert.equal(barsAtOldKnowledge.length, 1);
  assert.equal(barsAtOldKnowledge[0].open.raw, '1000', 'revisão futura não pode suprimir predecessor ainda visível');

  const barsAtNewKnowledge = await svc.getMarketBars({ instrumentVersionId: ivId, sourceKey: MB_SOURCE, timeframe: '1d', from: '2026-07-01T00:00:00.000Z', to: '2026-07-02T00:00:00.000Z', decisionTime: tB, knowledgeTime: tB, limit: 5000 });
  assert.equal(barsAtNewKnowledge.length, 1);
  assert.equal(barsAtNewKnowledge[0].open.raw, '1234', 'revisão visível deve substituir o predecessor');
  assert.equal(barsAtNewKnowledge[0].revisionNumber, 2);

  // Sources never mix: a different sourceKey for the same instrument/day is invisible under this query.
  const OTHER_SOURCE = 'mt5:other-source';
  const runC = await mbUow.begin(OTHER_SOURCE, '2026-09-07T00:00:00.000Z');
  const tC = '2026-09-07T00:01:00.000Z';
  await mbUow.commit(runC, tC, '{"message":"other source"}', {
    bars: [bar({ sourceRecordKey: 'other-day1', openedAt: '2026-07-01T00:00:00.000Z', closedAt: '2026-07-02T00:00:00.000Z', sourceAvailableAt: '2026-07-02T00:00:00.000Z', openRaw: BigInt(9999), highRaw: BigInt(10000) })],
  });
  const onlyPrimarySource = await svc.getMarketBars({ instrumentVersionId: ivId, sourceKey: MB_SOURCE, timeframe: '1d', from: '2026-07-01T00:00:00.000Z', to: '2026-07-02T00:00:00.000Z', decisionTime: tC, knowledgeTime: tC, limit: 5000 });
  assert.equal(onlyPrimarySource.length, 1);
  assert.notEqual(onlyPrimarySource[0].open.raw, '9999', 'fontes de barra não podem se misturar');

  // Invalid time range: from >= to.
  await expectError(
    svc.getMarketBars({ instrumentVersionId: ivId, sourceKey: MB_SOURCE, timeframe: '1d', from: '2026-07-02T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z', decisionTime: tC, knowledgeTime: tC, limit: 5000 }),
    'INVALID_TIME_RANGE',
    'from >= to',
  );

  console.log('market-bars: OK (limite/timeframe fail-closed, revisão futura não suprime predecessor, fontes não se misturam, provenance correta)');

  // HTTP layer: GET /api/v1/market-bars — real wire round-trip, exact DTO shape (finding 3).
  const mbUrl = `http://localhost/api/v1/market-bars?instrumentVersionId=${ivId}&sourceKey=${encodeURIComponent(MB_SOURCE)}&timeframe=1d&from=${encodeURIComponent('2026-07-01T00:00:00.000Z')}&to=${encodeURIComponent('2026-07-03T00:00:00.000Z')}&decisionTime=${encodeURIComponent(tA)}&knowledgeTime=${encodeURIComponent(tA)}&limit=5000`;
  const mbResponse = await marketBarsGET(new Request(mbUrl));
  assert.equal(mbResponse.status, 200);
  const mbBody = (await mbResponse.json()) as {
    success: boolean;
    data: Array<{
      open: { raw: string };
      sourceKey: string;
      sourceRecordKey: string;
      sourceAvailableAt: string;
      rawSha256: string;
      volumeSemantics: string;
      provenance: { runId: string; sourceKey: string; completedAt: string };
    }>;
  };
  assert.equal(mbBody.success, true);
  assert.equal(mbBody.data.length, 2);
  const wireBar = mbBody.data[0];
  assert.equal(typeof wireBar.open.raw, 'string', 'BigInt deve ser serializado como string');
  assert.equal(wireBar.sourceKey, MB_SOURCE, 'sourceKey deve estar na raiz do DTO (finding 3)');
  assert.equal(wireBar.sourceRecordKey, 'day1', 'sourceRecordKey deve estar na raiz do DTO, não em provenance');
  assert.ok(wireBar.sourceAvailableAt, 'sourceAvailableAt deve estar na raiz do DTO');
  assert.match(wireBar.rawSha256, /^[0-9a-f]{64}$/, 'rawSha256 deve estar na raiz do DTO');
  assert.equal(wireBar.volumeSemantics, 'SHARES', 'volumeSemantics deve estar na raiz do DTO');
  assert.deepEqual(
    Object.keys(wireBar.provenance).sort(),
    ['completedAt', 'runId', 'sourceKey'],
    'provenance deve conter SOMENTE runId/sourceKey/completedAt (RunProvenanceDTO), nunca sourceRecordKey/rawSha256',
  );
  assert.equal(wireBar.provenance.sourceKey, MB_SOURCE, 'provenance.sourceKey deve coincidir com o sourceKey de raiz (mesma run)');

  const mbLimitExceededUrl = `http://localhost/api/v1/market-bars?instrumentVersionId=${ivId}&sourceKey=${encodeURIComponent(MB_SOURCE)}&timeframe=1d&from=${encodeURIComponent('2026-07-01T00:00:00.000Z')}&to=${encodeURIComponent('2026-07-03T00:00:00.000Z')}&decisionTime=${encodeURIComponent(tA)}&knowledgeTime=${encodeURIComponent(tA)}&limit=1`;
  const mbLimitExceededResponse = await marketBarsGET(new Request(mbLimitExceededUrl));
  assert.equal(mbLimitExceededResponse.status, 400);
  const mbLimitExceededBody = (await mbLimitExceededResponse.json()) as { error: { code: string } };
  assert.equal(mbLimitExceededBody.error.code, 'RESULT_LIMIT_EXCEEDED');

  const mbInvalidTimeframeUrl = `http://localhost/api/v1/market-bars?instrumentVersionId=${ivId}&sourceKey=${encodeURIComponent(MB_SOURCE)}&timeframe=2d&from=${encodeURIComponent('2026-07-01T00:00:00.000Z')}&to=${encodeURIComponent('2026-07-03T00:00:00.000Z')}&decisionTime=${encodeURIComponent(tA)}&knowledgeTime=${encodeURIComponent(tA)}&limit=5000`;
  const mbInvalidTimeframeResponse = await marketBarsGET(new Request(mbInvalidTimeframeUrl));
  assert.equal(mbInvalidTimeframeResponse.status, 400, 'timeframe fora do enum canônico deve retornar 400, nunca 500');

  console.log('HTTP layer (GET /api/v1/market-bars): OK (DTO com sourceKey/sourceRecordKey/rawSha256/volumeSemantics na raiz, provenance só runId/sourceKey/completedAt, 400 RESULT_LIMIT_EXCEEDED/timeframe inválido)');
}

/**
 * Finding 4: fail-closed ambiguity, exercised at the service layer with a
 * fake InstrumentRepository that deliberately returns two versions for
 * the same query. No real database/adapter is involved — this asserts
 * the service's own contract (never the repository's non-overlap
 * invariant, which is what the wire test above relies on instead).
 */
async function ambiguousInstrumentServiceTest(): Promise<void> {
  const unreachable = async (): Promise<never> => {
    throw new Error('não deveria ser chamado: a ambiguidade deve ser detectada antes de qualquer outra dependência');
  };
  const fakeVersion = (id: string, createdByRunId: string) => ({
    id,
    symbol: 'PETR4',
    exchange: 'B3',
    currency: 'BRL',
    displayName: 'PETR4',
    assetClass: 'equity',
    status: 'ACTIVE',
    priceScalePow: null,
    quantityScalePow: null,
    lotSize: null,
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: null,
    validFromBasis: 'SOURCE_EFFECTIVE',
    issuerId: null,
    createdByRunId,
  });

  const svc = new ReadModelV1Service({
    instrumentRepository: {
      findInstrumentVersions: async () => [fakeVersion('iv-fake-1', 'run-fake-1'), fakeVersion('iv-fake-2', 'run-fake-2')],
    } as unknown as ConstructorParameters<typeof ReadModelV1Service>[0]['instrumentRepository'],
    cvmFilingRepository: { findEffectiveFiling: unreachable } as unknown as ConstructorParameters<typeof ReadModelV1Service>[0]['cvmFilingRepository'],
    cvmFactRepository: { findFacts: unreachable } as unknown as ConstructorParameters<typeof ReadModelV1Service>[0]['cvmFactRepository'],
    shareCapitalFactRepository: { findShareCapitalFacts: unreachable } as unknown as ConstructorParameters<typeof ReadModelV1Service>[0]['shareCapitalFactRepository'],
    marketBarRepository: { findBars: unreachable } as unknown as ConstructorParameters<typeof ReadModelV1Service>[0]['marketBarRepository'],
    ingestionLedger: { getRun: unreachable } as unknown as ConstructorParameters<typeof ReadModelV1Service>[0]['ingestionLedger'],
  });

  await expectError(
    svc.getInstrument({ symbol: 'PETR4', exchange: 'B3', asOf: '2026-01-01T00:00:00.000Z', knowledgeTime: '2026-01-01T00:00:00.000Z' }),
    'AMBIGUOUS_INSTRUMENT_VERSION',
    'fake repository returns two versions for the same query (fail-closed)',
  );
  console.log('ambiguity (service, fake repository): OK (AMBIGUOUS_INSTRUMENT_VERSION fail-closed, sem tocar ledger/outros ports)');
}

/**
 * Finding 5: an unexpected exception at the Prisma boundary (monkeypatched
 * to simulate a driver failure carrying sensitive text) must surface as a
 * sanitized 500 INTERNAL_ERROR — never leaking the original message, a
 * stack trace, or any mention of Prisma/SQL. Restores the original method
 * in `finally` even if an assertion fails.
 */
async function internalErrorSanitizationHttpTest(): Promise<void> {
  const original = appPrisma.instrumentVersion.findMany.bind(appPrisma.instrumentVersion);
  const sensitive = 'password=hunter2 at internal db host; SELECT * FROM secrets;';
  (appPrisma.instrumentVersion as unknown as { findMany: unknown }).findMany = async () => {
    throw new Error(sensitive);
  };
  try {
    const url = 'http://localhost/api/v1/reference/instrument?symbol=PETR4&exchange=B3&asOf=2026-09-01T00:01:00.000Z&knowledgeTime=2026-09-01T00:01:00.000Z';
    const response = await instrumentGET(new Request(url));
    assert.equal(response.status, 500);
    const body = (await response.json()) as { success: boolean; error: { code: string; message: string } };
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    const raw = JSON.stringify(body);
    assert.doesNotMatch(raw, /hunter2/i, 'senha sensível não pode vazar na resposta');
    assert.doesNotMatch(raw, /password=/i, 'credencial não pode vazar na resposta');
    assert.doesNotMatch(raw, /internal db host/i, 'detalhe de host interno não pode vazar na resposta');
    assert.doesNotMatch(raw, /select\s+\*|prisma|\bsql\b|at\s+\S+\.(ts|js):\d+/i, 'stack trace / SQL / Prisma não podem vazar na resposta');
  } finally {
    (appPrisma.instrumentVersion as unknown as { findMany: unknown }).findMany = original;
  }
  console.log('internal error sanitization (HTTP): OK (500 INTERNAL_ERROR, sem vazamento de detalhes sensíveis/stack/SQL/Prisma)');
}

async function internalErrorSanitizationTest(prisma: PrismaClient): Promise<void> {
  // Force a provenance inconsistency: a run that never completed cannot produce a valid RunProvenanceDTO.
  const uow = new PrismaReferenceDataIngestionUnitOfWork(prisma);
  const runId = await uow.begin('reference:broken', '2026-09-08T00:00:00.000Z');
  // Deliberately do not commit; the run stays RUNNING forever (simulated inconsistency path is exercised
  // indirectly: getRun on a RUNNING run must trigger the service's INTERNAL_ERROR guard).
  const ledger = new PrismaIngestionLedger(prisma);
  const run = await ledger.getRun(runId);
  assert.equal(run?.status, 'RUNNING');

  const svc = service(prisma);
  // No public read model surfaces a row created by a RUNNING run (visibility guards this out already),
  // so we instead validate the guard directly via the provenance resolver's documented contract: it must
  // reject a run that is not SUCCEEDED/completedAt-null even if a caller could otherwise reach it.
  const { ProvenanceResolver } = await import('../../src/application/read-models-v1');
  const resolver = new ProvenanceResolver(ledger);
  await expectError(resolver.resolve(runId), 'INTERNAL_ERROR', 'provenance resolution for a non-SUCCEEDED run');
  void svc;
  console.log('internal error sanitization: OK (inconsistência de proveniência vira INTERNAL_ERROR sanitizado)');
}

async function main(): Promise<void> {
  scaledDecimalTests();
  noNonGetExportsTest();
  noLegacyFileModifiedTest();

  await ambiguousInstrumentServiceTest();

  const prisma = new PrismaClient();
  try {
    await instrumentEndpointTests(prisma);
    await effectiveFilingAndFactsTests(prisma);
    await marketBarsTests(prisma);
    await internalErrorSanitizationTest(prisma);
    await internalErrorSanitizationHttpTest();
  } finally {
    await prisma.$disconnect();
  }
  console.log('Fase 2 / Item 4 — read models v1: TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
