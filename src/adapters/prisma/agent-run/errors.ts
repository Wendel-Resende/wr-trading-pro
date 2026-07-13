/** Base class for agent-run adapter failures. Instances are thrown, never used as control flow across the domain/adapter boundary. */
export class AgentRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidAgentRunInputError extends AgentRunError {
  constructor(message: string, public readonly issues: readonly string[] = []) {
    super(message);
  }
}

export class AgentRunNotFoundError extends AgentRunError {}

export class InvalidAgentRunTransitionError extends AgentRunError {}
