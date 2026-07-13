/** Base class for reconciliation adapter failures. Instances are thrown, never used as control flow across the domain/adapter boundary. */
export class ReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidReconciliationQueryError extends ReconciliationError {}
