import type { PrismaClient } from '@prisma/client';
import type { DatasetSnapshotSubmission } from '../../../domain/v1/models/dataset-snapshot';
import { IngestionRunIdSchema, DatasetSnapshotSubmissionSchema } from './schemas';
import { stringifyDomains } from './mapping';
import { RunNotFoundError, RunNotSucceededError } from './errors';

/**
 * Minimal internal seeding helper used ONLY by the test harness. Not
 * part of the public DatasetSnapshotRepository port — DatasetSnapshot
 * has no HTTP write path and no general ingestion unit of work.
 */
export async function insertSnapshotForTest(
  prisma: PrismaClient,
  createdByRunId: string,
  submission: DatasetSnapshotSubmission,
): Promise<string> {
  const normalizedRunId = IngestionRunIdSchema.parse(createdByRunId);
  const run = await prisma.ingestionRun.findUnique({ where: { id: normalizedRunId } });
  if (!run) throw new RunNotFoundError(`run ${normalizedRunId} não encontrada`);
  if (run.status !== 'SUCCEEDED') {
    throw new RunNotSucceededError(`run ${normalizedRunId} precisa estar SUCCEEDED para criar um DatasetSnapshot`);
  }
  const parsed = DatasetSnapshotSubmissionSchema.parse(submission);
  const row = await prisma.datasetSnapshot.create({
    data: {
      snapshotId: parsed.snapshotId,
      asOf: new Date(parsed.asOf),
      knowledgeTime: new Date(parsed.knowledgeTime),
      decisionTime: new Date(parsed.decisionTime),
      domains: stringifyDomains(parsed.domains),
      createdByRunId: normalizedRunId,
    },
  });
  return row.id;
}
