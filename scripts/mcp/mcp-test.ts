import assert from 'node:assert/strict';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createAgentRunService } from '../../src/application/agent-run';
import { createRiskPolicyService } from '../../src/application/risk-policy';
import { createOrderIntentService } from '../../src/application/order-intent';
import { PrismaAgentRunRepository } from '../../src/adapters/prisma/agent-run';
import { PrismaRiskPolicyRepository } from '../../src/adapters/prisma/risk-policy';
import { PrismaOrderIntentRepository } from '../../src/adapters/prisma/order-intent';
import { PrismaReferenceDataIngestionUnitOfWork, PrismaInstrumentRepository } from '../../src/adapters/prisma/reference-data';
import { PrismaCvmIngestionUnitOfWork, PrismaCvmFilingRepository } from '../../src/adapters/prisma/cvm';
import { PrismaMarketBarIngestionUnitOfWork } from '../../src/adapters/prisma/market-bar';
import type { VersionedMarketBarSubmission } from '../../src/domain/v1/models/versioned-market-bar';
import type { AgentRunDag } from '../../src/domain/v1/models/agent-run';
import type { RiskEvaluationContext, RiskPolicyConfig, TradeProposal } from '../../src/domain/v1/models/risk-policy';
import type { OrderIntentConfig } from '../../src/domain/v1/models/order-intent';
import { createMcpReadServices } from '../../src/mcp/ports/mcp-read-service';
import { buildToolRegistry } from '../../src/mcp/tools/registry';
import { resolveMcpConfigFromEnv, McpConfigError } from '../../src/mcp/config';

const REF_SOURCE = 'reference:mcp-test-seed';
const CVM_SOURCE = 'cvm:mcp-test-seed';
const MB_SOURCE = 'mt5:mcp-test-seed';

// ---------------------------------------------------------------------------
// Fixture seeding (reuses the same adapters/unit-of-work classes exercised by
// scripts/read-models-v1, scripts/agent-run, scripts/risk-policy and
// scripts/order-intent — never a raw SQL insert).
// ---------------------------------------------------------------------------

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

async function seedCvmFiling(prisma: PrismaClient, issuerCvmCode: string, startedAt: string, completedAt: string): Promise<{ issuerId: string }> {
  const uow = new PrismaCvmIngestionUnitOfWork(prisma);
  const filingRepo = new PrismaCvmFilingRepository(prisma);
  const filing = {
    issuerCvmCode,
    documentType: 'DFP' as const,
    cvmProtocol: `PROTO-MCP-${issuerCvmCode}`,
    referenceDate: '2025-12-31',
    fiscalYear: 2025,
    fiscalQuarter: null,
    filedAt: '2026-03-01T00:00:00.000Z',
    publishedAt: '2026-03-02T00:00:00.000Z',
    isRestatement: false,
    sourceUrl: 'https://cvm.example/mcp-test',
    rawSha256: 'b'.repeat(64),
  };
  const fact = {
    filingCvmProtocol: filing.cvmProtocol,
    statementType: 'BPA' as const,
    scope: 'CON' as const,
    accountCode: '1.01',
    accountLabel: 'Caixa',
    periodStart: '2025-12-31',
    periodEnd: '2025-12-31',
    durationType: 'INSTANT' as const,
    valueRaw: BigInt('123456'),
    scalePow: -2,
    originalScale: 'UNIT' as const,
    currency: 'BRL',
    quality: 'AUDITED' as const,
  };
  const runId = await uow.begin(CVM_SOURCE, startedAt);
  await uow.commit(runId, completedAt, '{"message":"seed cvm"}', { filings: [filing], facts: [fact], shareCapitalFacts: [] });
  const savedFiling = await filingRepo.getFilingByCvmProtocol(filing.cvmProtocol, { decisionTime: completedAt, knowledgeTime: completedAt });
  if (!savedFiling) throw new Error('seedCvmFiling: filing não encontrada');
  return { issuerId: savedFiling.issuerId };
}

