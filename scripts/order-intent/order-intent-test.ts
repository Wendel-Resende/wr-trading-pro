import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createRiskPolicyService } from '../../src/application/risk-policy';
import { createOrderIntentService } from '../../src/application/order-intent';
import { ReadModelError } from '../../src/application/read-models-v1/errors';
import { jsonError } from '../../src/app/api/v1/_shared/http';
import { CreateOrderIntentBodySchema } from '../../src/adapters/prisma/order-intent';
import type { RiskEvaluationContext, RiskPolicyConfig, TradeProposal } from '../../src/domain/v1/models/risk-policy';
import type { OrderIntentConfig } from '../../src/domain/v1/models/order-intent';

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
    join(process.cwd(), 'prisma', 'migrations', '20260714030000_add_order_intent_approval', 'migration.sql'),
    'utf8',
  );
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i, 'migração aditiva do Item 4 não pode conter ALTER TABLE');
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i, 'migração aditiva não pode conter DROP TABLE');
  assert.doesNotMatch(sql, /\bDROP\s+COLUMN\b/i, 'migração aditiva não pode conter DROP COLUMN');
  assert.doesNotMatch(sql, /\bDROP\s+INDEX\b/i, 'migração aditiva não pode conter DROP INDEX');
  assert.match(sql, /CREATE TABLE "HumanApprovalReceipt"/);
  assert.match(sql, /CREATE TABLE "OrderIntent"/);
  assert.match(sql, /CREATE UNIQUE INDEX "OrderIntent_idempotencyKey_key"/);
  console.log('migration additivity (Item 4): OK (somente CREATE TABLE/INDEX, sem ALTER/DROP)');
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

const RISK_ENABLED: RiskPolicyConfig = { tradingEnabled: true, policyVersion: 'risk-policy/v1' };
const RISK_DISABLED: RiskPolicyConfig = { tradingEnabled: false, policyVersion: 'risk-policy/v1' };

const INTENT_ENABLED: OrderIntentConfig = { tradingEnabled: true, policyVersion: 'order-intent/v1' };
const INTENT_DISABLED: OrderIntentConfig = { tradingEnabled: false, policyVersion: 'order-intent/v1' };

let runCounter = 0;
function nextRunId(prefix: string): string {
  runCounter += 1;
  return `${prefix}-${runCounter}`;
}

async function makeApprovedDecision(prisma: PrismaClient, direction: 'BUY' | 'SELL' | 'HOLD' = 'BUY') {
  const riskService = createRiskPolicyService(prisma);
  const proposal: TradeProposal = { ...BASE_PROPOSAL, direction };
  const result = await riskService.evaluate(
    { runId: nextRunId('run-oi-approved'), requestedBy: 'tester', proposal, context: BASE_CONTEXT, decisionTime: proposal.decisionTime },
    RISK_ENABLED,
  );
  assert.equal(result.outcome, 'APPROVED');
  return result;
}

async function makeRejectedDecision(prisma: PrismaClient) {
  const riskService = createRiskPolicyService(prisma);
  const result = await riskService.evaluate(
    { runId: nextRunId('run-oi-rejected'), requestedBy: 'tester', proposal: BASE_PROPOSAL, context: BASE_CONTEXT, decisionTime: BASE_PROPOSAL.decisionTime },
    RISK_DISABLED,
  );
  assert.equal(result.outcome, 'REJECTED');
  return result;
}

async function killSwitchTests(prisma: PrismaClient): Promise<void> {
  const approved = await makeApprovedDecision(prisma);
  const orderService = createOrderIntentService(prisma);
  await expectReadModelError(
    orderService.create(
      { decisionId: approved.decisionId, idempotencyKey: `key-kill-${approved.decisionId}`, quantity: 10, decisionTime: BASE_PROPOSAL.decisionTime, requestedBy: 'tester', approvedBy: 'tester' },
      INTENT_DISABLED,
    ),
    'TRADING_DISABLED',
    'kill switch desligado (R1)',
  );
  console.log('R1 kill switch: OK (tradingEnabled=false -> 409 TRADING_DISABLED)');
}

async function decisionRequiredTests(prisma: PrismaClient): Promise<void> {
  const orderService = createOrderIntentService(prisma);
  await expectReadModelError(
    orderService.create(
      { decisionId: 'decisao-inexistente', idempotencyKey: 'key-missing-decision', quantity: 10, decisionTime: BASE_PROPOSAL.decisionTime, requestedBy: 'tester', approvedBy: 'tester' },
      INTENT_ENABLED,
    ),
    'RISK_DECISION_NOT_FOUND',
    'decisionId inexistente (R2)',
  );
  console.log('R2 decision required: OK (decisionId inexistente -> 404 RISK_DECISION_NOT_FOUND)');
}

