export class ResearchRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidResearchRunInputError extends ResearchRunError {}

export class ResearchRunNotFoundError extends ResearchRunError {}
