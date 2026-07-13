import type {
  CvmFact as CvmFactRow,
  CvmFiling as CvmFilingRow,
  ShareCapitalFact as ShareCapitalFactRow,
} from '@prisma/client';
import type { CvmDocumentType, CvmFiling } from '../../../domain/v1/models/cvm-filing';
import type {
  CvmDurationType,
  CvmFact,
  CvmFactQuality,
  CvmOriginalScale,
  CvmScope,
  CvmStatementType,
} from '../../../domain/v1/models/cvm-fact';
import type { ShareCapitalFact, ShareQuantityType } from '../../../domain/v1/models/share-capital-fact';

export const toCvmFiling = (row: CvmFilingRow): CvmFiling => ({
  id: row.id,
  issuerId: row.issuerId,
  documentType: row.documentType as CvmDocumentType,
  cvmProtocol: row.cvmProtocol,
  referenceDate: row.referenceDate,
  fiscalYear: row.fiscalYear,
  fiscalQuarter: row.fiscalQuarter,
  filedAt: row.filedAt.toISOString(),
  publishedAt: row.publishedAt.toISOString(),
  versionNumber: row.versionNumber,
  isRestatement: row.isRestatement,
  supersedesFilingId: row.supersedesFilingId,
  sourceUrl: row.sourceUrl,
  rawSha256: row.rawSha256,
  createdByRunId: row.createdByRunId,
});

export const toCvmFact = (row: CvmFactRow): CvmFact => ({
  id: row.id,
  filingId: row.filingId,
  issuerId: row.issuerId,
  statementType: row.statementType as CvmStatementType,
  scope: row.scope as CvmScope,
  accountCode: row.accountCode,
  accountLabel: row.accountLabel,
  periodStart: row.periodStart,
  periodEnd: row.periodEnd,
  durationType: row.durationType as CvmDurationType,
  valueRaw: row.valueRaw,
  scalePow: row.scalePow,
  originalScale: row.originalScale as CvmOriginalScale,
  currency: row.currency,
  quality: row.quality as CvmFactQuality,
  createdByRunId: row.createdByRunId,
});

export const toShareCapitalFact = (row: ShareCapitalFactRow): ShareCapitalFact => ({
  id: row.id,
  filingId: row.filingId,
  issuerId: row.issuerId,
  shareClass: row.shareClass,
  periodStart: row.periodStart,
  periodEnd: row.periodEnd,
  quantity: row.quantity,
  quantityType: row.quantityType as ShareQuantityType,
  quality: row.quality as CvmFactQuality,
  createdByRunId: row.createdByRunId,
});
