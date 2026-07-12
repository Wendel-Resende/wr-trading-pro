import type { ExecutionResult } from '../workflow/models';
import type { GovernedOrderIntent } from '../workflow/order-intent';

/**
 * Side-effect boundary. Implementations are deferred to Item 4.
 * Every adapter MUST call isGovernedOrderIntent before its first side effect and
 * reject values that fail the runtime guard; the TypeScript type alone is not a trust boundary.
 */
export interface ExecutionBroker {
  execute(intent: GovernedOrderIntent): Promise<ExecutionResult>;
}
