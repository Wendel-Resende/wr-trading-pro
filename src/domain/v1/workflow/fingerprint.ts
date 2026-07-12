import type { OrderDraft } from './models';

const encodeNumber = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) throw new Error('invalid positive finite number');
  return JSON.stringify(value);
};

/** Canonicalizes every executable and binding field of the exact validated draft. */
export const canonicalDraftContent = (draft: OrderDraft): string => {
  const nullable = (value: number | null): string => value === null ? 'null' : encodeNumber(value);
  return `{"schemaVersion":${JSON.stringify(draft.schemaVersion)},"kind":${JSON.stringify(draft.kind)},"id":${JSON.stringify(draft.id)},"createdAt":${JSON.stringify(draft.createdAt)},"executionEligible":false,"proposalId":${JSON.stringify(draft.proposalId)},"accountId":${JSON.stringify(draft.accountId)},"instrument":${JSON.stringify(draft.instrument)},"side":${JSON.stringify(draft.side)},"orderType":${JSON.stringify(draft.orderType)},"quantity":${encodeNumber(draft.quantity)},"limitPrice":${nullable(draft.limitPrice)},"stopLoss":${nullable(draft.stopLoss)},"takeProfit":${nullable(draft.takeProfit)},"state":"draft","humanApproval":null,"idempotencyKey":null}`;
};

/**
 * Exact, collision-free (within this process/string model) canonical binding.
 * This is deliberately not a hash or signature and may be long.
 */
export const fingerprintOrderDraft = (draft: OrderDraft): string =>
  `draft-v1-canonical:${canonicalDraftContent(draft)}`;
