/** Fase 6 — Consolidação. Erros do adapter Prisma de `OptionPosition`. */
export class OptionPositionAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptionPositionAdapterError';
  }
}

export class InvalidOptionPositionInputError extends OptionPositionAdapterError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOptionPositionInputError';
  }
}

export class OptionPositionNotFoundError extends OptionPositionAdapterError {
  constructor(message: string) {
    super(message);
    this.name = 'OptionPositionNotFoundError';
  }
}
