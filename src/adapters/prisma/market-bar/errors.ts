/** Base class for market-bar adapter failures. Instances are thrown, never used as control flow across the domain/adapter boundary. */
export class MarketBarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidMarketBarInputError extends MarketBarError {
  constructor(message: string, public readonly issues: readonly string[] = []) {
    super(message);
  }
}

export class RunNotFoundError extends MarketBarError {}

/** commit()/fail() called on a run that is not currently RUNNING; the whole batch fails closed. */
export class RunNotRunningError extends MarketBarError {}

/** commit()/fail() called with a completedAt strictly before the run's own startedAt. */
export class RunChronologyError extends MarketBarError {}

/** A bar submission references an instrumentVersionId that does not exist. This unit of work never creates an InstrumentVersion. */
export class UnknownInstrumentVersionReferenceError extends MarketBarError {}

/** The referenced InstrumentVersion's creating run was not SUCCEEDED-and-completed at or before this run's completedAt: not yet knowable point-in-time. */
export class InstrumentVersionNotKnownError extends MarketBarError {}

/** The bar's openedAt falls outside the InstrumentVersion's known business-time interval [validFrom, validTo) as of this run's completedAt. */
export class OpenedAtOutOfKnownRangeError extends MarketBarError {}

/** sourceKey starts with "sqx" but the referenced InstrumentVersion.symbol does not start with WIN/WDO (or vice-versa violation). Fail closed — the generic persistence layer never chooses a source on its own. */
export class SourceSymbolRuleViolationError extends MarketBarError {}

/** Same sourceRecordKey appears more than once within the same batch — an error even when the payloads are identical. */
export class DuplicateSourceRecordError extends MarketBarError {}

/** sourceRecordKey already exists with content that diverges from the resubmission. */
export class BarConflictError extends MarketBarError {}

/** A revision's supersedesSourceRecordKey does not resolve to an existing bar (in-batch or persisted), or is missing/present when it should not be. */
export class UnknownPredecessorBarError extends MarketBarError {}

/** A revision's declared predecessor is already superseded by a different bar. */
export class PredecessorAlreadySupersededError extends MarketBarError {}

/** A revision-chain rule is violated: mismatched instrumentVersionId/timeframe/sourceKey/openedAt, wrong revisionNumber, out-of-order sourceAvailableAt/completedAt, cycle, or a new root submitted for an already-existing chain. */
export class BarChainViolationError extends MarketBarError {}
