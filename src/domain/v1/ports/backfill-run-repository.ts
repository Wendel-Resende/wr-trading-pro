import type { BackfillRun, BackfillRunSubmission } from '../models/backfill-run';

export interface BackfillRunRepository {
  create(submission: BackfillRunSubmission): Promise<BackfillRun>;
  /** Mais recente primeiro (`createdAt desc`) — usado para hidratar o estado "último backfill". */
  findLatest(): Promise<BackfillRun | null>;
}
