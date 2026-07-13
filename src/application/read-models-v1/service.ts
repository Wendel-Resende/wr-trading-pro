import type { CvmDocumentType } from '../../domain/v1/models/cvm-filing';
import type { CvmScope, CvmStatementType } from '../../domain/v1/models/cvm-fact';
import type { ShareQuantityType } from '../../domain/v1/models/share-capital-fact';
import type { Timeframe } from '../../domain/v1/models/market-bar';
import type { CvmFilingRepository } from '../../domain/v1/ports/cvm-filing-repository';
import type { CvmFactRepository } from '../../domain/v1/ports/cvm-fact-repository';
import type { ShareCapitalFactRepository } from '../../domain/v1/ports/share-capital-fact-repository';
import type { InstrumentRepository } from '../../domain/v1/ports/instrument-repository';
import type { MarketBarRepository } from '../../domain/v1/ports/market-bar-repository';
import type { IngestionLedger } from '../../domain/v1/ports/ingestion-ledger';
import { compareInstants, parseInstant } from '../../domain/v1/time';
import {
  assembleCvmFact,
  assembleEffectiveCvmFiling,
  assembleInstrumentVersion,
  assembleMarketBar,
  assembleShareCapitalFact,
} from './assemblers';
import type {
  CvmFactReadModelV1,
  EffectiveCvmFilingReadModelV1,
  InstrumentVersionReadModelV1,
  MarketBarReadModelV1,
  ShareCapitalReadModelV1,
} from './dto';
import { ReadModelError } from './errors';
import { ProvenanceResolver } from './provenance';

export interface ReadModelV1Ports {
  readonly instrumentRepository: InstrumentRepository;
  readonly cvmFilingRepository: CvmFilingRepository;
  readonly cvmFactRepository: CvmFactRepository;
  readonly shareCapitalFactRepository: ShareCapitalFactRepository;
  readonly marketBarRepository: MarketBarRepository;
  readonly ingestionLedger: IngestionLedger;
}

export interface InstrumentQueryV1 {
  readonly symbol: string;
  readonly exchange: string;
  readonly asOf: string;
  readonly knowledgeTime: string;
}

export interface EffectiveFilingQueryV1 {
  readonly issuerId: string;
  readonly documentType: CvmDocumentType;
  readonly referenceDate: string;
  readonly decisionTime: string;
  readonly knowledgeTime: string;
}

export interface FactsQueryV1 extends EffectiveFilingQueryV1 {
  readonly statementType?: CvmStatementType;
  readonly scope?: CvmScope;
  readonly accountCode?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface ShareCapitalQueryV1 extends EffectiveFilingQueryV1 {
  readonly shareClass?: string;
  readonly quantityType?: ShareQuantityType;
  readonly limit: number;
  readonly offset: number;
}

export interface MarketBarsQueryV1 {
  readonly instrumentVersionId: string;
  readonly sourceKey: string;
  readonly timeframe: Timeframe;
  readonly from: string;
  readonly to: string;
  readonly decisionTime: string;
  readonly knowledgeTime: string;
  readonly limit: number;
}

const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
};

const MAX_MARKET_BAR_LIMIT = 5000;

function requireInstant(value: string, field: string): void {
  if (parseInstant(value) === null) {
    throw new ReadModelError('INVALID_QUERY', `${field} inválido: timestamp ISO-8601 exigido`);
  }
}

function requireKnowledgeNotAfterDecision(knowledgeTime: string, decisionTime: string): void {
  requireInstant(knowledgeTime, 'knowledgeTime');
  requireInstant(decisionTime, 'decisionTime');
  const knowledge = parseInstant(knowledgeTime)!;
  const decision = parseInstant(decisionTime)!;
  if (compareInstants(knowledge, decision) > 0) {
    throw new ReadModelError('INVALID_TIME_RANGE', 'knowledgeTime não pode ser posterior a decisionTime');
  }
}

/**
 * Application service for the read-only, point-in-time v1 HTTP surface
 * (Fase 2 / Item 4). Depends only on injected ports — never touches
 * Prisma directly. No default clock: every temporal parameter is
 * required and explicit on every call.
 */
export class ReadModelV1Service {
  private readonly provenance: ProvenanceResolver;

  constructor(private readonly ports: ReadModelV1Ports) {
    this.provenance = new ProvenanceResolver(ports.ingestionLedger);
  }

  async getInstrument(query: InstrumentQueryV1): Promise<InstrumentVersionReadModelV1> {
    requireInstant(query.asOf, 'asOf');
    requireInstant(query.knowledgeTime, 'knowledgeTime');

    const versions = await this.ports.instrumentRepository.findInstrumentVersions(query.symbol, query.exchange, {
      asOf: query.asOf,
      knowledgeTime: query.knowledgeTime,
    });

    if (versions.length === 0) {
      throw new ReadModelError('INSTRUMENT_NOT_FOUND', 'nenhuma versão de instrumento visível para os parâmetros informados');
    }
    if (versions.length > 1) {
      throw new ReadModelError('AMBIGUOUS_INSTRUMENT_VERSION', 'mais de uma versão de instrumento visível para os parâmetros informados');
    }

    const provenance = await this.provenance.resolve(versions[0].createdByRunId);
    return assembleInstrumentVersion(versions[0], provenance);
  }

