import type { PrismaClient } from '@prisma/client';
import type { SignalSubmission } from '../../../domain/v1/models/signal';
import { PrismaSignalRepository } from './repository';

export async function insertSignalForTest(prisma: PrismaClient, submission: SignalSubmission): Promise<string> {
  const repo = new PrismaSignalRepository(prisma);
  const signal = await repo.create(submission);
  return signal.signalId;
}
