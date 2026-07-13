import type { PrismaClient } from '@prisma/client';
import type { IngestionRun } from '../../../domain/v1/models/ingestion';
import type { IngestionLedger, IngestionRunQuery } from '../../../domain/v1/ports/ingestion-ledger';
import { toIngestionRun } from './mapping';
import { IngestionRunIdSchema, IngestionRunStatusSchema, SourceKeySchema } from './schemas';

/** Read-only access to the ledger. Every argument is validated/normalized at this boundary — never queried raw. */
export class PrismaIngestionLedger implements IngestionLedger {
  constructor(private readonly prisma: PrismaClient) {}

  async getRun(id: string): Promise<IngestionRun | null> {
    const normalizedId = IngestionRunIdSchema.parse(id);
    const row = await this.prisma.ingestionRun.findUnique({ where: { id: normalizedId } });
    return row ? toIngestionRun(row) : null;
  }

  async findRuns(query: IngestionRunQuery = {}): Promise<readonly IngestionRun[]> {
    const sourceKey = query.sourceKey !== undefined ? SourceKeySchema.parse(query.sourceKey) : undefined;
    const status = query.status !== undefined ? IngestionRunStatusSchema.parse(query.status) : undefined;
    const rows = await this.prisma.ingestionRun.findMany({
      where: { sourceKey, status },
      orderBy: { startedAt: 'asc' },
    });
    return Object.freeze(rows.map(toIngestionRun));
  }
}
