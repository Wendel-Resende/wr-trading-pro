import { OrderDraftV1Schema, TradeProposalV1Schema } from '../../../contracts/v1';
import { fingerprintOrderDraft } from './fingerprint';
import type { AuthenticatedHumanPrincipal, HumanAuthenticationVerifier, OrderDraft, TradeProposal, WorkflowResult } from './models';
import { MAX_KILL_SWITCH_TTL_MS, MAX_ORDER_QUANTITY } from './models';
import { compareInstants, isStrictlyAfter, parseInstant } from './time';

const riskDecisionBrand: unique symbol = Symbol('RiskDecision');
const humanApprovalReceiptBrand: unique symbol = Symbol('HumanApprovalReceipt');
const killSwitchSnapshotBrand: unique symbol = Symbol('KillSwitchSnapshot');
const authenticRiskDecisions = new WeakSet<object>();
const authenticHumanApprovals = new WeakSet<object>();
const authenticKillSwitchSnapshots = new WeakSet<object>();

export interface RiskDecision {
  readonly [riskDecisionBrand]: true;
  readonly id: string; readonly proposalId: string; readonly draftId: string;
  readonly decision: 'APPROVED' | 'REJECTED'; readonly approvedMaxQuantity: number;
  readonly decidedAt: string; readonly expiresAt: string; readonly policyId: string; readonly rationale: string;
}
export interface HumanApprovalReceipt {
  readonly [humanApprovalReceiptBrand]: true;
  readonly id: string; readonly proposalId: string; readonly draftId: string; readonly riskDecisionId: string;
  readonly draftFingerprint: string; readonly authenticatedHumanActorId: string;
  readonly approvedAt: string; readonly expiresAt: string;
}
export interface KillSwitchSnapshot {
  readonly [killSwitchSnapshotBrand]: true;
  readonly id: string; readonly enabled: true; readonly observedAt: string; readonly expiresAt: string;
}

export const isRiskDecision = (value: unknown): value is RiskDecision =>
  typeof value === 'object' && value !== null && authenticRiskDecisions.has(value) && (value as RiskDecision)[riskDecisionBrand] === true && Object.isFrozen(value);
export const isHumanApprovalReceipt = (value: unknown): value is HumanApprovalReceipt =>
  typeof value === 'object' && value !== null && authenticHumanApprovals.has(value) && (value as HumanApprovalReceipt)[humanApprovalReceiptBrand] === true && Object.isFrozen(value);
export const isKillSwitchSnapshot = (value: unknown): value is KillSwitchSnapshot =>
  typeof value === 'object' && value !== null && authenticKillSwitchSnapshots.has(value) && (value as KillSwitchSnapshot)[killSwitchSnapshotBrand] === true && Object.isFrozen(value);

const privatelyBrandAndFreeze = <T extends object>(value: T, brand: symbol, authentic: WeakSet<object>): T => {
  Object.defineProperty(value, brand, { value: true, enumerable: false, writable: false, configurable: false });
  const frozen = Object.freeze(value);
  authentic.add(frozen);
  return frozen;
};

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const textOk = (value: string): boolean => value.length > 0 && value.length <= 1000;
const atOrBefore = (left: string, right: string): boolean => {
  const a = parseInstant(left); const b = parseInstant(right);
  return a !== null && b !== null && compareInstants(a, b) <= 0;
};
const allValid = (...values: string[]): boolean => values.every((value) => parseInstant(value) !== null);
const parseWire = (proposal: unknown, draft: unknown): { proposal: TradeProposal; draft: OrderDraft } | null => {
  const parsedProposal = TradeProposalV1Schema.safeParse(proposal);
  const parsedDraft = OrderDraftV1Schema.safeParse(draft);
  return parsedProposal.success && parsedDraft.success ? { proposal: parsedProposal.data, draft: parsedDraft.data } : null;
};

export type CreateRiskDecisionInput = Readonly<{
  id: string; proposal: TradeProposal; draft: OrderDraft; decision: 'APPROVED' | 'REJECTED';
  approvedMaxQuantity: number; policyId: string; rationale: string; now: string; expiresAt: string;
}>;

export const createRiskDecision = (input: CreateRiskDecisionInput): WorkflowResult<RiskDecision> => {
  const wire = parseWire(input.proposal, input.draft);
  if (!wire) return { ok: false, code: 'INVALID_INPUT', message: 'proposal or draft violates the v1 wire contract' };
  const { proposal, draft } = wire;
  if (![input.id, input.policyId].every((value) => ID.test(value)) || !textOk(input.rationale))
    return { ok: false, code: 'INVALID_INPUT', message: 'invalid risk metadata' };
  if (!allValid(proposal.createdAt, proposal.expiresAt, draft.createdAt, input.now, input.expiresAt)
      || !atOrBefore(proposal.createdAt, draft.createdAt) || !atOrBefore(draft.createdAt, input.now)
      || !isStrictlyAfter(proposal.expiresAt, input.now) || !isStrictlyAfter(input.expiresAt, input.now))
    return { ok: false, code: 'INVALID_TIME', message: 'invalid or inconsistent risk chronology' };
  if (draft.proposalId !== proposal.id) return { ok: false, code: 'BINDING_MISMATCH', message: 'draft is not bound to proposal' };
  if (!Number.isFinite(input.approvedMaxQuantity) || input.approvedMaxQuantity > MAX_ORDER_QUANTITY
      || (input.decision === 'APPROVED' ? input.approvedMaxQuantity <= 0 : input.approvedMaxQuantity !== 0))
    return { ok: false, code: 'INVALID_INPUT', message: 'approved max is outside the wire quantity bounds' };
  return { ok: true, value: privatelyBrandAndFreeze({ id: input.id, proposalId: proposal.id,
    draftId: draft.id, decision: input.decision, approvedMaxQuantity: input.approvedMaxQuantity, decidedAt: input.now,
    expiresAt: input.expiresAt, policyId: input.policyId, rationale: input.rationale }, riskDecisionBrand, authenticRiskDecisions) as RiskDecision };
};

