/**
 * Item B (auditoria final do Guardião, 2026-07-22, bloqueador crítico 1):
 * cobertura/falhas do último backfill D1 persistidas server-side —
 * append-only, nunca `localStorage`, nunca `useState` como única fonte.
 * `failures`/`updatedSymbols` já chegam sanitizados na fronteira HTTP
 * (nunca a mensagem bruta do Python) — este modelo de domínio não decide
 * sanitização, só transporta o que a camada de aplicação já limpou.
 */
export type BackfillRunStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';

export interface BackfillFailureEntry {
  readonly ticker: string;
  readonly reasonSummary: string;
}

export interface BackfillRun {
  readonly backfillRunId: string;
  readonly requestedBy: string;
  readonly createdAt: string;
  readonly status: BackfillRunStatus;
  readonly eligibleCount: number;
  readonly updatedCount: number;
  readonly failedCount: number;
  readonly updatedSymbols: readonly string[];
  readonly failures: readonly BackfillFailureEntry[];
}

export interface BackfillRunSubmission {
  readonly requestedBy: string;
  readonly status: BackfillRunStatus;
  readonly eligibleCount: number;
  readonly updatedCount: number;
  readonly failedCount: number;
  readonly updatedSymbols: readonly string[];
  readonly failures: readonly BackfillFailureEntry[];
}
