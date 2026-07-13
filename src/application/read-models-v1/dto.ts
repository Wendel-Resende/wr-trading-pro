/**
 * Wire DTOs for Fase 2 / Item 4 (read models v1). All identifiers and
 * quality/provenance fields required for audit are preserved verbatim
 * from the canonical domain models; nothing is renamed away from its
 * semantics (e.g. `open` stays a ScaledDecimalDTO, never a bare number).
 *
 * Civil dates (YYYY-MM-DD) remain plain strings end-to-end and are
 * never routed through `Date` during serialization. BigInt values are
 * always exact decimal strings, never `Number`.
 */

/** Exact scaled value: real value = raw * 10^scalePow. `decimal` is computed deterministically, no float/exponent. */
export interface ScaledDecimalDTO {
  readonly raw: string;
  readonly scalePow: number;
  readonly decimal: string;
}

export interface RunProvenanceDTO {
  readonly runId: string;
  readonly sourceKey: string;
  readonly completedAt: string;
}

export interface InstrumentVersionReadModelV1 {
  readonly id: string;
  readonly symbol: string;
  readonly exchange: string;
  readonly currency: string;
  readonly displayName: string;
  readonly assetClass: string;
  readonly status: string;
  readonly priceScalePow: number | null;
  readonly quantityScalePow: number | null;
  readonly lotSize: number | null;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly validFromBasis: string;
  readonly issuerId: string | null;
  readonly provenance: RunProvenanceDTO;
}

export interface EffectiveCvmFilingReadModelV1 {
  readonly id: string;
  readonly issuerId: string;
  readonly documentType: string;
  readonly cvmProtocol: string;
  readonly referenceDate: string;
  readonly fiscalYear: number;
  readonly fiscalQuarter: number | null;
  readonly filedAt: string;
  readonly publishedAt: string;
  readonly versionNumber: number;
  readonly isRestatement: boolean;
  readonly predecessorFilingId: string | null;
  readonly sourceUrl: string;
  readonly rawSha256: string;
  readonly provenance: RunProvenanceDTO;
}

export interface CvmFactReadModelV1 {
  readonly id: string;
  readonly filingId: string;
  readonly issuerId: string;
  readonly statementType: string;
  readonly scope: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly durationType: string;
  readonly value: ScaledDecimalDTO;
  readonly originalScale: string;
  readonly currency: string;
  readonly quality: string;
  readonly provenance: RunProvenanceDTO;
}

export interface ShareCapitalReadModelV1 {
  readonly id: string;
  readonly filingId: string;
  readonly issuerId: string;
  readonly shareClass: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Exact non-negative integer share count, decimal string (no scale applied). */
  readonly quantity: string;
  readonly quantityType: string;
  readonly quality: string;
  readonly provenance: RunProvenanceDTO;
}

export interface MarketBarReadModelV1 {
  readonly id: string;
  readonly instrumentVersionId: string;
  readonly timeframe: string;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly open: ScaledDecimalDTO;
  readonly high: ScaledDecimalDTO;
  readonly low: ScaledDecimalDTO;
  readonly close: ScaledDecimalDTO;
  readonly volume: ScaledDecimalDTO;
  readonly volumeSemantics: string;
  readonly tradeCount: string | null;
  readonly priceBasis: string;
  readonly quality: string;
  readonly revisionNumber: number;
  readonly predecessorBarId: string | null;
  /** Derived from the creating run; also present inside `provenance.sourceKey` (same value). */
  readonly sourceKey: string;
  /** Normalized source-native identity of the observation, unique within sourceKey. */
  readonly sourceRecordKey: string;
  readonly sourceAvailableAt: string;
  readonly rawSha256: string;
  /** Run provenance only — never mixed with observation-level metadata (see fields above). */
  readonly provenance: RunProvenanceDTO;
}
