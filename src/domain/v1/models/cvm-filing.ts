import type { IngestionRunId } from './ingestion';
import type { IssuerId } from './issuer';

/**
 * CVM regulatory filing (Fase 2 / Item 2): DFP/ITR/FRE documents filed by
 * an already-known Issuer. Append-only — no row is ever UPDATE/DELETEd.
 *
 * Two distinct instants matter for point-in-time correctness:
 *  - `publishedAt`: when the document became publicly available (market
 *    availability axis). `filedAt <= publishedAt` always.
 *  - `createdByRun.completedAt` (NOT stored on this model): the
 *    platform's knowledgeTime — when ingestion of this row completed
 *    successfully. Always derived via join with the creating run, never
 *    persisted redundantly here.
 *
 * `referenceDate` is a civil accounting date and proves nothing about
 * availability by itself.
 */

export type CvmFilingId = string;

export type CvmDocumentType = 'DFP' | 'ITR' | 'FRE';

export interface CvmFiling {
  readonly id: CvmFilingId;
  readonly issuerId: IssuerId;
  readonly documentType: CvmDocumentType;
  /** Globally unique protocol assigned by CVM. */
  readonly cvmProtocol: string;
  /** Civil date YYYY-MM-DD the filing refers to. */
  readonly referenceDate: string;
  readonly fiscalYear: number;
  /** 1-3 for ITR; null for DFP/FRE (annual/event-based documents). */
  readonly fiscalQuarter: number | null;
  /** Instant ISO-8601 the document was filed with CVM. */
  readonly filedAt: string;
  /** Instant ISO-8601 the document became publicly available. filedAt <= publishedAt. */
  readonly publishedAt: string;
  readonly versionNumber: number;
  readonly isRestatement: boolean;
  /** Predecessor filing id in the same issuer/type/referenceDate chain; null for the first version. */
  readonly supersedesFilingId: CvmFilingId | null;
  readonly sourceUrl: string;
  /** Lowercase 64-hex-char SHA-256 of the raw source document. */
  readonly rawSha256: string;
  readonly createdByRunId: IngestionRunId;
}

/** Request to register a filing within an ingestion batch. */
export interface CvmFilingSubmission {
  readonly issuerCvmCode: string;
  readonly documentType: CvmDocumentType;
  readonly cvmProtocol: string;
  readonly referenceDate: string;
  readonly fiscalYear: number;
  readonly fiscalQuarter?: number | null;
  readonly filedAt: string;
  readonly publishedAt: string;
  readonly isRestatement: boolean;
  /** Predecessor's cvmProtocol; required when isRestatement is true. */
  readonly supersedesCvmProtocol?: string | null;
  readonly sourceUrl: string;
  readonly rawSha256: string;
}