async function seedMarketBar(
  prisma: PrismaClient,
  instrumentVersionId: string,
  openedAt: string,
  closedAt: string,
  startedAt: string,
  completedAt: string,
): Promise<void> {
  const uow = new PrismaMarketBarIngestionUnitOfWork(prisma);
  const bar: VersionedMarketBarSubmission = {
    instrumentVersionId,
    sourceRecordKey: `mcp-test:${openedAt}`,
    timeframe: '1d',
    openedAt,
    closedAt,
    sourceAvailableAt: completedAt,
    openRaw: BigInt(3000),
    highRaw: BigInt(3100),
    lowRaw: BigInt(2900),
    closeRaw: BigInt(3050),
    priceScalePow: -2,
    volumeRaw: BigInt(1000000),
    volumeScalePow: 0,
    volumeSemantics: 'SHARES',
    tradeCount: null,
    priceBasis: 'TRADE',
    quality: 'FINAL',
    rawSha256: 'c'.repeat(64),
    isRevision: false,
  };
  const runId = await uow.begin(MB_SOURCE, startedAt);
  await uow.commit(runId, completedAt, '{"message":"seed bar"}', { bars: [bar] });
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

const PROPOSAL: TradeProposal = {
  kind: 'PROPOSAL',
  instrumentId: 'PETR4',
  direction: 'BUY',
  rationale: 'Fixture MCP determinística',
  risks: ['risco de mercado'],
  confidence: 0.7,
  decisionTime: '2099-01-01T00:00:00.000Z',
  requiresHumanApproval: true,
};

const CONTEXT: RiskEvaluationContext = {
  referencePrice: 30,
  proposedQuantity: 100,
  currentPositionQty: 0,
  portfolioNav: 1_000_000,
  limits: {
    maxNotional: 100_000,
    maxPositionConcentrationPct: 50,
    maxProposalsPerRun: 10,
    instrumentAllowlist: ['PETR4', 'VALE3'],
  },
};

const RISK_ENABLED: RiskPolicyConfig = { tradingEnabled: true, policyVersion: 'risk-policy/v1' };
const INTENT_ENABLED: OrderIntentConfig = { tradingEnabled: true, policyVersion: 'order-intent/v1' };

interface RuntimeFixtures {
  readonly runId: string;
  readonly decisionId: string;
  readonly intentId: string;
}

async function seedRuntimeFixtures(prisma: PrismaClient): Promise<RuntimeFixtures> {
  const agentRunService = createAgentRunService(prisma);
  const run = await agentRunService.submit({
    requestedBy: 'mcp-test',
    kind: 'RESEARCH',
    dag: DAG,
    input: { ticker: 'PETR4' },
    decisionTime: '2099-01-01T00:00:00.000Z',
  });
  await agentRunService.advance(run.runId);

  const riskPolicyService = createRiskPolicyService(prisma);
  const decisionResult = await riskPolicyService.evaluate(
    { runId: run.runId, requestedBy: 'mcp-test', proposal: PROPOSAL, context: CONTEXT, decisionTime: PROPOSAL.decisionTime },
    RISK_ENABLED,
  );

  const orderIntentService = createOrderIntentService(prisma);
  const { intent } = await orderIntentService.create(
    {
      decisionId: decisionResult.decisionId,
      idempotencyKey: `mcp-test:${decisionResult.decisionId}`,
      quantity: 100,
      decisionTime: PROPOSAL.decisionTime,
      requestedBy: 'mcp-test',
      approvedBy: 'approver-mcp-test',
    },
    INTENT_ENABLED,
  );

  return { runId: run.runId, decisionId: decisionResult.decisionId, intentId: intent.intentId };
}

// ---------------------------------------------------------------------------
// R-LO-1 — read-only guarantee: spy on every write method of the repository
// classes reused by the MCP facade. If any tool call invokes save*/create*/
// update*/cancel*/execute*, the test fails.
// ---------------------------------------------------------------------------

async function readOnlyGuaranteeTest(prisma: PrismaClient, fixtures: RuntimeFixtures): Promise<void> {
  const calls: string[] = [];
  const record = (label: string) => () => {
    calls.push(label);
    throw new Error(`write method invoked by MCP tool: ${label}`);
  };

  const patched: Array<{ obj: unknown; key: string; original: unknown }> = [];
  function patch(obj: Record<string, unknown>, key: string, label: string): void {
    patched.push({ obj, key, original: obj[key] });
    obj[key] = record(label);
  }

  patch(PrismaAgentRunRepository.prototype as unknown as Record<string, unknown>, 'create', 'AgentRunRepository.create');
  patch(PrismaAgentRunRepository.prototype as unknown as Record<string, unknown>, 'transitionTo', 'AgentRunRepository.transitionTo');
  patch(PrismaAgentRunRepository.prototype as unknown as Record<string, unknown>, 'recordProgress', 'AgentRunRepository.recordProgress');
  patch(PrismaRiskPolicyRepository.prototype as unknown as Record<string, unknown>, 'saveDecision', 'RiskPolicyRepository.saveDecision');
  patch(PrismaOrderIntentRepository.prototype as unknown as Record<string, unknown>, 'saveApproval', 'OrderIntentRepository.saveApproval');
  patch(PrismaOrderIntentRepository.prototype as unknown as Record<string, unknown>, 'saveIntent', 'OrderIntentRepository.saveIntent');
  patch(PrismaOrderIntentRepository.prototype as unknown as Record<string, unknown>, 'cancelIntent', 'OrderIntentRepository.cancelIntent');

  try {
    const services = createMcpReadServices(prisma);
    const tools = buildToolRegistry(services);
    assert.ok(tools.length >= 8, `esperava >= 8 tools registradas, encontrou ${tools.length}`);

    const argsByTool: Record<string, Record<string, unknown>> = {
      'cvm.get_facts': { issuerId: 'nonexistent', documentType: 'DFP', referenceDate: '2025-12-31', decisionTime: '2026-01-01T00:00:00.000Z', knowledgeTime: '2026-01-01T00:00:00.000Z', limit: 10, offset: 0 },
      'b3.get_instrument': { symbol: 'PETR4', exchange: 'B3', asOf: '2026-01-01T00:00:00.000Z', knowledgeTime: '2026-01-01T00:00:00.000Z' },
      'market.get_bars': { instrumentVersionId: 'nonexistent', sourceKey: MB_SOURCE, timeframe: '1d', from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z', decisionTime: '2026-01-02T00:00:00.000Z', knowledgeTime: '2026-01-02T00:00:00.000Z', limit: 10 },
      'agent_run.get': { runId: fixtures.runId },
      'risk_decision.get': { decisionId: fixtures.decisionId },
      'order_intent.get': { intentId: fixtures.intentId },
      'reconciliation.report': { decisionTime: '2026-01-01T00:00:00.000Z' },
      'dataset.feature_values': { limit: 10 },
    };

    for (const tool of tools) {
      const args = argsByTool[tool.name] ?? {};
      // Tool handlers already translate thrown errors into `isError: true`;
      // no exception is expected here regardless of whether the fixture
      // resolves to a hit or a miss — only the write-method spies (which
      // throw synchronously) would surface as an uncaught rejection.
      await tool.handler(args);
    }

    assert.deepEqual(calls, [], `métodos de escrita foram invocados por tools MCP: ${calls.join(', ')}`);
    console.log('R-LO-1 (read-only garantido): OK (nenhuma tool MCP invocou save*/create*/update*/cancel*/execute*)');
  } finally {
    for (const { obj, key, original } of patched) {
      (obj as Record<string, unknown>)[key] = original;
    }
  }
}

// ---------------------------------------------------------------------------
// R-LO-2 — cvm.get_facts point-in-time
// ---------------------------------------------------------------------------

async function cvmPointInTimeTest(prisma: PrismaClient): Promise<void> {
  const t0 = '2026-10-01T00:00:00.000Z';
  const t1 = '2026-10-01T00:01:00.000Z';
  await seedIssuer(prisma, '70001', 'Empresa MCP1', t0, t1);
  const { issuerId } = await seedCvmFiling(prisma, '70001', t1, '2026-10-01T00:02:00.000Z');

  const services = createMcpReadServices(prisma);
  const tools = buildToolRegistry(services);
  const tool = tools.find((t) => t.name === 'cvm.get_facts');
  if (!tool) throw new Error('cvm.get_facts não registrada');

  const before = await tool.handler({
    issuerId, documentType: 'DFP', referenceDate: '2025-12-31',
    decisionTime: t1, knowledgeTime: t1, limit: 10, offset: 0,
  });
  assert.equal(before.isError, true, 'antes do knowledgeTime da ingestão, filing não deve estar visível');

  const after = await tool.handler({
    issuerId, documentType: 'DFP', referenceDate: '2025-12-31',
    decisionTime: '2026-10-01T00:02:00.000Z', knowledgeTime: '2026-10-01T00:02:00.000Z', limit: 10, offset: 0,
  });
  assert.equal(after.isError, undefined, 'após o knowledgeTime da ingestão, filing deve estar visível');
  const afterBody = JSON.parse(after.content[0].text) as { facts: readonly { accountCode: string }[] };
  assert.ok(afterBody.facts.some((f) => f.accountCode === '1.01'));
  console.log('R-LO-2 (cvm.get_facts point-in-time): OK (fato só aparece a partir do knowledgeTime da ingestão)');
}

// ---------------------------------------------------------------------------
// R-LO-3 — market.get_bars sem lookahead
// ---------------------------------------------------------------------------

async function marketBarNoLookaheadTest(prisma: PrismaClient): Promise<void> {
  const t0 = '2026-10-02T00:00:00.000Z';
  const t1 = '2026-10-02T00:01:00.000Z';
  const instrumentVersionId = await seedInstrumentVersion(prisma, 'VALE3', 'B3', t0, t0, t1);

  const barOpenedAt = '2026-10-02T00:00:00.000Z';
  const barClosedAt = '2026-10-03T00:00:00.000Z';
  const ingestedAt = '2026-10-03T00:05:00.000Z';
  await seedMarketBar(prisma, instrumentVersionId, barOpenedAt, barClosedAt, '2026-10-03T00:04:00.000Z', ingestedAt);

  const services = createMcpReadServices(prisma);
  const tools = buildToolRegistry(services);
  const tool = tools.find((t) => t.name === 'market.get_bars');
  if (!tool) throw new Error('market.get_bars não registrada');

  const beforeIngestion = await tool.handler({
    instrumentVersionId, sourceKey: MB_SOURCE, timeframe: '1d',
    from: '2026-10-01T00:00:00.000Z', to: '2026-10-04T00:00:00.000Z',
    decisionTime: '2026-10-03T00:00:00.000Z', knowledgeTime: '2026-10-03T00:00:00.000Z', limit: 10,
  });
  assert.equal(beforeIngestion.isError, undefined);
  const beforeBody = JSON.parse(beforeIngestion.content[0].text) as readonly unknown[];
  assert.equal(beforeBody.length, 0, 'antes do knowledgeTime de ingestão da barra, nenhuma barra deve ser visível (sem lookahead)');

  const afterIngestion = await tool.handler({
    instrumentVersionId, sourceKey: MB_SOURCE, timeframe: '1d',
    from: '2026-10-01T00:00:00.000Z', to: '2026-10-04T00:00:00.000Z',
    decisionTime: ingestedAt, knowledgeTime: ingestedAt, limit: 10,
  });
  assert.equal(afterIngestion.isError, undefined);
  const afterBody = JSON.parse(afterIngestion.content[0].text) as readonly { openedAt: string }[];
  assert.equal(afterBody.length, 1);
  assert.equal(afterBody[0].openedAt, new Date(barOpenedAt).toISOString());
  console.log('R-LO-3 (market.get_bars sem lookahead): OK (nenhuma barra com knowledgeTime > consulta)');
}

// ---------------------------------------------------------------------------
// R-LO-4 — agent_run.get / risk_decision.get / order_intent.get
// ---------------------------------------------------------------------------

async function runtimeReadTest(prisma: PrismaClient, fixtures: RuntimeFixtures): Promise<void> {
  const services = createMcpReadServices(prisma);
  const tools = buildToolRegistry(services);

  const agentRunTool = tools.find((t) => t.name === 'agent_run.get')!;
  const runResult = await agentRunTool.handler({ runId: fixtures.runId });
  assert.equal(runResult.isError, undefined);
  const runBody = JSON.parse(runResult.content[0].text) as { runId: string; status: string };
  assert.equal(runBody.runId, fixtures.runId);
  assert.equal(runBody.status, 'SUCCEEDED');

  const riskTool = tools.find((t) => t.name === 'risk_decision.get')!;
  const decisionResult = await riskTool.handler({ decisionId: fixtures.decisionId });
  assert.equal(decisionResult.isError, undefined);
  const decisionBody = JSON.parse(decisionResult.content[0].text) as { decisionId: string; outcome: string };
  assert.equal(decisionBody.decisionId, fixtures.decisionId);
  assert.equal(decisionBody.outcome, 'APPROVED');

  const intentTool = tools.find((t) => t.name === 'order_intent.get')!;
  const intentResult = await intentTool.handler({ intentId: fixtures.intentId });
  assert.equal(intentResult.isError, undefined);
  const intentBody = JSON.parse(intentResult.content[0].text) as { intentId: string; status: string };
  assert.equal(intentBody.intentId, fixtures.intentId);
  assert.equal(intentBody.status, 'CREATED');

  const listByRun = await riskTool.handler({ runId: fixtures.runId });
  assert.equal(listByRun.isError, undefined);
  const listByRunBody = JSON.parse(listByRun.content[0].text) as readonly { decisionId: string }[];
  assert.ok(listByRunBody.some((d) => d.decisionId === fixtures.decisionId));

  console.log('R-LO-4 (agent_run/risk_decision/order_intent .get): OK (fixtures das Fases 2/3 retornadas fielmente)');
}

// ---------------------------------------------------------------------------
// R-LO-5 — contrato estável (b3.get_instrument)
// ---------------------------------------------------------------------------

async function stableContractTest(prisma: PrismaClient): Promise<void> {
  const t0 = '2026-10-04T00:00:00.000Z';
  const t1 = '2026-10-04T00:01:00.000Z';
  await seedInstrumentVersion(prisma, 'ITUB4', 'B3', t0, t0, t1);

  const services = createMcpReadServices(prisma);
  const tools = buildToolRegistry(services);
  const tool = tools.find((t) => t.name === 'b3.get_instrument')!;
  const result = await tool.handler({ symbol: 'ITUB4', exchange: 'B3', asOf: t1, knowledgeTime: t1 });
  assert.equal(result.isError, undefined);
  const body = JSON.parse(result.content[0].text) as {
    id: string; symbol: string; exchange: string; currency: string; status: string; provenance: { runId: string; sourceKey: string; completedAt: string };
  };
  for (const field of ['id', 'symbol', 'exchange', 'currency', 'status'] as const) {
    assert.notEqual(body[field], null, `campo obrigatório ausente/nulo: ${field}`);
    assert.notEqual(body[field], undefined, `campo obrigatório ausente/nulo: ${field}`);
  }
  assert.ok(body.provenance.runId.length > 0);
  assert.ok(body.provenance.sourceKey.length > 0);
  console.log('R-LO-5 (contrato estável b3.get_instrument): OK (sem null inesperado, campos obrigatórios presentes)');
  console.log(
    'R-LO-5 desvio reportado: portfolio.snapshot NÃO implementada — não existe application service de leitura ' +
    'para PortfolioProvider (só o adapter MT5 ao vivo), e a regra 6 da spec proíbe inventar consulta Prisma fora dos adapters existentes.',
  );
}

// ---------------------------------------------------------------------------
// R-LO-6 — entrada inválida -> isError sanitizado
// ---------------------------------------------------------------------------

async function invalidInputSanitizedTest(prisma: PrismaClient): Promise<void> {
  const services = createMcpReadServices(prisma);
  const tools = buildToolRegistry(services);

  const agentRunTool = tools.find((t) => t.name === 'agent_run.get')!;
  const missingRun = await agentRunTool.handler({ runId: 'does-not-exist' });
  assert.equal(missingRun.isError, true);
  const missingRunBody = JSON.parse(missingRun.content[0].text) as { code: string; message: string };
  assert.equal(missingRunBody.code, 'AGENT_RUN_NOT_FOUND');
  assert.doesNotMatch(missingRunBody.message, /prisma|sql|at\s+\S+\.(ts|js):\d+/i, 'mensagem de erro não pode vazar stack/SQL');

  const cvmTool = tools.find((t) => t.name === 'cvm.get_facts')!;
  const invalidTime = await cvmTool.handler({
    issuerId: 'x', documentType: 'DFP', referenceDate: '2025-12-31',
    decisionTime: 'not-a-timestamp', knowledgeTime: 'not-a-timestamp', limit: 10, offset: 0,
  });
  assert.equal(invalidTime.isError, true);
  const invalidTimeBody = JSON.parse(invalidTime.content[0].text) as { code: string; message: string };
  assert.equal(invalidTimeBody.code, 'INVALID_QUERY');
  assert.doesNotMatch(invalidTimeBody.message, /prisma|sql|at\s+\S+\.(ts|js):\d+/i);

  const runtimeTool = tools.find((t) => t.name === 'risk_decision.get')!;
  const missingSelector = await runtimeTool.handler({});
  assert.equal(missingSelector.isError, true);
  const missingSelectorBody = JSON.parse(missingSelector.content[0].text) as { code: string };
  assert.equal(missingSelectorBody.code, 'INVALID_QUERY');

  console.log('R-LO-6 (entrada inválida sanitizada): OK (isError: true, sem stack/SQL, code estável)');
}

// ---------------------------------------------------------------------------
// R-LO-7 — WR_MCP_TRANSPORT=http sem token -> fail-closed
// ---------------------------------------------------------------------------

function fakeEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, WR_MCP_TRANSPORT: undefined, WR_MCP_HTTP_TOKEN: undefined, WR_MCP_HTTP_PORT: undefined, ...overrides };
}

