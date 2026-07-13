import type { PrismaClient, Prisma } from '@prisma/client';
import type { FeatureValue } from '../../../domain/v1/models/feature-value';
import type { FeatureValueQuery, FeatureValueRepository } from '../../../domain/v1/ports/feature-value-repository';
import { toFeatureValue } from './mapping';
import { FeatureValueQuerySchema } from './schemas';

/**
 * Prisma implementation of FeatureValueRepository. Read-only: no
 * update/delete/upsert method exists on this class at all. Results are
 * ordered by `knowledgeTime ASC`, with `id` as a deterministic
 * tiebreaker, and support offset/limit pagination.
 */
export class PrismaFeatureValueRepository implements FeatureValueRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findValues(query: FeatureValueQuery): Promise<readonly FeatureValue[]> {
    const normalized = FeatureValueQuerySchema.parse(query);

    const where: Prisma.FeatureValueWhereInput = {};
    if (normalized.featureId !== undefined) where.featureId = normalized.featureId;
    if (normalized.subjectId !== undefined) where.subjectId = normalized.subjectId;
    if (normalized.decisionTime !== undefined) where.decisionTime = new Date(normalized.decisionTime);

    const knowledgeUpperBoundIso =
      normalized.knowledgeTime ?? (normalized.decisionTime !== undefined ? normalized.decisionTime : undefined);
    const upperBoundIso =
      normalized.to !== undefined && (knowledgeUpperBoundIso === undefined || normalized.to < knowledgeUpperBoundIso)
        ? normalized.to
        : knowledgeUpperBoundIso;

    if (upperBoundIso !== undefined || normalized.from !== undefined) {
      where.knowledgeTime = {
        ...(upperBoundIso !== undefined ? { lte: new Date(upperBoundIso) } : {}),
        ...(normalized.from !== undefined ? { gte: new Date(normalized.from) } : {}),
      };
    }

    const rows = await this.prisma.featureValue.findMany({
      where,
      orderBy: [{ knowledgeTime: 'asc' }, { id: 'asc' }],
      take: normalized.limit,
      skip: normalized.offset,
    });

    return Object.freeze(rows.map(toFeatureValue));
  }
}
