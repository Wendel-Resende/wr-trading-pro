/** Base class for order-intent adapter failures. Instances are thrown, never used as control flow across the domain/adapter boundary. */
export class OrderIntentAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidOrderIntentInputError extends OrderIntentAdapterError {
  constructor(message: string, public readonly issues: readonly string[] = []) {
    super(message);
  }
}

export class OrderIntentNotFoundError extends OrderIntentAdapterError {}
