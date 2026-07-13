/** Base class for feature-value adapter failures. Instances are thrown, never used as control flow across the domain/adapter boundary. */
export class FeatureValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidFeatureValueInputError extends FeatureValueError {
  constructor(message: string, public readonly issues: readonly string[] = []) {
    super(message);
  }
}

export class RunNotFoundError extends FeatureValueError {}

export class RunNotSucceededError extends FeatureValueError {}

/** Same (featureId, decisionTime, knowledgeTime) already exists — append-only violation. */
export class DuplicateFeatureValueError extends FeatureValueError {}
