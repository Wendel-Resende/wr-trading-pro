import type { BackfillRun } from '../../../../../domain/v1/models/backfill-run';

/**
 * Item B (bloqueador crítico 1/2): DTO público allowlist do relatório de
 * backfill — nunca `requestedBy` (identidade interna), e falhas já vêm
 * sanitizadas desde a persistência (ver `_shared/sanitize-text.ts`), mas o
 * DTO ainda pagina a lista aqui, no servidor (nunca a coleção inteira).
 */
export interface BackfillFailurePublicDTO {
  readonly ticker: string;
  readonly reasonSummary: string;
}

export interface BackfillRunPublicDTO {
  readonly backfillRunId: string;
  readonly createdAt: string;
  readonly status: BackfillRun['status'];
  readonly eligibleCount: number;
  readonly updatedCount: number;
  readonly failedCount: number;
  readonly updatedSymbols: readonly string[];
  readonly failuresPage: readonly BackfillFailurePublicDTO[];
  readonly failuresNextCursor: number | null;
}

export function toBackfillRunPublicDTO(run: BackfillRun, failuresLimit: number, failuresOffset: number): BackfillRunPublicDTO {
  const sortedFailures = [...run.failures].sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));
  const page = sortedFailures.slice(failuresOffset, failuresOffset + failuresLimit);
  const hasNext = failuresOffset + failuresLimit < sortedFailures.length;

  return {
    backfillRunId: run.backfillRunId,
    createdAt: run.createdAt,
    status: run.status,
    eligibleCount: run.eligibleCount,
    updatedCount: run.updatedCount,
    failedCount: run.failedCount,
    updatedSymbols: run.updatedSymbols,
    failuresPage: page,
    failuresNextCursor: hasNext ? failuresOffset + failuresLimit : null,
  };
}
