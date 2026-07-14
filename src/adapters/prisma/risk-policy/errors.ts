/** Base class for risk-policy adapter failures. Instances are thrown, never used as control flow across the domain/adapter boundary. */
export class RiskPolicyAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidRiskPolicyInputError extends RiskPolicyAdapterError {
  constructor(message: string, public readonly issues: readonly string[] = []) {
    super(message);
  }
}

export class RiskDecisionNotFoundError extends RiskPolicyAdapterError {}
