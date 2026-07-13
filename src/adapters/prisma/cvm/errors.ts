/** Base class for CVM adapter failures. Instances are thrown, never used as control flow across the domain/adapter boundary. */
export class CvmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidCvmInputError extends CvmError {
  constructor(message: string, public readonly issues: readonly string[] = []) {
    super(message);
  }
}

export class RunNotFoundError extends CvmError {}

/** commit()/fail() called on a run that is not currently RUNNING; the whole batch fails closed. */
export class RunNotRunningError extends CvmError {}

/** commit()/fail() called with a completedAt strictly before the run's own startedAt. */
export class RunChronologyError extends CvmError {}

/** A filing/fact submission references an issuerCvmCode that does not already exist. The CVM batch never creates issuers. */
export class UnknownIssuerReferenceError extends CvmError {}

/** cvmProtocol already exists with content/metadata that diverges from the resubmission (including hash). */
export class FilingProtocolConflictError extends CvmError {}

/** A restatement's supersedesCvmProtocol does not resolve to an existing filing (in-batch or persisted), or is missing when isRestatement is true. */
export class UnknownPredecessorFilingError extends CvmError {}

/** A restatement's declared predecessor is already superseded by a different filing. */
export class PredecessorAlreadySupersededError extends CvmError {}

/** A restatement/version-chain rule is violated: mismatched issuer/type/referenceDate, wrong versionNumber, first-version metadata, etc. */
export class FilingChainViolationError extends CvmError {}

/** A fact/share-capital submission's filingCvmProtocol does not resolve to a filing in the batch or already persisted. */
export class UnknownFilingReferenceError extends CvmError {}

/** Exact duplicate CvmFact key (filingId+statementType+scope+accountCode+periodStart+periodEnd) within the same batch. */
export class DuplicateFactError extends CvmError {}

/** Exact duplicate ShareCapitalFact key (filingId+shareClass+periodEnd+quantityType) within the same batch. */
export class DuplicateShareCapitalFactError extends CvmError {}
