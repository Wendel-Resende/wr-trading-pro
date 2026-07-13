/** Base class for reference-data adapter failures. Instances are thrown, never used as control flow across the domain/adapter boundary. */
export class ReferenceDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidReferenceDataInputError extends ReferenceDataError {
  constructor(message: string, public readonly issues: readonly string[] = []) {
    super(message);
  }
}

export class RunNotFoundError extends ReferenceDataError {}

/** commit()/fail() called on a run that is not currently RUNNING; the whole batch fails closed. */
export class RunNotRunningError extends ReferenceDataError {}

/** commit()/fail() called with a completedAt strictly before the run's own startedAt. */
export class RunChronologyError extends ReferenceDataError {}

/** A registered issuer's cvmCode already exists with different identity fields (cnpj and/or name). */
export class IssuerIdentityConflictError extends ReferenceDataError {}

/** A cnpj is already bound to a different cvmCode. */
export class DuplicateCnpjError extends ReferenceDataError {}

/** An instrument version references an issuerCvmCode that does not exist in the batch or in prior data. */
export class UnknownIssuerReferenceError extends ReferenceDataError {}

/** Duplicate validFrom, overlapping interval, or more-than-one-open-interval for a (symbol, exchange). */
export class InstrumentIntervalConflictError extends ReferenceDataError {}