export type IssueHumanApprovalInput<Evidence = unknown> = Readonly<{
  id: string; proposal: TradeProposal; draft: OrderDraft; risk: RiskDecision;
  evidence: Evidence; now: string; expiresAt: string;
}>;
export interface HumanApprovalIssuer<Evidence = unknown> {
  issue(input: IssueHumanApprovalInput<Evidence>): Promise<WorkflowResult<HumanApprovalReceipt>>;
}

export const createHumanApprovalService = <Evidence>(verifier: HumanAuthenticationVerifier<Evidence>): HumanApprovalIssuer<Evidence> => Object.freeze({
  issue: async (input: IssueHumanApprovalInput<Evidence>): Promise<WorkflowResult<HumanApprovalReceipt>> => {
    const wire = parseWire(input.proposal, input.draft);
    if (!wire) return { ok: false, code: 'INVALID_INPUT', message: 'proposal or draft violates the v1 wire contract' };
    if (!isRiskDecision(input.risk)) return { ok: false, code: 'ARTIFACT_NOT_AUTHENTIC', message: 'risk decision is not authentic' };
    const { proposal, draft } = wire; const risk = input.risk;
    if (!ID.test(input.id)) return { ok: false, code: 'INVALID_INPUT', message: 'invalid approval id' };
    if (!allValid(proposal.createdAt, proposal.expiresAt, draft.createdAt, risk.decidedAt, risk.expiresAt, input.now, input.expiresAt)
        || !atOrBefore(proposal.createdAt, draft.createdAt) || !atOrBefore(draft.createdAt, risk.decidedAt)
        || !atOrBefore(risk.decidedAt, input.now) || !isStrictlyAfter(input.expiresAt, input.now))
      return { ok: false, code: 'INVALID_TIME', message: 'invalid or inconsistent approval chronology' };
    if (!isStrictlyAfter(proposal.expiresAt, input.now)) return { ok: false, code: 'EXPIRED_PROPOSAL', message: 'proposal is expired' };
    if (!isStrictlyAfter(risk.expiresAt, input.now)) return { ok: false, code: 'EXPIRED_RISK', message: 'risk is expired' };
    if (risk.decision !== 'APPROVED') return { ok: false, code: 'RISK_NOT_APPROVED', message: 'human approval cannot override rejected risk' };
    if (draft.proposalId !== proposal.id || risk.proposalId !== proposal.id || risk.draftId !== draft.id)
      return { ok: false, code: 'BINDING_MISMATCH', message: 'approval inputs are not bound' };
    // Capture every validated/output scalar (and the evidence reference) before
    // yielding to the verifier. Mutable caller input is never read after await.
    const snapshot = Object.freeze({ id: input.id, proposalId: proposal.id, draftId: draft.id,
      riskDecisionId: risk.id, draftFingerprint: fingerprintOrderDraft(draft),
      approvedAt: input.now, expiresAt: input.expiresAt, evidence: input.evidence });
    let principal: AuthenticatedHumanPrincipal | null;
    try { principal = await verifier.verify(snapshot.evidence); } catch { principal = null; }
    if (principal === null || typeof principal !== 'object' || !ID.test(principal.actorId))
      return { ok: false, code: 'HUMAN_AUTHENTICATION_REQUIRED', message: 'verified human principal is required' };
    const authenticatedHumanActorId = principal.actorId;
    return { ok: true, value: privatelyBrandAndFreeze({ id: snapshot.id,
      proposalId: snapshot.proposalId, draftId: snapshot.draftId, riskDecisionId: snapshot.riskDecisionId,
      draftFingerprint: snapshot.draftFingerprint, authenticatedHumanActorId,
      approvedAt: snapshot.approvedAt, expiresAt: snapshot.expiresAt }, humanApprovalReceiptBrand, authenticHumanApprovals) as HumanApprovalReceipt };
  },
});

export type CreateKillSwitchSnapshotInput = Readonly<{ id: string; enabled: boolean; observedAt: string; expiresAt: string; now: string }>;
export const createKillSwitchSnapshot = (input: CreateKillSwitchSnapshotInput): WorkflowResult<KillSwitchSnapshot> => {
  if (!ID.test(input.id)) return { ok: false, code: 'INVALID_INPUT', message: 'invalid snapshot id' };
  if (input.enabled !== true) return { ok: false, code: 'KILL_SWITCH_DISABLED', message: 'execution enablement is false' };
  const observed = parseInstant(input.observedAt); const now = parseInstant(input.now); const expires = parseInstant(input.expiresAt);
  if (observed === null || now === null || expires === null || compareInstants(observed, now) > 0 || compareInstants(expires, now) <= 0)
    return { ok: false, code: 'STALE_KILL_SWITCH', message: 'snapshot is invalid, stale, or future-dated' };
  const ttlMicros = (expires.milliseconds - observed.milliseconds) * 1000 + expires.micros - observed.micros;
  if (ttlMicros <= 0 || ttlMicros > MAX_KILL_SWITCH_TTL_MS * 1000)
    return { ok: false, code: 'STALE_KILL_SWITCH', message: 'snapshot exceeds maximum TTL' };
  return { ok: true, value: privatelyBrandAndFreeze({ id: input.id, enabled: true as const,
    observedAt: input.observedAt, expiresAt: input.expiresAt }, killSwitchSnapshotBrand, authenticKillSwitchSnapshots) as KillSwitchSnapshot };
};
