import type { ReconciliationDomain, ReconciliationOverallStatus, ReconciliationReport, ReconciliationRow } from '../../domain/v1/models/reconciliation';
import type { ReconciliationRepository } from '../../domain/v1/ports/reconciliation-repository';
import { compareInstants, parseInstant } from '../../domain/v1/time';
import { ReadModelError } from '../read-models-v1/errors';

export interface ReconciliationServicePorts {
  readonly reconciliationRepository: ReconciliationRepository;
}

export interface ReconciliationPlanQueryV1 {
  readonly decisionTime: string;
  readonly knowledgeTime?: string;
  readonly domain?: ReconciliationDomain;
  readonly subjectId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ReconciliationReportQueryV1 {
  readonly decisionTime: string;
  readonly knowledgeTime?: string;
  readonly from?: string;
  readonly to?: string;
  readonly domain?: ReconciliationDomain;
}

function requireInstant(value: string, field: string): void {
  if (parseInstant(value) === null) {
    throw new ReadModelError('INVALID_QUERY', `${field} inválido: timestamp ISO-8601 exigido`);
  }
}

/** Resolves `knowledgeTime` (defaulting to `decisionTime`) and enforces the no-lookahead invariant. Throws ReadModelError('INVALID_TIME_RANGE', ...) when knowledgeTime > decisionTime. */
function resolveKnowledgeTime(decisionTime: string, knowledgeTime: string | undefined): string {
  requireInstant(decisionTime, 'decisionTime');
  const resolved = knowledgeTime ?? decisionTime;
  requireInstant(resolved, 'knowledgeTime');
  if (compareInstants(parseInstant(resolved)!, parseInstant(decisionTime)!) > 0) {
    throw new ReadModelError('INVALID_TIME_RANGE', 'knowledgeTime não pode ser posterior a decisionTime');
  }
  return resolved;
}

/**
 * `overall` computation per Fase 2 / Item 6 spec section 1.3:
 * - PARIDADE: mismatchSamples === 0 in every row.
 * - SEM_PARIDADE: mismatchSamples > 0 in every row.
 * - PARIDADE_PARCIAL: mixed (at least one row without mismatch, at least
 *   one with).
 * An empty domain set (nothing was compared) cannot claim parity: it is
 * conservatively SEM_PARIDADE.
 */
export function computeOverallStatus(rows: readonly ReconciliationRow[]): ReconciliationOverallStatus {
  if (rows.length === 0) return 'SEM_PARIDADE';
  const allWithoutMismatch = rows.every((row) => row.mismatchSamples === 0);
  if (allWithoutMismatch) return 'PARIDADE';
  const allWithMismatch = rows.every((row) => row.mismatchSamples > 0);
  if (allWithMismatch) return 'SEM_PARIDADE';
  return 'PARIDADE_PARCIAL';
}

/**
 * Application service for the read-only reconciliation HTTP surface
 * (Fase 2 / Item 6). Depends only on the injected ReconciliationRepository
 * port — never touches Prisma directly. No default clock: every temporal
 * parameter is explicit. Never writes to legacy tables/services.
 */
export class ReconciliationService {
  constructor(private readonly ports: ReconciliationServicePorts) {}

  async getPlan(query: ReconciliationPlanQueryV1): Promise<readonly ReconciliationRow[]> {
    const knowledgeTime = resolveKnowledgeTime(query.decisionTime, query.knowledgeTime);

    return this.ports.reconciliationRepository.computeRows({
      decisionTime: query.decisionTime,
      knowledgeTime,
      domain: query.domain,
      subjectId: query.subjectId,
      limit: query.limit,
      offset: query.offset,
    });
  }

  async getReport(query: ReconciliationReportQueryV1): Promise<ReconciliationReport> {
    const knowledgeTime = resolveKnowledgeTime(query.decisionTime, query.knowledgeTime);
    if (query.from !== undefined) requireInstant(query.from, 'from');
    if (query.to !== undefined) requireInstant(query.to, 'to');

    const rows = await this.ports.reconciliationRepository.computeRows({
      decisionTime: query.decisionTime,
      knowledgeTime,
      domain: query.domain,
      from: query.from,
      to: query.to,
    });

    const overall = computeOverallStatus(rows);
    const computedAt = new Date().toISOString();

    return Object.freeze({
      reportId: `reconciliation-report:${query.decisionTime}:${knowledgeTime}:${query.domain ?? 'all'}`,
      from: query.from ?? query.decisionTime,
      to: query.to ?? query.decisionTime,
      domains: rows,
      overall,
      computedAt,
      knowledgeTime,
      decisionTime: query.decisionTime,
      provenance: { runId: `reconciliation:report:${query.decisionTime}:${knowledgeTime}`, sourceKey: 'reconciliation:v1:on-demand' },
    });
  }
}
