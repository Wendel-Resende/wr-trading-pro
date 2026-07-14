export class ModelVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidModelVersionInputError extends ModelVersionError {}

export class ModelVersionNotFoundError extends ModelVersionError {}

/** kind='ML' without a valid trainingEvidenceJson (A20). */
export class MissingTrainingEvidenceError extends ModelVersionError {}
