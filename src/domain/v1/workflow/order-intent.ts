import { OrderDraftV1Schema, TradeProposalV1Schema } from '../../../contracts/v1';
import type { IdempotencyRegistry } from '../ports/idempotency-registry';
import { fingerprintOrderDraft } from './fingerprint';
import type { OrderDraft, TradeProposal, WorkflowResult } from './models';
import { MAX_KILL_SWITCH_TTL_MS, MAX_ORDER_QUANTITY } from './models';
import type { HumanApprovalReceipt, KillSwitchSnapshot, RiskDecision } from './transitions';
import { isHumanApprovalReceipt, isKillSwitchSnapshot, isRiskDecision } from './transitions';
import { compareInstants, isStrictlyAfter, parseInstant } from './time';

const governedOrderIntentBrand: unique symbol = Symbol('GovernedOrderIntent');
const authenticGovernedOrderIntents = new WeakSet<object>();
const STRICT_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const STRICT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface GovernedOrderIntent {
  readonly [governedOrderIntentBrand]: true;
  readonly id: string; readonly correlationId: string; readonly idempotencyKey: string;
  readonly accountId: string; readonly instrument: string; readonly side: 'BUY' | 'SELL';
  readonly orderType: 'MARKET' | 'LIMIT'; readonly quantity: number; readonly limitPrice: number | null;
  readonly stopLoss: number | null; readonly takeProfit: number | null; readonly proposalId: string;
  readonly draftId: string; readonly riskDecisionId: string; readonly approvalReceiptId: string;
  readonly killSwitchSnapshotId: string; readonly draftFingerprint: string; readonly issuedAt: string;
}
export type OrderIntent = GovernedOrderIntent;
export const isGovernedOrderIntent = (value: unknown): value is GovernedOrderIntent =>
  typeof value === 'object' && value !== null && authenticGovernedOrderIntents.has(value)
    && (value as GovernedOrderIntent)[governedOrderIntentBrand] === true && Object.isFrozen(value);
const brandIntent = (value: Omit<GovernedOrderIntent, typeof governedOrderIntentBrand>): GovernedOrderIntent => {
  Object.defineProperty(value, governedOrderIntentBrand, { value: true, enumerable: false, writable: false, configurable: false });
  const frozen = Object.freeze(value);
  authenticGovernedOrderIntents.add(frozen);
  return frozen as GovernedOrderIntent;
};

export type IssueOrderIntentInput = Readonly<{
  intentId: string; correlationId: string; idempotencyKey: string; now: string;
  draft: OrderDraft; proposal: TradeProposal; risk: RiskDecision;
  approval: HumanApprovalReceipt; killSwitch: KillSwitchSnapshot; registry: IdempotencyRegistry;
}>;

const samePrices = (draft: OrderDraft, proposal: TradeProposal): boolean =>
  draft.limitPrice === proposal.limitPrice && draft.stopLoss === proposal.stopLoss && draft.takeProfit === proposal.takeProfit;
const chronologyValid = (proposal: TradeProposal, draft: OrderDraft, risk: RiskDecision,
  approval: HumanApprovalReceipt, killSwitch: KillSwitchSnapshot, nowText: string): boolean => {
  const values = [proposal.createdAt, proposal.expiresAt, draft.createdAt, risk.decidedAt, risk.expiresAt,
    approval.approvedAt, approval.expiresAt, killSwitch.observedAt, killSwitch.expiresAt, nowText].map(parseInstant);
  if (values.some((value) => value === null)) return false;
  const [proposalCreated, , draftCreated, riskDecided, , approved, , observed, switchExpires, now] = values;
  if (!proposalCreated || !draftCreated || !riskDecided || !approved || !observed || !switchExpires || !now) return false;
  const ttlMicros = (switchExpires.milliseconds - observed.milliseconds) * 1000 + switchExpires.micros - observed.micros;
  return compareInstants(proposalCreated, draftCreated) <= 0 && compareInstants(draftCreated, riskDecided) <= 0
    && compareInstants(riskDecided, approved) <= 0 && compareInstants(approved, now) <= 0
    && compareInstants(observed, now) <= 0 && ttlMicros > 0 && ttlMicros <= MAX_KILL_SWITCH_TTL_MS * 1000;
};

