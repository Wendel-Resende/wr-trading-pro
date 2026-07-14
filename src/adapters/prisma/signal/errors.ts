export class SignalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidSignalInputError extends SignalError {}

export class SignalNotFoundError extends SignalError {}

/** knowledgeTime > barTime: point-in-time violation (principle 1). */
export class SignalNotPointInTimeError extends SignalError {}
