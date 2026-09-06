export class ResearchSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidResearchSessionInputError extends ResearchSessionError {}
export class ResearchSessionNotFoundError extends ResearchSessionError {}
