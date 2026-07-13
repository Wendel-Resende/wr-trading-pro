import type { PrismaClient, Prisma } from '@prisma/client';
import type { FeatureValueSubmission } from '../../../domain/v1/models/feature-value';
import { FeatureValueSubmissionSchema, IngestionRunIdSchema, SourceKeySchema } from './schemas';
import { RunNotFoundError, RunNotSucceededError, DuplicateFeatureValueError } from './errors';

/**
 * Minimal internal seeding helper used ONLY by the test harness. Not
 * part of the public FeatureValueRepository port — FeatureValue has no
 * HTTP write path and no general ingestion unit of work. sourceKey is
 * ALWAYS derived from the creating run, never accepted from the
 * submission, mirroring VersionedMarketBar.
 */
export async function insertFeatureValueForTest(
  prisma: PrismaClient,
  createdByRunId: string,
  submission: FeatureValueSubmission,
): Promise<string> {
  const normalizedRunId = IngestionRunIdSchema.parse(createdByRunId);
  const run = await prisma.ingestionRun.findUnique({ where: { id: normalizedRunId } });
  if (!run) throw new RunNotFoundError(`run ${normalizedRunId} não encontrada`);
  if (run.status !== 'SUCCEEDED') {
    throw new RunNotSucceededError(`run ${normalizedRunId} precisa estar SUCCEEDED para criar um FeatureValue`);
  }
  const sourceKey = SourceKeySchema.parse(run.sourceKey);
  const parsed = FeatureValueSubmissionSchema.parse(submission);

  try {
    const row = await prisma.featureValue.create({
      data: {
        featureId: parsed.featureId,
        subjectId: parsed.subjectId,
        featureType: parsed.featureType,
        valueRaw: parsed.valueRaw,
        scalePow: parsed.scalePow ?? null,
        enumValue: parsed.enumValue ?? null,
        label: parsed.label ?? null,
        sourceKey,
        knowledgeTime: new Date(parsed.knowledgeTime),
        decisionTime: new Date(parsed.decisionTime),
        createdByRunId: normalizedRunId,
      },
    });
    return row.id;
  } catch (error) {
    if (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error as Prisma.PrismaClientKnownRequestError).code === 'P2002'
    ) {
      throw new DuplicateFeatureValueError(
        `featureId=${parsed.featureId} já possui uma linha para (decisionTime, knowledgeTime) informados`,
      );
    }
    throw error;
  }
}