function failClosedHttpTest(): void {
  assert.throws(
    () => resolveMcpConfigFromEnv(fakeEnv({ WR_MCP_TRANSPORT: 'http' })),
    McpConfigError,
    'WR_MCP_TRANSPORT=http sem WR_MCP_HTTP_TOKEN deve lançar (fail-closed)',
  );

  const withToken = resolveMcpConfigFromEnv(fakeEnv({ WR_MCP_TRANSPORT: 'http', WR_MCP_HTTP_TOKEN: 'secret' }));
  assert.equal(withToken.transport, 'http');

  const stdioDefault = resolveMcpConfigFromEnv(fakeEnv({}));
  assert.equal(stdioDefault.transport, 'stdio');

  console.log('R-LO-7 (fail-closed http sem token): OK (config lança McpConfigError; stdio permanece default)');
}

// ---------------------------------------------------------------------------
// R-LO-8 — stdio sobe e responde tools/list + tools/call
// ---------------------------------------------------------------------------

async function stdioRoundTripTest(databaseUrl: string): Promise<void> {
  const entrypoint = join(process.cwd(), 'scripts', 'mcp', '.dist', 'src', 'mcp', 'index.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint],
    env: { ...process.env, DATABASE_URL: databaseUrl, WR_MCP_TRANSPORT: 'stdio' },
  });
  const client = new Client({ name: 'mcp-test-client', version: '1.0.0' });
  await client.connect(transport);

  try {
    const list = await client.listTools();
    assert.ok(list.tools.length >= 8, `esperava >= 8 tools no tools/list, encontrou ${list.tools.length}`);
    assert.ok(list.tools.some((t) => t.name === 'agent_run.get'));
    assert.ok(!list.tools.some((t) => /^(execute|approve|cancel|create)/i.test(t.name)), 'nenhuma tool de escrita/execução pode ser exposta');

    const call = await client.callTool({ name: 'agent_run.get', arguments: { runId: 'does-not-exist' } });
    assert.equal(call.isError, true);

    console.log('R-LO-8 (stdio tools/list + tools/call): OK (servidor stdio real responde JSON-RPC)');
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não definida (harness deve exportar antes de rodar o teste)');

  const prisma = new PrismaClient();
  try {
    const fixtures = await seedRuntimeFixtures(prisma);

    await readOnlyGuaranteeTest(prisma, fixtures);
    await cvmPointInTimeTest(prisma);
    await marketBarNoLookaheadTest(prisma);
    await runtimeReadTest(prisma, fixtures);
    await stableContractTest(prisma);
    await invalidInputSanitizedTest(prisma);
    failClosedHttpTest();
    await stdioRoundTripTest(databaseUrl);

    console.log('\nTodos os testes MCP (R-LO-1..8) passaram.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
