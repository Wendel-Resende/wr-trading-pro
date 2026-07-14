import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createRiskPolicyService } from '../../src/application/risk-policy';
import { ReadModelError } from '../../src/application/read-models-v1/errors';
import { jsonError } from '../../src/app/api/v1/_shared/http';
import { RiskEvaluateBodySchema } from '../../src/adapters/prisma/risk-policy';
import type { RiskEvaluationContext, RiskPolicyConfig, TradeProposal } from '../../src/domain/v1/models/risk-policy';

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
  const sql = readFileSync(
    join(process.cwd(), 'prisma', 'migrations', '20260714020000_add_risk_decision_ledger', 'migration.sql'),
    'utf8',
  );
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i, 'migração aditiva do Item 3 não pode conter ALTER TABLE');
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i, 'migração aditiva não pode conter DROP TABLE');
  assert.doesNotMatch(sql, /\bDROP\s+COLUMN\b/i, 'migração aditiva não pode conter DROP COLUMN');
  assert.doesNotMatch(sql, /\bDROP\s+INDEX\b/i, 'migração aditiva não pode conter DROP INDEX');
  assert.match(sql, /CREATE TABLE "RiskDecision"/);
  assert.match(sql, /CREATE UNIQUE INDEX "RiskDecision_decisionId_key"/);
  console.log('migration additivity (Item 3): OK (somente CREATE TABLE/INDEX, sem ALTER/DROP)');
}

const BASE_PROPOSAL: TradeProposal = {
  kind: 'PROPOSAL',
  instrumentId: 'PETR4',
  direction: 'BUY',
  rationale: 'Teste determinístico',
  risks: ['risco de mercado'],
  confidence: 0.7,
  decisionTime: '2099-01-01T00:00:00.000Z',
  requiresHumanApproval: true,
};

