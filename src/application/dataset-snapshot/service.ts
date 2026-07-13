import type { DatasetSnapshotRepository } from '../../domain/v1/ports/dataset-snapshot-repository';
import type { IngestionLedger } from '../../domain/v1/ports/ingestion-ledger';
import { compareInstants, parseInstant } from '../../domain/v1/time';
import { ReadModelError } from '../read-models-v1/errors';
import { ProvenanceResolver } from '../read-models-v1/provenance';
import { assembleDatasetSnapshot } from './assemblers';
import type { DatasetSnapshotReadModelV1 } from './dto';

export interface DatasetSnapshotServicePorts {
  readonly datasetSnapshotRepository: DatasetSnapshotRepository;
  readonly ingestionLedger: IngestionLedger;
}

export interface DatasetSnapshotQueryV1 {
  readonly decisionTime: string;
  readonly knowledgeTime?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

function requireInstant(value: string, field: string): void {
  if (parseInstant(value) === null) {
    throw new ReadModelError('INVALID_QUERY', `${field} inválido: timestamp ISO-8601 exigido`);
  }
}

/**
 * Application service for the read-only, point-in-time DatasetSnapshot
 * HTTP surface (Fase 2 / Item 5). Depends only on injected ports —
 * never touches Prisma directly. No default clock: every temporal
 * parameter is explicit.
 */
export class DatasetSnapshotService {
  private readonly provenance: ProvenanceResolver;

  constructor(private readonly ports: DatasetSnapshotServicePorts) {
    this.provenance = new ProvenanceResolver(ports.ingestionLedger);
  }

  async getSnapshots(query: DatasetSnapshotQueryV1): Promise<readonly DatasetSnapshotReadModelV1[]> {
    requireInstant(query.decisionTime, 'decisionTime');
    const knowledgeTime = query.knowledgeTime ?? query.decisionTime;
    requireInstant(knowledgeTime, 'knowledgeTime');
    if (compareInstants(parseInstant(knowledgeTime)!, parseInstant(query.decisionTime)!) > 0) {
      throw new ReadModelError('INVALID_TIME_RANGE', 'knowledgeTime não pode ser posterior a decisionTime');
    }

    const rows = await this.ports.datasetSnapshotRepository.findSnapshots({
      decisionTime: query.decisionTime,
      knowledgeTime,
      from: query.from,
      to: query.to,
      limit: query.limit,
      offset: query.offset,
    });

    const snapshots: DatasetSnapshotReadModelV1[] = [];
    for (const row of rows) {
      const provenance = await this.provenance.resolve(row.createdByRunId);
      snapshots.push(assembleDatasetSnapshot(row, provenance));
    }
    return Object.freeze(snapshots);
  }
}