  async getEffectiveFiling(query: EffectiveFilingQueryV1): Promise<EffectiveCvmFilingReadModelV1> {
    requireKnowledgeNotAfterDecision(query.knowledgeTime, query.decisionTime);

    const filing = await this.ports.cvmFilingRepository.findEffectiveFiling(
      query.issuerId,
      query.documentType,
      query.referenceDate,
      { decisionTime: query.decisionTime, knowledgeTime: query.knowledgeTime },
    );
    if (!filing) {
      throw new ReadModelError('FILING_NOT_FOUND', 'nenhuma filing efetiva visível para os parâmetros informados');
    }

    const provenance = await this.provenance.resolve(filing.createdByRunId);
    return assembleEffectiveCvmFiling(filing, provenance);
  }

  async getFacts(query: FactsQueryV1): Promise<{ facts: readonly CvmFactReadModelV1[]; effectiveFiling: EffectiveCvmFilingReadModelV1 }> {
    requireKnowledgeNotAfterDecision(query.knowledgeTime, query.decisionTime);
    const view = { decisionTime: query.decisionTime, knowledgeTime: query.knowledgeTime };

    const filing = await this.ports.cvmFilingRepository.findEffectiveFiling(
      query.issuerId,
      query.documentType,
      query.referenceDate,
      view,
    );
    if (!filing) {
      throw new ReadModelError('FILING_NOT_FOUND', 'nenhuma filing efetiva visível para os parâmetros informados');
    }
    const filingProvenance = await this.provenance.resolve(filing.createdByRunId);
    const effectiveFiling = assembleEffectiveCvmFiling(filing, filingProvenance);

    const rows = await this.ports.cvmFactRepository.findFacts(
      {
        issuerId: query.issuerId,
        documentType: query.documentType,
        referenceDate: query.referenceDate,
        statementType: query.statementType,
        scope: query.scope,
        accountCode: query.accountCode,
        limit: query.limit,
        offset: query.offset,
      },
      view,
    );

    const facts: CvmFactReadModelV1[] = [];
    for (const row of rows) {
      const provenance = await this.provenance.resolve(row.createdByRunId);
      facts.push(assembleCvmFact(row, provenance));
    }

    return { facts: Object.freeze(facts), effectiveFiling };
  }

  async getShareCapital(
    query: ShareCapitalQueryV1,
  ): Promise<{ shareCapital: readonly ShareCapitalReadModelV1[]; effectiveFiling: EffectiveCvmFilingReadModelV1 }> {
    requireKnowledgeNotAfterDecision(query.knowledgeTime, query.decisionTime);
    const view = { decisionTime: query.decisionTime, knowledgeTime: query.knowledgeTime };

    const filing = await this.ports.cvmFilingRepository.findEffectiveFiling(
      query.issuerId,
      query.documentType,
      query.referenceDate,
      view,
    );
    if (!filing) {
      throw new ReadModelError('FILING_NOT_FOUND', 'nenhuma filing efetiva visível para os parâmetros informados');
    }
    const filingProvenance = await this.provenance.resolve(filing.createdByRunId);
    const effectiveFiling = assembleEffectiveCvmFiling(filing, filingProvenance);

    const rows = await this.ports.shareCapitalFactRepository.findShareCapitalFacts(
      {
        issuerId: query.issuerId,
        documentType: query.documentType,
        referenceDate: query.referenceDate,
        shareClass: query.shareClass,
        quantityType: query.quantityType,
        limit: query.limit,
        offset: query.offset,
      },
      view,
    );

    const shareCapital: ShareCapitalReadModelV1[] = [];
    for (const row of rows) {
      const provenance = await this.provenance.resolve(row.createdByRunId);
      shareCapital.push(assembleShareCapitalFact(row, provenance));
    }

    return { shareCapital: Object.freeze(shareCapital), effectiveFiling };
  }

  async getMarketBars(query: MarketBarsQueryV1): Promise<readonly MarketBarReadModelV1[]> {
    requireKnowledgeNotAfterDecision(query.knowledgeTime, query.decisionTime);
    requireInstant(query.from, 'from');
    requireInstant(query.to, 'to');

    const fromInstant = parseInstant(query.from)!;
    const toInstant = parseInstant(query.to)!;
    if (compareInstants(fromInstant, toInstant) >= 0) {
      throw new ReadModelError('INVALID_TIME_RANGE', 'from deve ser estritamente anterior a to');
    }

    const msPerBar = TIMEFRAME_MS[query.timeframe];
    const rangeMs = toInstant.milliseconds - fromInstant.milliseconds;
    const theoreticalIntervals = Math.ceil(rangeMs / msPerBar);
    if (theoreticalIntervals > query.limit || theoreticalIntervals > MAX_MARKET_BAR_LIMIT) {
      throw new ReadModelError(
        'RESULT_LIMIT_EXCEEDED',
        'quantidade teórica de intervalos do timeframe excede o limite solicitado',
      );
    }

    const rows = await this.ports.marketBarRepository.findBars(
      query.instrumentVersionId,
      query.sourceKey,
      query.timeframe,
      query.from,
      query.to,
      { decisionTime: query.decisionTime, knowledgeTime: query.knowledgeTime },
    );

    if (rows.length > query.limit) {
      throw new ReadModelError('RESULT_LIMIT_EXCEEDED', 'resultado excede o limite solicitado');
    }

    const bars: MarketBarReadModelV1[] = [];
    for (const row of rows) {
      const provenance = await this.provenance.resolve(row.createdByRunId);
      bars.push(assembleMarketBar(row, provenance));
    }
    return Object.freeze(bars);
  }
}
