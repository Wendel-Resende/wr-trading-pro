import assert from 'node:assert/strict';
import type { OrderDraftV1, TradeProposalV1 } from '../../src/contracts/v1';
import type { AuthenticatedHumanPrincipal, HumanAuthenticationVerifier, IdempotencyRegistry } from '../../src/domain/v1';
import { MAX_KILL_SWITCH_TTL_MS, canonicalDraftContent, createHumanApprovalService, createKillSwitchSnapshot,
  createRiskDecision, fingerprintOrderDraft, isGovernedOrderIntent, isHumanApprovalReceipt, isKillSwitchSnapshot,
  isRiskDecision, issueOrderIntent } from '../../src/domain/v1/workflow';
import { InMemoryIdempotencyRegistry } from './in-memory-idempotency-registry';
import { DisabledMt5ExecutionBroker } from '../../src/adapters/mt5/disabled-execution-broker';

class TestOnlyHumanVerifier implements HumanAuthenticationVerifier<string> {
  async verify(evidence: string): Promise<AuthenticatedHumanPrincipal | null> {
    return evidence === 'valid' ? ({ actorId: 'human-1' } as AuthenticatedHumanPrincipal) : null;
  }
}
const approvalService = createHumanApprovalService(new TestOnlyHumanVerifier());
const proposal: TradeProposalV1 = { schemaVersion: '1.0.0', kind: 'trade.proposal', id: 'proposal-1', createdAt: '2026-07-12T09:00:00Z', executionEligible: false, signalId: 'signal-1', instrument: 'WINQ26', side: 'BUY', orderType: 'LIMIT', quantity: 2, limitPrice: 130000, stopLoss: 129900, takeProfit: 130200, rationale: 'test', expiresAt: '2026-07-12T10:00:10Z' };
const draft: OrderDraftV1 = { schemaVersion: '1.0.0', kind: 'order.draft', id: 'draft-1', createdAt: '2026-07-12T09:01:00Z', executionEligible: false, proposalId: 'proposal-1', accountId: 'account-1', instrument: 'WINQ26', side: 'BUY', orderType: 'LIMIT', quantity: 2, limitPrice: 130000, stopLoss: 129900, takeProfit: 130200, state: 'draft', humanApproval: null, idempotencyKey: null };
const now = '2026-07-12T10:00:00.000001Z';