const BASE_CONTEXT: RiskEvaluationContext = {
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

const ENABLED_CONFIG: RiskPolicyConfig = { tradingEnabled: true, policyVersion: 'risk-policy/v1' };
const DISABLED_CONFIG: RiskPolicyConfig = { tradingEnabled: false, policyVersion: 'risk-policy/v1' };

async function killSwitchTests(prisma: PrismaClient): Promise<void> {
  const service = createRiskPolicyService(prisma);
  const result = await service.evaluate(
    { runId: 'run-kill-switch', requestedBy: 'tester', proposal: BASE_PROPOSAL, context: BASE_CONTEXT, decisionTime: BASE_PROPOSAL.decisionTime },
    DISABLED_CONFIG,
  );
  assert.equal(result.outcome, 'REJECTED');
  assert.deepEqual(result.reasons, ['KILL_SWITCH_DISABLED']);
  console.log('kill switch: OK (tradingEnabled=false -> REJECTED KILL_SWITCH_DISABLED)');
}

async function instrumentAllowlistTests(prisma: PrismaClient): Promise<void> {
  const service = createRiskPolicyService(prisma);
  const proposal: TradeProposal = { ...BASE_PROPOSAL, instrumentId: 'NOTALLOWED' };
  const result = await service.evaluate(
    { runId: 'run-allowlist', requestedBy: 'tester', proposal, context: BASE_CONTEXT, decisionTime: proposal.decisionTime },
    ENABLED_CONFIG,
  );
  assert.equal(result.outcome, 'REJECTED');
  assert.deepEqual(result.reasons, ['INSTRUMENT_NOT_ALLOWED']);
  console.log('allowlist: OK (instrumento fora da allowlist -> REJECTED INSTRUMENT_NOT_ALLOWED)');
}

async function holdDirectionTests(prisma: PrismaClient): Promise<void> {
  const service = createRiskPolicyService(prisma);
  const proposal: TradeProposal = { ...BASE_PROPOSAL, direction: 'HOLD' };
  const result = await service.evaluate(
    { runId: 'run-hold', requestedBy: 'tester', proposal, context: BASE_CONTEXT, decisionTime: proposal.decisionTime },
    ENABLED_CONFIG,
  );
  assert.equal(result.outcome, 'APPROVED');
  assert.deepEqual(result.reasons, ['NO_ACTIONABLE_DIRECTION']);
  console.log('HOLD: OK (direction=HOLD -> APPROVED NO_ACTIONABLE_DIRECTION, sem execução)');
}

async function maxProposalsPerRunTests(prisma: PrismaClient): Promise<void> {
  const service = createRiskPolicyService(prisma);
  const context: RiskEvaluationContext = { ...BASE_CONTEXT, limits: { ...BASE_CONTEXT.limits, maxProposalsPerRun: 2 } };
  const runId = 'run-max-proposals';

  const first = await service.evaluate(
    { runId, requestedBy: 'tester', proposal: BASE_PROPOSAL, context, decisionTime: BASE_PROPOSAL.decisionTime },
    ENABLED_CONFIG,
  );
  assert.equal(first.outcome, 'APPROVED');

  const second = await service.evaluate(
    { runId, requestedBy: 'tester', proposal: BASE_PROPOSAL, context, decisionTime: BASE_PROPOSAL.decisionTime },
    ENABLED_CONFIG,
  );
  assert.equal(second.outcome, 'APPROVED');

  const third = await service.evaluate(
    { runId, requestedBy: 'tester', proposal: BASE_PROPOSAL, context, decisionTime: BASE_PROPOSAL.decisionTime },
    ENABLED_CONFIG,
  );
  assert.equal(third.outcome, 'REJECTED');
  assert.deepEqual(third.reasons, ['MAX_PROPOSALS_PER_RUN']);
  console.log('maxProposalsPerRun: OK (terceira proposta no mesmo run excede teto -> REJECTED MAX_PROPOSALS_PER_RUN)');
}

async function notionalExceedsMaxTests(prisma: PrismaClient): Promise<void> {
  const service = createRiskPolicyService(prisma);
  const context: RiskEvaluationContext = { ...BASE_CONTEXT, limits: { ...BASE_CONTEXT.limits, maxNotional: 1000 } };
  const result = await service.evaluate(
    { runId: 'run-notional', requestedBy: 'tester', proposal: BASE_PROPOSAL, context, decisionTime: BASE_PROPOSAL.decisionTime },
    ENABLED_CONFIG,
  );
  assert.equal(result.outcome, 'REJECTED');
  assert.deepEqual(result.reasons, ['NOTIONAL_EXCEEDS_MAX']);
  console.log('notional: OK (referencePrice*proposedQuantity > maxNotional -> REJECTED NOTIONAL_EXCEEDS_MAX)');
}

async function concentrationExceedsMaxTests(prisma: PrismaClient): Promise<void> {
  const service = createRiskPolicyService(prisma);
  const context: RiskEvaluationContext = {
    ...BASE_CONTEXT,
    portfolioNav: 3000,
    limits: { ...BASE_CONTEXT.limits, maxNotional: 1_000_000, maxPositionConcentrationPct: 10 },
  };
  const result = await service.evaluate(
    { runId: 'run-concentration', requestedBy: 'tester', proposal: BASE_PROPOSAL, context, decisionTime: BASE_PROPOSAL.decisionTime },
    ENABLED_CONFIG,
  );
  assert.equal(result.outcome, 'REJECTED');
  assert.deepEqual(result.reasons, ['CONCENTRATION_EXCEEDS_MAX']);
  console.log('concentração: OK (concentração pós-trade > teto -> REJECTED CONCENTRATION_EXCEEDS_MAX)');
}

async function approvedOkTests(prisma: PrismaClient): Promise<void> {
  const service = createRiskPolicyService(prisma);
  const result = await service.evaluate(
    { runId: 'run-ok', requestedBy: 'tester', proposal: BASE_PROPOSAL, context: BASE_CONTEXT, decisionTime: BASE_PROPOSAL.decisionTime },
    ENABLED_CONFIG,
  );
  assert.equal(result.outcome, 'APPROVED');
  assert.deepEqual(result.reasons, ['OK']);
  console.log('todas regras OK: OK (APPROVED [\'OK\'])');
}

async function ledgerPersistenceTests(prisma: PrismaClient): Promise<void> {
  const service = createRiskPolicyService(prisma);
  const result = await service.evaluate(
    { runId: 'run-ledger', requestedBy: 'tester-ledger', proposal: BASE_PROPOSAL, context: BASE_CONTEXT, decisionTime: BASE_PROPOSAL.decisionTime },
    ENABLED_CONFIG,
  );

  const decision = await service.getDecision(result.decisionId);
  assert.equal(decision.runId, 'run-ledger');
  assert.equal(decision.requestedBy, 'tester-ledger');
  assert.equal(decision.instrumentId, BASE_PROPOSAL.instrumentId);
  assert.equal(decision.direction, BASE_PROPOSAL.direction);
  assert.equal(decision.outcome, 'APPROVED');
  assert.deepEqual(decision.reasons, ['OK']);
  assert.equal(decision.policyVersion, 'risk-policy/v1');
  assert.ok(decision.proposalJson.includes('PETR4'));
  assert.ok(decision.contextJson.includes('portfolioNav'));
  assert.ok(decision.policySnapshotJson && decision.policySnapshotJson.includes('tradingEnabled'));
  assert.ok(decision.evaluatedAt.length > 0);
  console.log('ledger: OK (RiskDecision persistido com policyVersion/proposalJson/contextJson/reasons)');
}

async function getAndListDecisionsTests(prisma: PrismaClient): Promise<void> {
  const service = createRiskPolicyService(prisma);
  const runId = 'run-get-list';
  const first = await service.evaluate(
    { runId, requestedBy: 'tester', proposal: BASE_PROPOSAL, context: BASE_CONTEXT, decisionTime: BASE_PROPOSAL.decisionTime },
    ENABLED_CONFIG,
  );
  const second = await service.evaluate(
    { runId, requestedBy: 'tester', proposal: { ...BASE_PROPOSAL, instrumentId: 'VALE3' }, context: BASE_CONTEXT, decisionTime: BASE_PROPOSAL.decisionTime },
    ENABLED_CONFIG,
  );

  const fetched = await service.getDecision(first.decisionId);
  assert.equal(fetched.decisionId, first.decisionId);

  const list1 = await service.listByRunId(runId);
  const list2 = await service.listByRunId(runId);
  assert.equal(list1.length, 2);
  assert.deepEqual(list1.map((d) => d.decisionId), list2.map((d) => d.decisionId), 'GET ?runId= deve ser determinístico em execuções repetidas');
  assert.deepEqual(list1.map((d) => d.decisionId), [first.decisionId, second.decisionId], 'ordenado por evaluatedAt asc');

  await expectReadModelError(service.getDecision('inexistente'), 'RISK_DECISION_NOT_FOUND', 'GET /decisions/:id inexistente');
  console.log('GET decisions: OK (:id reflete o ledger; ?runId= determinístico e ordenado por evaluatedAt)');
}

async function internalErrorSanitizationTests(): Promise<void> {
  const fakePrismaError = Object.assign(new Error('SELECT * FROM "RiskDecision" WHERE ... syntax error near "%^&"'), {
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

function strictBodyRejectsExtraFieldTests(): void {
  const rawWithExtraField = {
    runId: 'run-strict',
    proposal: BASE_PROPOSAL,
    context: BASE_CONTEXT,
    decisionTime: BASE_PROPOSAL.decisionTime,
    executionOrder: { ticket: 'not-allowed' },
  };
  const parsed = RiskEvaluateBodySchema.safeParse(rawWithExtraField);
  assert.equal(parsed.success, false, 'corpo com campo extra deve ser rejeitado por Zod .strict()');
  console.log('Zod .strict(): OK (campo extra no corpo é rejeitado -> 400)');
}

async function noLookaheadTests(prisma: PrismaClient): Promise<void> {
  const service = createRiskPolicyService(prisma);
  await expectReadModelError(
    service.evaluate(
      { runId: 'run-lookahead', requestedBy: 'tester', proposal: BASE_PROPOSAL, context: BASE_CONTEXT, decisionTime: '2020-01-01T00:00:00.000Z' },
      ENABLED_CONFIG,
    ),
    'INVALID_BODY',
    'decisionTime no passado (knowledgeTime derivado excederia decisionTime)',
  );

  const ok = await service.evaluate(
    { runId: 'run-lookahead-ok', requestedBy: 'tester', proposal: BASE_PROPOSAL, context: BASE_CONTEXT, decisionTime: BASE_PROPOSAL.decisionTime },
    ENABLED_CONFIG,
  );
  const decision = await service.getDecision(ok.decisionId);
  assert.ok(decision.knowledgeTime <= decision.decisionTime || new Date(decision.knowledgeTime) <= new Date(decision.decisionTime));

  console.log('no-lookahead: OK (knowledgeTime derivado não pode exceder decisionTime)');
}

async function main(): Promise<void> {
  migrationAdditivityTests();
  await internalErrorSanitizationTests();
  strictBodyRejectsExtraFieldTests();

  const prisma = new PrismaClient();
  try {
    await killSwitchTests(prisma);
    await instrumentAllowlistTests(prisma);
    await holdDirectionTests(prisma);
    await maxProposalsPerRunTests(prisma);
    await notionalExceedsMaxTests(prisma);
    await concentrationExceedsMaxTests(prisma);
    await approvedOkTests(prisma);
    await ledgerPersistenceTests(prisma);
    await getAndListDecisionsTests(prisma);
    await noLookaheadTests(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log('Fase 3 / Item 3 — motor RiskPolicy determinístico: TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