async function decisionNotApprovedTests(prisma: PrismaClient): Promise<void> {
  const rejected = await makeRejectedDecision(prisma);
  const orderService = createOrderIntentService(prisma);
  await expectReadModelError(
    orderService.create(
      { decisionId: rejected.decisionId, idempotencyKey: `key-rejected-${rejected.decisionId}`, quantity: 10, decisionTime: BASE_PROPOSAL.decisionTime, requestedBy: 'tester', approvedBy: 'tester' },
      INTENT_ENABLED,
    ),
    'DECISION_NOT_APPROVED',
    'RiskDecision REJECTED (R3)',
  );
  console.log('R3 decision not approved: OK (RiskDecision REJECTED -> 409 DECISION_NOT_APPROVED)');
}

async function holdNotActionableTests(prisma: PrismaClient): Promise<void> {
  const hold = await makeApprovedDecision(prisma, 'HOLD');
  assert.deepEqual(hold.reasons, ['NO_ACTIONABLE_DIRECTION']);
  const orderService = createOrderIntentService(prisma);
  await expectReadModelError(
    orderService.create(
      { decisionId: hold.decisionId, idempotencyKey: `key-hold-${hold.decisionId}`, quantity: 10, decisionTime: BASE_PROPOSAL.decisionTime, requestedBy: 'tester', approvedBy: 'tester' },
      INTENT_ENABLED,
    ),
    'DECISION_NOT_ACTIONABLE',
    'RiskDecision HOLD (R4)',
  );
  console.log('R4 hold not actionable: OK (RiskDecision HOLD/NO_ACTIONABLE_DIRECTION -> 409 DECISION_NOT_ACTIONABLE)');
}

async function createdOkTests(prisma: PrismaClient): Promise<{ decisionId: string; intentId: string; idempotencyKey: string }> {
  const approved = await makeApprovedDecision(prisma, 'BUY');
  const orderService = createOrderIntentService(prisma);
  const idempotencyKey = `key-ok-${approved.decisionId}`;

  const result = await orderService.create(
    { decisionId: approved.decisionId, idempotencyKey, quantity: 25, decisionTime: BASE_PROPOSAL.decisionTime, requestedBy: 'alice', approvedBy: 'alice' },
    INTENT_ENABLED,
  );

  assert.equal(result.replayed, false);
  assert.equal(result.intent.status, 'CREATED');
  assert.equal(result.intent.direction, 'BUY');
  assert.equal(result.intent.quantity, 25);
  assert.equal(result.intent.decisionId, approved.decisionId);
  assert.ok(result.intent.approvalId.length > 0);
  assert.ok(result.intent.intentId.length > 0);
  console.log('R6/R7 criação OK: OK (201, HumanApprovalReceipt + OrderIntent criados a partir de RiskDecision APPROVED BUY)');

  return { decisionId: approved.decisionId, intentId: result.intent.intentId, idempotencyKey };
}

async function idempotencyTests(prisma: PrismaClient, decisionId: string, idempotencyKey: string, firstIntentId: string): Promise<void> {
  const orderService = createOrderIntentService(prisma);
  const replay = await orderService.create(
    { decisionId, idempotencyKey, quantity: 999, decisionTime: BASE_PROPOSAL.decisionTime, requestedBy: 'bob', approvedBy: 'bob' },
    INTENT_ENABLED,
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.intent.intentId, firstIntentId, 'reenvio com mesma idempotencyKey deve retornar a MESMA intent (sem recriar)');
  assert.equal(replay.intent.quantity, 25, 'reenvio não pode alterar quantity da intent original');

  const list = await orderService.listByDecisionId(decisionId);
  assert.equal(list.length, 1, 'contagem de intents para o decisionId deve permanecer 1 após reenvio (R5)');
  console.log('R5 idempotency: OK (mesma idempotencyKey -> replayed:true, sem duplicar; contagem = 1)');
}

async function directionInheritedTests(prisma: PrismaClient): Promise<void> {
  const approvedSell = await makeApprovedDecision(prisma, 'SELL');
  const orderService = createOrderIntentService(prisma);
  const result = await orderService.create(
    { decisionId: approvedSell.decisionId, idempotencyKey: `key-sell-${approvedSell.decisionId}`, quantity: 5, decisionTime: BASE_PROPOSAL.decisionTime, requestedBy: 'tester', approvedBy: 'tester' },
    INTENT_ENABLED,
  );
  assert.equal(result.intent.direction, 'SELL', 'direction deve ser herdado do RiskDecision (corpo não tem campo direction)');
  console.log('direction herdado: OK (corpo não possui campo direction; intent.direction reflete o RiskDecision)');
}

