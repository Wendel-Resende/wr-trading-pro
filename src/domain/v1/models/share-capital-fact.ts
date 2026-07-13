import type { IngestionRunId } from './ingestion';
import type { IssuerId } from './issuer';
import type { CvmFilingId } from './cvm-filing';
import type { CvmFactQuality } from './cvm-fact';

/**
 * Share capital composition fact extracted from a CvmFiling
 * (Fase 2 / Item 2). `periodStart === periodEnd` (always an INSTANT
 * concept — share count as of a single civil date).
 *
 * Uniqueness: filingId + shareClass + periodEnd + quantityType.
 *
 * `quantity` is non-negative and constrained to the SQLite signed
 * 64-bit range.
 */

export type ShareCapitalFactId = string;

export type ShareQuantityType = 'ISSUED' | 'OUTSTANDING' | 'TREASURY';

export interface ShareCapitalFact {
  readonly id: ShareCapitalFactId;
  readonly filingId: CvmFilingId;
  readonly issuerId: IssuerId;
  /** Normalized share class label (e.g. "ON", "PN"). */
  readonly shareClass: string;
  /** Civil date YYYY-MM-DD. periodStart === periodEnd. */
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Non-negative integer share count, signed 64-bit range. */
  readonly quantity: bigint;
  readonly quantityType: ShareQuantityType;
  readonly quality: CvmFactQuality;
  readonly createdByRunId: IngestionRunId;
}

/** Request to register a share-capital fact within an ingestion batch, addressed to its filing by cvmProtocol. */
export interface ShareCapitalFactSubmission {
  readonly filingCvmProtocol: string;
  readonly shareClass: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly quantity: bigint;
  readonly quantityType: ShareQuantityType;
  readonly quality: CvmFactQuality;
}
