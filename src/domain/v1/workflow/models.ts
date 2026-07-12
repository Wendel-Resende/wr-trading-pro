import type { OrderDraftV1, TradeProposalV1 } from '../../../contracts/v1';

export type TradeProposal = Readonly<TradeProposalV1>;
export type OrderDraft = Readonly<OrderDraftV1>;

export const MAX_ORDER_QUANTITY = 1_000_000_000;
export const MAX_KILL_SWITCH_TTL_MS = 5_000;

/** Opaque proof produced only by an authentication boundary. It is not user input. */
declare const authenticatedHumanPrincipalBrand: unique symbol;
export interface AuthenticatedHumanPrincipal {
  readonly actorId: string;
  readonly [authenticatedHumanPrincipalBrand]: true;
}

/** Adapter port configured once at composition time. */
export interface HumanAuthenticationVerifier<Evidence = unknown> {
  verify(evidence: Evidence): Promise<AuthenticatedHumanPrincipal | null>;
}

export type ExecutionResult =
  | Readonly<{ status: 'ACCEPTED'; correlationId: string; idempotencyKey: string; brokerOrderId: string }>
  | Readonly<{ status: 'REJECTED'; correlationId: string; idempotencyKey: string; reason: string }>
  | Readonly<{ status: 'UNKNOWN'; correlationId: string; idempotencyKey: string; reason: string }>;

export type WorkflowFailureCode =
  | 'INVALID_INPUT' | 'INVALID_TIME' | 'RISK_NOT_APPROVED' | 'EXPIRED_PROPOSAL'
  | 'EXPIRED_RISK' | 'EXPIRED_APPROVAL' | 'KILL_SWITCH_DISABLED' | 'STALE_KILL_SWITCH'
  | 'BINDING_MISMATCH' | 'DRAFT_CHANGED' | 'QUANTITY_EXCEEDS_RISK' | 'ARTIFACT_NOT_AUTHENTIC'
  | 'INVALID_IDEMPOTENCY_KEY' | 'IDEMPOTENCY_CONFLICT' | 'IDEMPOTENCY_UNAVAILABLE'
  | 'HUMAN_AUTHENTICATION_REQUIRED';

export type WorkflowResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: WorkflowFailureCode; message: string }>;