const main = async (): Promise<void> => {
  const riskResult = createRiskDecision({ id: 'risk-1', proposal, draft, decision: 'APPROVED', approvedMaxQuantity: 2, policyId: 'policy-1', rationale: 'within limits', now: '2026-07-12T09:02:00Z', expiresAt: '2026-07-12T10:00:10Z' });
  assert.equal(riskResult.ok, true); if (!riskResult.ok) throw new Error('risk fixture'); const risk = riskResult.value;
  const approvalResult = await approvalService.issue({ id: 'approval-1', proposal, draft, risk, evidence: 'valid', now: '2026-07-12T09:03:00Z', expiresAt: '2026-07-12T10:00:10Z' });
  assert.equal(approvalResult.ok, true); if (!approvalResult.ok) throw new Error('approval fixture'); const approval = approvalResult.value;
  const switchResult = createKillSwitchSnapshot({ id: 'switch-1', enabled: true, observedAt: now, now, expiresAt: '2026-07-12T10:00:05Z' });
  assert.equal(switchResult.ok, true); if (!switchResult.ok) throw new Error('switch fixture'); const killSwitch = switchResult.value;
  assert.ok(isRiskDecision(risk) && isHumanApprovalReceipt(approval) && isKillSwitchSnapshot(killSwitch));
  assert.ok(Object.isFrozen(risk) && Object.isFrozen(approval) && Object.isFrozen(killSwitch));

  const base = { intentId: 'intent-1', correlationId: 'correlation-1', idempotencyKey: 'idem-key-0000001', now, proposal, draft, risk, approval, killSwitch };
  const happy = await issueOrderIntent({ ...base, registry: new InMemoryIdempotencyRegistry(() => now) });
  assert.equal(happy.ok, true); if (!happy.ok) throw new Error('happy path');
  assert.ok(isGovernedOrderIntent(happy.value)); assert.ok(Object.isFrozen(happy.value));
  const disabledBroker = new DisabledMt5ExecutionBroker();
  const authenticDisabled = await disabledBroker.execute(happy.value);
  assert.equal(authenticDisabled.status, 'REJECTED');
  assert.equal(authenticDisabled.correlationId, happy.value.correlationId);
  assert.equal((await disabledBroker.execute(Object.freeze({ ...happy.value }) as typeof happy.value)).status, 'UNKNOWN');
  assert.equal(happy.value.draftFingerprint, `draft-v1-canonical:${canonicalDraftContent(draft)}`);
  assert.equal(happy.value.issuedAt, now);
  assert.equal(fingerprintOrderDraft({ ...draft, accountId: 'account-X' }) === fingerprintOrderDraft(draft), false);
  assert.equal(isGovernedOrderIntent(Object.freeze({ ...happy.value })), false);
  assert.equal(isGovernedOrderIntent(Object.freeze(({ ...happy.value }) as typeof happy.value)), false);
  const emitted = { ...happy.value }; try { (happy.value as { quantity: number }).quantity = 999; } catch {}
  assert.deepEqual({ ...happy.value }, emitted);

  const expectCode = async (input: Parameters<typeof issueOrderIntent>[0], code: string): Promise<void> => {
    const result = await issueOrderIntent(input); assert.equal(result.ok, false, `expected ${code}`); if (!result.ok) assert.equal(result.code, code);
  };
  const forgedRisk = Object.freeze({ ...risk }); const forgedApproval = Object.freeze({ ...approval }); const forgedSwitch = Object.freeze({ ...killSwitch });
  for (const replacement of [{ risk: forgedRisk }, { approval: forgedApproval }, { killSwitch: forgedSwitch }])
    await expectCode({ ...base, ...replacement, registry: new InMemoryIdempotencyRegistry(() => now) } as Parameters<typeof issueOrderIntent>[0], 'ARTIFACT_NOT_AUTHENTIC');
  assert.equal(isRiskDecision(forgedRisk), false); assert.equal(isHumanApprovalReceipt(forgedApproval), false); assert.equal(isKillSwitchSnapshot(forgedSwitch), false);
  // Discovering and copying a private runtime symbol still cannot forge process-local identity.
  const copySymbols = (source: object, target: object): void => {
    for (const symbol of Object.getOwnPropertySymbols(source)) Object.defineProperty(target, symbol, { value: true });
  };
  const reflectedRisk = { ...risk }; copySymbols(risk, reflectedRisk); Object.freeze(reflectedRisk);
  const reflectedApproval = { ...approval }; copySymbols(approval, reflectedApproval); Object.freeze(reflectedApproval);
  const reflectedSwitch = { ...killSwitch }; copySymbols(killSwitch, reflectedSwitch); Object.freeze(reflectedSwitch);
  const reflectedIntent = { ...happy.value }; copySymbols(happy.value, reflectedIntent); Object.freeze(reflectedIntent);
  assert.equal(isRiskDecision(reflectedRisk), false); assert.equal(isHumanApprovalReceipt(reflectedApproval), false);
  assert.equal(isKillSwitchSnapshot(reflectedSwitch), false); assert.equal(isGovernedOrderIntent(reflectedIntent), false);

  await expectCode({ ...base, idempotencyKey: 'short', registry: new InMemoryIdempotencyRegistry(() => now) }, 'INVALID_IDEMPOTENCY_KEY');
  const invalidWires: Array<{ proposal?: unknown; draft?: unknown }> = [
    { proposal: { ...proposal, extra: true } }, { proposal: { ...proposal, kind: 'order.draft' } },
    { draft: { ...draft, extra: true } }, { draft: { ...draft, kind: 'trade.proposal' } },
    { draft: { ...draft, state: 'approved' } }, { draft: { ...draft, side: 'SIDEWAYS' } },
  ];
  for (const wire of invalidWires) await expectCode({ ...base, ...wire, registry: new InMemoryIdempotencyRegistry(() => now) } as Parameters<typeof issueOrderIntent>[0], 'INVALID_INPUT');
  assert.equal(createRiskDecision({ id: 'bad', proposal: { ...proposal, extra: true } as TradeProposalV1, draft, decision: 'APPROVED', approvedMaxQuantity: 2, policyId: 'p', rationale: 'x', now: '2026-07-12T09:02:00Z', expiresAt: '2026-07-12T10:00:10Z' }).ok, false);

  // Configured verifier is privileged once; null and throws fail closed.
  const nullService = createHumanApprovalService<string>({ verify: async () => null });
  const throwService = createHumanApprovalService<string>({ verify: async () => { throw new Error('no'); } });
  for (const service of [nullService, throwService]) {
    const result = await service.issue({ id: 'approval-x', proposal, draft, risk, evidence: 'x', now: '2026-07-12T09:03:00Z', expiresAt: '2026-07-12T10:00:10Z' });
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, 'HUMAN_AUTHENTICATION_REQUIRED');
  }

  // Approval output is based exclusively on values validated before verifier await.
  let releaseVerifier!: () => void;
  const delayedApprovalService = createHumanApprovalService<string>({ verify: () => new Promise((resolve) => {
    releaseVerifier = () => resolve({ actorId: 'human-original' } as AuthenticatedHumanPrincipal);
  }) });
  const mutableApprovalInput = { id: 'approval-original', proposal, draft, risk, evidence: 'valid',
    now: '2026-07-12T09:03:00Z', expiresAt: '2026-07-12T10:00:10Z' };
  const pendingApproval = delayedApprovalService.issue(mutableApprovalInput);
  mutableApprovalInput.id = 'approval-mutated'; mutableApprovalInput.now = 'not-an-instant';
  mutableApprovalInput.expiresAt = '2020-01-01T00:00:00Z'; releaseVerifier();
  const stableApproval = await pendingApproval; assert.ok(stableApproval.ok);
  if (!stableApproval.ok) throw new Error('stable approval');
  assert.equal(stableApproval.value.id, 'approval-original');
  assert.equal(stableApproval.value.approvedAt, '2026-07-12T09:03:00Z');
  assert.equal(stableApproval.value.expiresAt, '2026-07-12T10:00:10Z');

  // Expiry equality, chronology, TTL and rejected-risk gates remain fail closed.
  assert.equal(createRiskDecision({ id: 'x', proposal: { ...proposal, createdAt: '2026-07-12T09:03:00Z' }, draft, decision: 'APPROVED', approvedMaxQuantity: 2, policyId: 'p', rationale: 'x', now: '2026-07-12T09:02:00Z', expiresAt: '2026-07-12T10:00:10Z' }).ok, false);
  assert.equal(createRiskDecision({ id: 'x', proposal, draft: { ...draft, createdAt: '2026-07-12T09:03:00Z' }, decision: 'APPROVED', approvedMaxQuantity: 2, policyId: 'p', rationale: 'x', now: '2026-07-12T09:02:00Z', expiresAt: '2026-07-12T10:00:10Z' }).ok, false);
  assert.equal(createKillSwitchSnapshot({ id: 'exact', enabled: true, observedAt: now, now, expiresAt: '2026-07-12T10:00:05Z' }).ok, true);
  assert.equal(createKillSwitchSnapshot({ id: 'future', enabled: true, observedAt: '2026-07-12T10:00:00.000002Z', now, expiresAt: '2026-07-12T10:00:05Z' }).ok, false);
  assert.equal(createKillSwitchSnapshot({ id: 'long', enabled: true, observedAt: now, now, expiresAt: '2026-07-12T10:00:05.000002Z' }).ok, false);
  assert.equal(MAX_KILL_SWITCH_TTL_MS, 5000);
  const rejected = createRiskDecision({ id: 'risk-r', proposal, draft, decision: 'REJECTED', approvedMaxQuantity: 0, policyId: 'p', rationale: 'reject', now: '2026-07-12T09:02:00Z', expiresAt: '2026-07-12T10:00:10Z' });
  assert.equal(rejected.ok, true); if (rejected.ok) {
    const result = await approvalService.issue({ id: 'never', proposal, draft, risk: rejected.value, evidence: 'valid', now: '2026-07-12T09:03:00Z', expiresAt: '2026-07-12T10:00:10Z' });
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, 'RISK_NOT_APPROVED');
  }

  // Scalar snapshot is complete before reserve awaits: source mutations cannot affect output.
  const mutableProposal = { ...proposal }; const mutableDraft = { ...draft };
  const mr = createRiskDecision({ id: 'risk-m', proposal: mutableProposal, draft: mutableDraft, decision: 'APPROVED', approvedMaxQuantity: 2, policyId: 'p', rationale: 'x', now: '2026-07-12T09:02:00Z', expiresAt: '2026-07-12T10:00:10Z' });
  assert.ok(mr.ok); if (!mr.ok) throw new Error('mutation risk');
  const ma = await approvalService.issue({ id: 'approval-m', proposal: mutableProposal, draft: mutableDraft, risk: mr.value, evidence: 'valid', now: '2026-07-12T09:03:00Z', expiresAt: '2026-07-12T10:00:10Z' });
  assert.ok(ma.ok); if (!ma.ok) throw new Error('mutation approval');
  let release!: () => void; const delayed: IdempotencyRegistry = { reserve: () => new Promise((resolve) => { release = () => resolve({ reserved: true, reservedAt: now }); }) };
  const pending = issueOrderIntent({ ...base, intentId: 'intent-m', idempotencyKey: 'idem-key-0000002', proposal: mutableProposal, draft: mutableDraft, risk: mr.value, approval: ma.value, registry: delayed });
  mutableDraft.quantity = 999; mutableDraft.instrument = 'WDOQ26'; mutableDraft.accountId = 'changed'; mutableProposal.instrument = 'WDOQ26'; release();
  const stable = await pending; assert.ok(stable.ok); if (!stable.ok) throw new Error('stable intent');
  assert.equal(stable.value.quantity, 2); assert.equal(stable.value.instrument, 'WINQ26'); assert.equal(stable.value.accountId, 'account-1');

  // Simulate a reservation that yields and only completes later at reservedAt.
  const completingAt = (reservedAt: string): IdempotencyRegistry => ({ reserve: () => new Promise((resolve) => {
    setImmediate(() => resolve({ reserved: true, reservedAt }));
  }) });
  await expectCode({ ...base, registry: completingAt('invalid') }, 'IDEMPOTENCY_UNAVAILABLE');
  await expectCode({ ...base, registry: completingAt('2026-07-12T10:00:00Z') }, 'IDEMPOTENCY_UNAVAILABLE');
  await expectCode({ ...base, registry: completingAt('2026-07-12T10:00:05Z') }, 'STALE_KILL_SWITCH');

  const proposalSoon = { ...proposal, expiresAt: '2026-07-12T10:00:02Z' };
  const riskSoon = createRiskDecision({ id: 'risk-proposal-delay', proposal: proposalSoon, draft, decision: 'APPROVED', approvedMaxQuantity: 2,
    policyId: 'p', rationale: 'x', now: '2026-07-12T09:02:00Z', expiresAt: '2026-07-12T10:00:04Z' });
  assert.ok(riskSoon.ok); if (!riskSoon.ok) throw new Error('proposal delay risk');
  const approvalSoon = await approvalService.issue({ id: 'approval-proposal-delay', proposal: proposalSoon, draft, risk: riskSoon.value,
    evidence: 'valid', now: '2026-07-12T09:03:00Z', expiresAt: '2026-07-12T10:00:04Z' });
  assert.ok(approvalSoon.ok); if (!approvalSoon.ok) throw new Error('proposal delay approval');
  await expectCode({ ...base, proposal: proposalSoon, risk: riskSoon.value, approval: approvalSoon.value,
    idempotencyKey: 'idem-key-proposal-delay', registry: completingAt('2026-07-12T10:00:02Z') }, 'EXPIRED_PROPOSAL');

  const riskExpiresSoon = createRiskDecision({ id: 'risk-delay', proposal, draft, decision: 'APPROVED', approvedMaxQuantity: 2,
    policyId: 'p', rationale: 'x', now: '2026-07-12T09:02:00Z', expiresAt: '2026-07-12T10:00:02Z' });
  assert.ok(riskExpiresSoon.ok); if (!riskExpiresSoon.ok) throw new Error('risk delay risk');
  const approvalAfterRisk = await approvalService.issue({ id: 'approval-risk-delay', proposal, draft, risk: riskExpiresSoon.value,
    evidence: 'valid', now: '2026-07-12T09:03:00Z', expiresAt: '2026-07-12T10:00:04Z' });
  assert.ok(approvalAfterRisk.ok); if (!approvalAfterRisk.ok) throw new Error('risk delay approval');
  await expectCode({ ...base, risk: riskExpiresSoon.value, approval: approvalAfterRisk.value,
    idempotencyKey: 'idem-key-risk-delay', registry: completingAt('2026-07-12T10:00:02Z') }, 'EXPIRED_RISK');

  const approvalExpiresSoon = await approvalService.issue({ id: 'approval-delay', proposal, draft, risk, evidence: 'valid',
    now: '2026-07-12T09:03:00Z', expiresAt: '2026-07-12T10:00:02Z' });
  assert.ok(approvalExpiresSoon.ok); if (!approvalExpiresSoon.ok) throw new Error('approval delay');
  await expectCode({ ...base, approval: approvalExpiresSoon.value, idempotencyKey: 'idem-key-approval-delay',
    registry: completingAt('2026-07-12T10:00:02Z') }, 'EXPIRED_APPROVAL');

  const throwingRegistry: IdempotencyRegistry = { reserve: async () => { throw new Error('down'); } };
  await expectCode({ ...base, registry: throwingRegistry }, 'IDEMPOTENCY_UNAVAILABLE');
  const shared = new InMemoryIdempotencyRegistry(() => now);
  const concurrent = await Promise.all([issueOrderIntent({ ...base, registry: shared }), issueOrderIntent({ ...base, correlationId: 'correlation-2', registry: shared })]);
  assert.equal(concurrent.filter((result) => result.ok).length, 1);
  assert.equal(concurrent.filter((result) => !result.ok && result.code === 'IDEMPOTENCY_CONFLICT').length, 1);
  await expectCode({ ...base, correlationId: 'correlation-3', registry: shared }, 'IDEMPOTENCY_CONFLICT');
  console.log('workflow Item 3: runtime authenticity, immutable snapshots, wire validation, chronology, TTL and idempotency PASS');
};
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
