import type { PrismaClient } from '@prisma/client';
import type { ModelVersionSubmission } from '../../../domain/v1/models/model-version';
import { PrismaModelVersionRepository } from './repository';

export async function insertModelVersionForTest(prisma: PrismaClient, submission: ModelVersionSubmission): Promise<string> {
  const repo = new PrismaModelVersionRepository(prisma);
  const version = await repo.create(submission);
  return version.modelVersion;
}
