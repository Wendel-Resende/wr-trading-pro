import type { IngestionRunId } from './ingestion';
import type { IssuerId } from './issuer';
import type { CvmFilingId } from './cvm-filing';

/**
 * A single exact-valued accounting fact extracted from a CvmFiling
 * (Fase 2 / Item 2). Real value = valueRaw * 10^scalePow; `originalScale`
 * preserves the source's declared representation (never assumed zero).
 *
 * `durationType`:
 *  - INSTANT: periodStart === periodEnd (a balance-sheet-style point).
 *  - DURATION: periodStart <= periodEnd (an income-statement-style span).
 *
 * Uniqueness within a filing:
 * filingId + statementType + scope + accountCode + periodStart + periodEnd.
 * An exact duplicate within the same batch fails closed — no
 * last-write-wins.
 *
 * `valueRaw` is constrained to the SQLite signed 64-bit range
 * [-9223372036854775808, 9223372036854775807]; no additional
 * plausibility bound is applied here.
 */

export type CvmFactId = string;

export type CvmStatementType = 'BPA' | 'BPP' | 'DRE' | 'DFC_MD' | 'DFC_MI' | 'DVA' | 'DMPL';

export type CvmScope = 'CON' | 'IND';

export type CvmDurationType = 'INSTANT' | 'DURATION';

export type CvmOriginalScale = 'UNIT' | 'THOUSAND' | 'MILLION';

export type CvmFactQuality = 'AUDITED' | 'REVIEWED' | 'UNAUDITED' | 'RESTATED';

export interface CvmFact {
  readonly id: CvmFactId;
  readonly filingId: CvmFilingId;
  readonly issuerId: IssuerId;
  readonly statementType: CvmStatementType;
  readonly scope: CvmScope;
  readonly accountCode: string;
  readonly accountLabel: string;
  /** Civil date YYYY-MM-DD, inclusive. */
  readonly periodStart: string;
  /** Civil date YYYY-MM-DD, inclusive. periodStart === periodEnd for INSTANT. */
  readonly periodEnd: string;
  readonly durationType: CvmDurationType;
  /** Exact integer mantissa; real value = valueRaw * 10^scalePow. */
  readonly valueRaw: bigint;
  readonly scalePow: number;
  /** Source-declared scale, preserved for audit. */
  readonly originalScale: CvmOriginalScale;
  /** ISO-4217 currency code. */
  readonly currency: string;
  readonly quality: CvmFactQuality;
  readonly createdByRunId: IngestionRunId;
}

/** Request to register a fact within an ingestion batch, addressed to its filing by cvmProtocol. */
export interface CvmFactSubmission {
  readonly filingCvmProtocol: string;
  readonly statementType: CvmStatementType;
  readonly scope: CvmScope;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly durationType: CvmDurationType;
  readonly valueRaw: bigint;
  readonly scalePow: number;
  readonly originalScale: CvmOriginalScale;
  readonly currency: string;
  readonly quality: CvmFactQuality;
}