async function noLookaheadInheritedTests(prisma: PrismaClient): Promise<void> {
  const approved = await makeApprovedDecision(prisma, 'BUY');
  const orderService = createOrderIntentService(prisma);
  const result = await orderService.create(
    { decisionId: approved.decisionId, idempotencyKey: `key-lookahead-${approved.decisionId}`, quantity: 1, decisionTime: BASE_PROPOSAL.decisionTime, requestedBy: 'tester', approvedBy: 'tester' },
    INTENT_ENABLED,
  );
  assert.ok(
    new Date(result.intent.knowledgeTime).valueOf() <= new Date(result.intent.decisionTime).valueOf(),
    'knowledgeTime herdado do RiskDecision não pode exceder decisionTime',
  );
  console.log('knowledgeTime <= decisionTime (herdado): OK');
}

async function getAndListTests(prisma: PrismaClient, intentId: string, decisionId: string): Promise<void> {
  const orderService = createOrderIntentService(prisma);
  const fetched = await orderService.getIntent(intentId);
  assert.equal(fetched.intentId, intentId);
  assert.equal(fetched.status, 'CREATED');

  const list1 = await orderService.listByDecisionId(decisionId);
  const list2 = await orderService.listByDecisionId(decisionId);
  assert.deepEqual(list1.map((i) => i.intentId), list2.map((i) => i.intentId), 'GET ?decisionId= deve ser determinístico em execuções repetidas');

  await expectReadModelError(orderService.getIntent('intent-inexistente'), 'ORDER_INTENT_NOT_FOUND', 'GET /order-intents/:id inexistente');
  console.log('GET order-intents: OK (:id reflete o estado; ?decisionId= determinístico)');
}

async function cancellationTests(prisma: PrismaClient): Promise<void> {
  const approved = await makeApprovedDecision(prisma, 'BUY');
  const orderService = createOrderIntentService(prisma);
  const created = await orderService.create(
    { decisionId: approved.decisionId, idempotencyKey: `key-cancel-${approved.decisionId}`, quantity: 3, decisionTime: BASE_PROPOSAL.decisionTime, requestedBy: 'tester', approvedBy: 'tester' },
    INTENT_ENABLED,
  );

  const cancelled = await orderService.cancel(created.intent.intentId);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.ok(cancelled.cancelledAt);

  await expectReadModelError(orderService.cancel(created.intent.intentId), 'INTENT_NOT_CANCELABLE', 're-cancelar intent já CANCELLED');
  await expectReadModelError(orderService.cancel('intent-inexistente-cancel'), 'ORDER_INTENT_NOT_FOUND', 'cancelar intent inexistente');
  console.log('cancelamento: OK (CREATED -> CANCELLED; re-cancelar -> 409 INTENT_NOT_CANCELABLE; inexistente -> 404)');
}

async function internalErrorSanitizationTests(): Promise<void> {
  const fakePrismaError = Object.assign(new Error('SELECT * FROM "OrderIntent" WHERE ... syntax error near "%^&"'), {
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
    decisionId: 'decision-strict',
    idempotencyKey: 'key-strict',
    quantity: 10,
    decisionTime: BASE_PROPOSAL.decisionTime,
    direction: 'BUY',
  };
  const parsed = CreateOrderIntentBodySchema.safeParse(rawWithExtraField);
  assert.equal(parsed.success, false, 'corpo com campo extra (direction) deve ser rejeitado por Zod .strict()');
  console.log('Zod .strict(): OK (campo extra no corpo é rejeitado -> 400 INVALID_BODY)');
}

async function main(): Promise<void> {
  migrationAdditivityTests();
  await internalErrorSanitizationTests();
  strictBodyRejectsExtraFieldTests();

  const prisma = new PrismaClient();
  try {
    await killSwitchTests(prisma);
    await decisionRequiredTests(prisma);
    await decisionNotApprovedTests(prisma);
    await holdNotActionableTests(prisma);

    const { decisionId, intentId, idempotencyKey } = await createdOkTests(prisma);
    await idempotencyTests(prisma, decisionId, idempotencyKey, intentId);
    await directionInheritedTests(prisma);
    await noLookaheadInheritedTests(prisma);
    await getAndListTests(prisma, intentId, decisionId);
    await cancellationTests(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log('Fase 3 / Item 4 — aprovação humana + idempotency key: TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
