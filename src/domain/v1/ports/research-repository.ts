import type { ResearchRun, ResearchRunSubmission } from '../models/research-run';

export interface ResearchRunRepository {
  create(submission: ResearchRunSubmission, createdBy: string): Promise<ResearchRun>;
  findById(runId: string): Promise<ResearchRun | null>;
  findByDataset(datasetId: string): Promise<readonly ResearchRun[]>;
}
