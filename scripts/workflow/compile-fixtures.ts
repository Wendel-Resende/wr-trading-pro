import type { AuthenticatedHumanPrincipal, ExecutionBroker, ExecutionResult, GovernedOrderIntent,
  HumanApprovalReceipt, KillSwitchSnapshot, RiskDecision } from '../../src/domain/v1';
import { createHumanApprovalService, isGovernedOrderIntent } from '../../src/domain/v1';

const forged = { id: 'forged' };
// @ts-expect-error opaque intent cannot be forged structurally
const impossible: GovernedOrderIntent = forged;
void impossible;

// @ts-expect-error opaque artifacts cannot be forged structurally
const impossibleRisk: RiskDecision = { id: 'forged' };
// @ts-expect-error opaque artifacts cannot be forged structurally
const impossibleApproval: HumanApprovalReceipt = { id: 'forged' };
// @ts-expect-error opaque artifacts cannot be forged structurally
const impossibleSnapshot: KillSwitchSnapshot = { id: 'forged', enabled: true };
// @ts-expect-error principal is boundary-produced and opaque
const impossiblePrincipal: AuthenticatedHumanPrincipal = { actorId: 'forged' };
void impossibleRisk; void impossibleApproval; void impossibleSnapshot; void impossiblePrincipal;

const issuer = createHumanApprovalService<string>({ verify: async () => null });
// @ts-expect-error verifier is configured once and is not accepted per issue call
void issuer.issue({ verifier: { verify: async () => null } });

const broker: ExecutionBroker = {
  async execute(intent: GovernedOrderIntent): Promise<ExecutionResult> {
    if (!isGovernedOrderIntent(intent)) throw new Error('unauthentic governed intent');
    return { status: 'UNKNOWN', correlationId: intent.correlationId, idempotencyKey: intent.idempotencyKey, reason: 'adapter absent' };
  },
};
// @ts-expect-error execution broker accepts only a governed branded intent
void broker.execute(forged);
