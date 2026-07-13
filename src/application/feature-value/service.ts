import type { FeatureValueRepository } from '../../domain/v1/ports/feature-value-repository';
import type { IngestionLedger } from '../../domain/v1/ports/ingestion-ledger';
import { compareInstants, parseInstant } from '../../domain/v1/time';
import { ReadModelError } from '../read-models-v1/errors';
import { ProvenanceResolver } from '../read-models-v1/provenance';
import { assembleFeatureValue } from './assemblers';
import type { FeatureValueReadModelV1 } from './dto';

export interface FeatureValueServicePorts {
  readonly featureValueRepository: FeatureValueRepository;
  readonly ingestionLedger: IngestionLedger;
}

export interface FeatureValueQueryV1 {
  readonly featureId?: string;
  readonly subjectId?: string;
  readonly decisionTime?: string;
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
 * Application service for the read-only, point-in-time FeatureValue
 * HTTP surface (Fase 2 / Item 5). Depends only on injected ports —
 * never touches Prisma directly. No default clock: every temporal
 * parameter is explicit.
 */
export class FeatureValueService {
  private readonly provenance: ProvenanceResolver;

  constructor(private readonly ports: FeatureValueServicePorts) {
    this.provenance = new ProvenanceResolver(ports.ingestionLedger);
  }

  async getValues(query: FeatureValueQueryV1): Promise<readonly FeatureValueReadModelV1[]> {
    if (query.decisionTime !== undefined) requireInstant(query.decisionTime, 'decisionTime');
    if (query.knowledgeTime !== undefined) requireInstant(query.knowledgeTime, 'knowledgeTime');
    if (
      query.decisionTime !== undefined
      && query.knowledgeTime !== undefined
      && compareInstants(parseInstant(query.knowledgeTime)!, parseInstant(query.decisionTime)!) > 0
    ) {
      throw new ReadModelError('INVALID_TIME_RANGE', 'knowledgeTime não pode ser posterior a decisionTime');
    }

    const rows = await this.ports.featureValueRepository.findValues(query);

    const values: FeatureValueReadModelV1[] = [];
    for (const row of rows) {
      const provenance = await this.provenance.resolve(row.createdByRunId);
      values.push(assembleFeatureValue(row, provenance));
    }
    return Object.freeze(values);
  }
}
