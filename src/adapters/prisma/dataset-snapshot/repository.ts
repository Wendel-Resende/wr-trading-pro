import type { PrismaClient } from '@prisma/client';
import type { DatasetSnapshot } from '../../../domain/v1/models/dataset-snapshot';
import type { DatasetSnapshotQuery, DatasetSnapshotRepository } from '../../../domain/v1/ports/dataset-snapshot-repository';
import { toDatasetSnapshot } from './mapping';
import { DatasetSnapshotQuerySchema } from './schemas';

/**
 * Prisma implementation of DatasetSnapshotRepository. Read-only: no
 * update/delete/upsert method exists on this class at all. Rows are
 * filtered by exact `decisionTime` and an inclusive `knowledgeTime`
 * upper bound (defaults to `decisionTime` when omitted), optionally
 * narrowed to a `[from, to]` knowledgeTime window. Results are ordered
 * by `knowledgeTime ASC`, with `id` as a deterministic tiebreaker.
 */
export class PrismaDatasetSnapshotRepository implements DatasetSnapshotRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findSnapshots(query: DatasetSnapshotQuery): Promise<readonly DatasetSnapshot[]> {
    const normalized = DatasetSnapshotQuerySchema.parse(query);
    const knowledgeUpperBoundIso = normalized.knowledgeTime ?? normalized.decisionTime;
    const upperBoundIso =
      normalized.to !== undefined && normalized.to < knowledgeUpperBoundIso ? normalized.to : knowledgeUpperBoundIso;

    const knowledgeTimeFilter: { lte: Date; gte?: Date } = { lte: new Date(upperBoundIso) };
    if (normalized.from !== undefined) knowledgeTimeFilter.gte = new Date(normalized.from);

    const rows = await this.prisma.datasetSnapshot.findMany({
      where: {
        decisionTime: new Date(normalized.decisionTime),
        knowledgeTime: knowledgeTimeFilter,
      },
      orderBy: [{ knowledgeTime: 'asc' }, { id: 'asc' }],
      take: normalized.limit,
      skip: normalized.offset,
    });

    return Object.freeze(rows.map(toDatasetSnapshot));
  }
}
