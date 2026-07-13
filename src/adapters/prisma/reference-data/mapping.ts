import type {
  IngestionRun as IngestionRunRow,
  InstrumentVersion as InstrumentVersionRow,
  Issuer as IssuerRow,
} from '@prisma/client';
import type { IngestionRun, IngestionRunStatus } from '../../../domain/v1/models/ingestion';
import type { AssetClass } from '../../../domain/v1/models/instrument';
import type {
  InstrumentLifecycleStatus,
  InstrumentVersion,
  ValidFromBasis,
} from '../../../domain/v1/models/instrument-version';
import type { Issuer } from '../../../domain/v1/models/issuer';

export const toIngestionRun = (row: IngestionRunRow): IngestionRun => ({
  id: row.id,
  sourceKey: row.sourceKey,
  status: row.status as IngestionRunStatus,
  startedAt: row.startedAt.toISOString(),
  completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  summary: row.summary,
});

export const toIssuer = (row: IssuerRow): Issuer => ({
  id: row.id,
  cvmCode: row.cvmCode,
  cnpj: row.cnpj,
  name: row.name,
  createdByRunId: row.createdByRunId,
});

/**
 * `effectiveValidTo` is the caller-computed, knowledge-time-visible
 * closure instant (or null if the interval must appear open from that
 * vantage point); it deliberately overrides `row.validTo` so the
 * bitemporal contract on InstrumentRepository holds.
 */
export const toInstrumentVersion = (
  row: InstrumentVersionRow,
  effectiveValidTo: string | null,
  effectiveClosedByRunId: string | null,
): InstrumentVersion => ({
  id: row.id,
  symbol: row.symbol,
  exchange: row.exchange,
  currency: row.currency,
  displayName: row.displayName,
  assetClass: row.assetClass as AssetClass,
  status: row.status as InstrumentLifecycleStatus,
  priceScalePow: row.priceScalePow,
  quantityScalePow: row.quantityScalePow,
  lotSize: row.lotSize,
  validFrom: row.validFrom.toISOString(),
  validTo: effectiveValidTo,
  validFromBasis: row.validFromBasis as ValidFromBasis,
  issuerId: row.issuerId,
  createdByRunId: row.createdByRunId,
  closedByRunId: effectiveClosedByRunId,
});