export const issueOrderIntent = async (input: IssueOrderIntentInput): Promise<WorkflowResult<GovernedOrderIntent>> => {
  if (!isRiskDecision(input.risk) || !isHumanApprovalReceipt(input.approval) || !isKillSwitchSnapshot(input.killSwitch))
    return { ok: false, code: 'ARTIFACT_NOT_AUTHENTIC', message: 'risk, approval, or kill-switch artifact is not authentic' };
  const parsedProposal = TradeProposalV1Schema.safeParse(input.proposal);
  const parsedDraft = OrderDraftV1Schema.safeParse(input.draft);
  if (!parsedProposal.success || !parsedDraft.success)
    return { ok: false, code: 'INVALID_INPUT', message: 'proposal or draft violates the v1 wire contract' };
  const proposal: TradeProposal = parsedProposal.data; const draft: OrderDraft = parsedDraft.data;
  const risk = input.risk; const approval = input.approval; const killSwitch = input.killSwitch;
  if (!STRICT_ID.test(input.intentId) || !STRICT_ID.test(input.correlationId)) return { ok: false, code: 'INVALID_INPUT', message: 'intent/correlation id invalid' };
  if (!STRICT_KEY.test(input.idempotencyKey)) return { ok: false, code: 'INVALID_IDEMPOTENCY_KEY', message: 'idempotency key must be 16-128 strict characters' };
  if (!chronologyValid(proposal, draft, risk, approval, killSwitch, input.now)) return { ok: false, code: 'INVALID_TIME', message: 'invalid or inconsistent workflow chronology' };
  if (risk.decision !== 'APPROVED') return { ok: false, code: 'RISK_NOT_APPROVED', message: 'risk must be APPROVED' };
  if (!isStrictlyAfter(proposal.expiresAt, input.now)) return { ok: false, code: 'EXPIRED_PROPOSAL', message: 'proposal is expired' };
  if (!isStrictlyAfter(risk.expiresAt, input.now)) return { ok: false, code: 'EXPIRED_RISK', message: 'risk decision is expired' };
  if (!isStrictlyAfter(approval.expiresAt, input.now)) return { ok: false, code: 'EXPIRED_APPROVAL', message: 'approval is expired' };
  if (killSwitch.enabled !== true) return { ok: false, code: 'KILL_SWITCH_DISABLED', message: 'kill switch is not enabled' };
  if (!isStrictlyAfter(killSwitch.expiresAt, input.now)) return { ok: false, code: 'STALE_KILL_SWITCH', message: 'kill switch snapshot is stale' };
  const bound = draft.proposalId === proposal.id && risk.proposalId === proposal.id && risk.draftId === draft.id
    && approval.proposalId === proposal.id && approval.draftId === draft.id && approval.riskDecisionId === risk.id;
  const orderMatches = draft.instrument === proposal.instrument && draft.side === proposal.side
    && draft.orderType === proposal.orderType && draft.quantity === proposal.quantity && samePrices(draft, proposal);
  if (!bound || !orderMatches) return { ok: false, code: 'BINDING_MISMATCH', message: 'identities or executable fields do not match' };
  const fingerprint = fingerprintOrderDraft(draft);
  if (approval.draftFingerprint !== fingerprint) return { ok: false, code: 'DRAFT_CHANGED', message: 'draft changed after approval' };
  if (!Number.isFinite(risk.approvedMaxQuantity) || risk.approvedMaxQuantity <= 0
      || risk.approvedMaxQuantity > MAX_ORDER_QUANTITY || draft.quantity > risk.approvedMaxQuantity)
    return { ok: false, code: 'QUANTITY_EXCEEDS_RISK', message: 'quantity exceeds approved maximum' };

  // Capture only validated scalar values before yielding control to the registry.
  const snapshot = Object.freeze({ id: input.intentId, correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey, accountId: draft.accountId, instrument: draft.instrument, side: draft.side,
    orderType: draft.orderType, quantity: draft.quantity, limitPrice: draft.limitPrice, stopLoss: draft.stopLoss,
    takeProfit: draft.takeProfit, proposalId: proposal.id, draftId: draft.id, riskDecisionId: risk.id,
    approvalReceiptId: approval.id, killSwitchSnapshotId: killSwitch.id, draftFingerprint: fingerprint });
  const requestedAt = input.now;
  let reservedAt: string;
  try {
    const reservation = await input.registry.reserve(snapshot.idempotencyKey, snapshot.correlationId);
    if (!reservation.reserved) return { ok: false, code: 'IDEMPOTENCY_CONFLICT', message: 'idempotency key already reserved' };
    const reserved = parseInstant(reservation.reservedAt); const requested = parseInstant(requestedAt);
    if (reserved === null || requested === null || compareInstants(reserved, requested) < 0)
      return { ok: false, code: 'IDEMPOTENCY_UNAVAILABLE', message: 'registry returned invalid reservation completion time' };
    reservedAt = reservation.reservedAt;
  } catch {
    return { ok: false, code: 'IDEMPOTENCY_UNAVAILABLE', message: 'idempotency registry unavailable' };
  }
  // Reservation may have waited: re-evaluate every temporal gate at its trusted
  // completion instant before creating an executable capability.
  if (!chronologyValid(proposal, draft, risk, approval, killSwitch, reservedAt))
    return { ok: false, code: 'INVALID_TIME', message: 'invalid or inconsistent workflow chronology at reservation completion' };
  if (!isStrictlyAfter(proposal.expiresAt, reservedAt)) return { ok: false, code: 'EXPIRED_PROPOSAL', message: 'proposal expired before reservation completed' };
  if (!isStrictlyAfter(risk.expiresAt, reservedAt)) return { ok: false, code: 'EXPIRED_RISK', message: 'risk decision expired before reservation completed' };
  if (!isStrictlyAfter(approval.expiresAt, reservedAt)) return { ok: false, code: 'EXPIRED_APPROVAL', message: 'approval expired before reservation completed' };
  if (!isStrictlyAfter(killSwitch.expiresAt, reservedAt)) return { ok: false, code: 'STALE_KILL_SWITCH', message: 'kill switch became stale before reservation completed' };
  return { ok: true, value: brandIntent({ ...snapshot, issuedAt: reservedAt }) };
};
