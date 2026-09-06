import type {
  ResearchSessionKind,
  ResearchSessionPersistedShape,
  ResearchSessionStatus,
} from '../models/research-session';

export interface ResearchSessionSubmission {
  readonly kind: ResearchSessionKind;
  readonly label: string;
  readonly notes: string | null;
  readonly configJson: string;
  readonly createdBy: string;
}

export interface ResearchSessionDraftPatch {
  readonly label?: string;
  readonly notes?: string | null;
  readonly configJson?: string;
}

export interface ResearchSessionListQuery {
  readonly kind?: ResearchSessionKind;
  readonly status?: ResearchSessionStatus;
  readonly limit: number;
  readonly cursor?: string;
}

export type ResearchSessionOutcome =
  | { readonly status: 'DONE'; readonly resultJson: string }
  | { readonly status: 'FAILED'; readonly errorSummary: string };

export interface ResearchSessionRepository {
  create(submission: ResearchSessionSubmission): Promise<ResearchSessionPersistedShape>;
  findById(sessionId: string): Promise<ResearchSessionPersistedShape | null>;
  list(query: ResearchSessionListQuery): Promise<readonly ResearchSessionPersistedShape[]>;
  /** `null` quando a sessão não existe ou não está em DRAFT. */
  updateDraft(sessionId: string, patch: ResearchSessionDraftPatch): Promise<ResearchSessionPersistedShape | null>;
  /** Update CONDICIONAL DRAFT->RUNNING. `true` só para quem venceu a corrida. */
  claimForRun(sessionId: string): Promise<boolean>;
  /** Fecha uma sessão RUNNING em DONE (com resultado) ou FAILED (com resumo sanitizado). */
  finish(sessionId: string, outcome: ResearchSessionOutcome): Promise<ResearchSessionPersistedShape | null>;
  /** Cancela DRAFT ou RUNNING. Idempotente sobre sessão terminal: devolve a linha sem alterar. */
  cancel(sessionId: string): Promise<ResearchSessionPersistedShape | null>;
  delete(sessionId: string): Promise<boolean>;
}
