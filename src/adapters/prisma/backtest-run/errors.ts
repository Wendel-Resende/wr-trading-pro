export class BacktestRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidBacktestRunInputError extends BacktestRunError {}

export class BacktestRunNotFoundError extends BacktestRunError {}
