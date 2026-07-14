import type { PrismaClient } from '@prisma/client';
import type { ResearchRunSubmission } from '../../../domain/v1/models/research-run';
import { PrismaResearchRunRepository } from './repository';

/** Test-harness seeding helper: creates a ResearchRun via the real repository (never a raw Prisma insert). */
export async function insertResearchRunForTest(prisma: PrismaClient, createdBy: string, submission: ResearchRunSubmission): Promise<string> {
  const repo = new PrismaResearchRunRepository(prisma);
  const run = await repo.create(submission, createdBy);
  return run.runId;
}
