import type { ExecutionBroker, ExecutionResult, GovernedOrderIntent } from '../../domain/v1';
import { isGovernedOrderIntent } from '../../domain/v1';

export class DisabledMt5ExecutionBroker implements ExecutionBroker {
  async execute(intent:GovernedOrderIntent):Promise<ExecutionResult>{
    if(!isGovernedOrderIntent(intent))return Object.freeze({status:'UNKNOWN',correlationId:'invalid-intent',idempotencyKey:'invalid-intent',reason:'MT5 execution disabled: unauthentic governed intent'});
    return Object.freeze({status:'REJECTED',correlationId:intent.correlationId,idempotencyKey:intent.idempotencyKey,reason:'MT5 execution is disabled'});
  }
}
