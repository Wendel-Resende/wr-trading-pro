import type { ResearchSessionKind, ResearchSessionStatus } from '../../domain/v1/models/research-session';

export interface ResearchSessionReadModel {
  readonly sessionId: string;
  readonly kind: ResearchSessionKind;
  readonly status: ResearchSessionStatus;
  readonly label: string;
  readonly notes: string | null;
  readonly config: unknown;
  readonly result: unknown;
  readonly errorSummary: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateDraftRequest {
  readonly kind: ResearchSessionKind;
  readonly label: string;
  readonly notes: string | null;
  readonly config: unknown;
  readonly createdBy: string;
}

export interface UpdateDraftRequest {
  readonly label?: string;
  readonly notes?: string | null;
  readonly config?: unknown;
}

export interface ListRequest {
  readonly kind?: ResearchSessionKind;
  readonly status?: ResearchSessionStatus;
  readonly limit: number;
  readonly cursor?: string;
}
