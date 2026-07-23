import type { PrismaClient } from '@prisma/client';
import type { ModelVersion, ModelVersionKind, ModelVersionSubmission } from '../../../domain/v1/models/model-version';
import type { ModelVersionRepository } from '../../../domain/v1/ports/model-version-repository';
import { ModelVersionNotFoundError } from './errors';
import { toModelVersion } from './mapping';
import { ModelVersionSubmissionSchema } from './schemas';

export class PrismaModelVersionRepository implements ModelVersionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(submission: ModelVersionSubmission): Promise<ModelVersion> {
    const parsed = ModelVersionSubmissionSchema.parse(submission);
    const row = await this.prisma.modelVersion.create({
      data: {
        kind: parsed.kind,
        label: parsed.label,
        asOf: new Date(parsed.asOf),
        hyperparametersJson: parsed.hyperparametersJson,
        trainingEvidenceJson: parsed.trainingEvidenceJson ?? null,
      },
    });
    return toModelVersion(row);
  }

  async findById(modelVersion: string): Promise<ModelVersion | null> {
    const row = await this.prisma.modelVersion.findUnique({ where: { modelVersion } });
    return row ? toModelVersion(row) : null;
  }

  async findByKind(kind: ModelVersionKind): Promise<readonly ModelVersion[]> {
    const rows = await this.prisma.modelVersion.findMany({
      where: { kind },
      orderBy: [{ asOf: 'asc' }, { modelVersion: 'asc' }],
    });
    return Object.freeze(rows.map(toModelVersion));
  }

  async listByKindPaginated(kind: ModelVersionKind, limit: number, cursor?: string): Promise<readonly ModelVersion[]> {
    const rows = await this.prisma.modelVersion.findMany({
      where: { kind },
      orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }, { modelVersion: 'desc' }],
      take: limit,
      ...(cursor ? { cursor: { modelVersion: cursor }, skip: 1 } : {}),
    });
    return Object.freeze(rows.map(toModelVersion));
  }

  async invalidate(modelVersion: string, invalidatedAt: string, reason: string): Promise<ModelVersion> {
    const existing = await this.prisma.modelVersion.findUnique({ where: { modelVersion } });
    if (!existing) throw new ModelVersionNotFoundError(`ModelVersion ${modelVersion} não encontrado`);
    const row = await this.prisma.modelVersion.update({
      where: { modelVersion },
      data: { invalidatedAt: new Date(invalidatedAt), invalidationReason: reason },
    });
    return toModelVersion(row);
  }

  async publish(modelVersion: string, publishedAt: string): Promise<ModelVersion> {
    const existing = await this.prisma.modelVersion.findUnique({ where: { modelVersion } });
    if (!existing) throw new ModelVersionNotFoundError(`ModelVersion ${modelVersion} não encontrado`);
    const row = await this.prisma.modelVersion.update({
      where: { modelVersion },
      data: { publishedAt: new Date(publishedAt) },
    });
    return toModelVersion(row);
  }
}
