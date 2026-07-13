import type { InstrumentVersion } from '../../domain/v1/models/instrument-version';
import type { CvmFiling } from '../../domain/v1/models/cvm-filing';
import type { CvmFact } from '../../domain/v1/models/cvm-fact';
import type { ShareCapitalFact } from '../../domain/v1/models/share-capital-fact';
import type { VersionedMarketBar } from '../../domain/v1/models/versioned-market-bar';
import type {
  CvmFactReadModelV1,
  EffectiveCvmFilingReadModelV1,
  InstrumentVersionReadModelV1,
  MarketBarReadModelV1,
  RunProvenanceDTO,
  ShareCapitalReadModelV1,
} from './dto';
import { toScaledDecimal } from './scaled-decimal';

/** Pure assemblers: no I/O, no clock reads. Provenance is passed in, already resolved. */

export function assembleInstrumentVersion(
  model: InstrumentVersion,
  provenance: RunProvenanceDTO,
): InstrumentVersionReadModelV1 {
  return Object.freeze({
    id: model.id,
    symbol: model.symbol,
    exchange: model.exchange,
    currency: model.currency,
    displayName: model.displayName,
    assetClass: model.assetClass,
    status: model.status,
    priceScalePow: model.priceScalePow,
    quantityScalePow: model.quantityScalePow,
    lotSize: model.lotSize,
    validFrom: model.validFrom,
    validTo: model.validTo,
    validFromBasis: model.validFromBasis,
    issuerId: model.issuerId,
    provenance,
  });
}

export function assembleEffectiveCvmFiling(
  model: CvmFiling,
  provenance: RunProvenanceDTO,
): EffectiveCvmFilingReadModelV1 {
  return Object.freeze({
    id: model.id,
    issuerId: model.issuerId,
    documentType: model.documentType,
    cvmProtocol: model.cvmProtocol,
    referenceDate: model.referenceDate,
    fiscalYear: model.fiscalYear,
    fiscalQuarter: model.fiscalQuarter,
    filedAt: model.filedAt,
    publishedAt: model.publishedAt,
    versionNumber: model.versionNumber,
    isRestatement: model.isRestatement,
    predecessorFilingId: model.supersedesFilingId,
    sourceUrl: model.sourceUrl,
    rawSha256: model.rawSha256,
    provenance,
  });
}

export function assembleCvmFact(model: CvmFact, provenance: RunProvenanceDTO): CvmFactReadModelV1 {
  return Object.freeze({
    id: model.id,
    filingId: model.filingId,
    issuerId: model.issuerId,
    statementType: model.statementType,
    scope: model.scope,
    accountCode: model.accountCode,
    accountLabel: model.accountLabel,
    periodStart: model.periodStart,
    periodEnd: model.periodEnd,
    durationType: model.durationType,
    value: toScaledDecimal(model.valueRaw, model.scalePow),
    originalScale: model.originalScale,
    currency: model.currency,
    quality: model.quality,
    provenance,
  });
}

export function assembleShareCapitalFact(
  model: ShareCapitalFact,
  provenance: RunProvenanceDTO,
): ShareCapitalReadModelV1 {
  return Object.freeze({
    id: model.id,
    filingId: model.filingId,
    issuerId: model.issuerId,
    shareClass: model.shareClass,
    periodStart: model.periodStart,
    periodEnd: model.periodEnd,
    quantity: model.quantity.toString(),
    quantityType: model.quantityType,
    quality: model.quality,
    provenance,
  });
}

export function assembleMarketBar(
  model: VersionedMarketBar,
  provenance: RunProvenanceDTO,
): MarketBarReadModelV1 {
  return Object.freeze({
    id: model.id,
    instrumentVersionId: model.instrumentVersionId,
    timeframe: model.timeframe,
    openedAt: model.openedAt,
    closedAt: model.closedAt,
    open: toScaledDecimal(model.openRaw, model.priceScalePow),
    high: toScaledDecimal(model.highRaw, model.priceScalePow),
    low: toScaledDecimal(model.lowRaw, model.priceScalePow),
    close: toScaledDecimal(model.closeRaw, model.priceScalePow),
    volume: toScaledDecimal(model.volumeRaw, model.volumeScalePow),
    volumeSemantics: model.volumeSemantics,
    tradeCount: model.tradeCount === null ? null : model.tradeCount.toString(),
    priceBasis: model.priceBasis,
    quality: model.quality,
    revisionNumber: model.revisionNumber,
    predecessorBarId: model.supersedesBarId,
    sourceKey: model.sourceKey,
    sourceRecordKey: model.sourceRecordKey,
    sourceAvailableAt: model.sourceAvailableAt,
    rawSha256: model.rawSha256,
    provenance,
  });
}
