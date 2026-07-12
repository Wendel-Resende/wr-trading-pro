import { isGovernedOrderIntent } from '../../src/domain';
import type {
  Account,
  ExecutionBroker,
  ExecutionResult,
  GovernedOrderIntent,
  HistoricalBarsProvider,
  HistoricalBarsRequest,
  Instrument,
  InstrumentCatalog,
  InstrumentId,
  InstrumentQuery,

  MarketBar,
  MarketDataProvider,
  MarketDataRequest,
  Portfolio,
  PortfolioProvider,
  PortfolioRequest,
  Quote,
  Tick,
} from '../../src/domain';

const instrument: Instrument = {
  id: 'instrument-1', symbol: 'ABC', displayName: 'ABC', assetClass: 'equity',
  currency: 'BRL', priceScale: 2, quantityScale: 0, active: true,
};

class CatalogFixture implements InstrumentCatalog {
  async getInstrument(id: InstrumentId): Promise<Instrument | null> {
    return id === instrument.id ? instrument : null;
  }
  async findInstruments(_query?: InstrumentQuery): Promise<readonly Instrument[]> {
    return [instrument];
  }
}

class MarketDataFixture implements MarketDataProvider {
  async getQuote(instrumentId: InstrumentId): Promise<Quote> {
    return { instrumentId, observedAt: '2026-01-01T00:00:00.000Z', bid: 9, ask: 10 };
  }
  async *streamTicks(request: MarketDataRequest): AsyncIterable<Tick> {
    yield { instrumentId: request.instrumentIds[0], observedAt: '2026-01-01T00:00:00.000Z', last: 9.5 };
  }
}

class BarsFixture implements HistoricalBarsProvider {
  async getBars(request: HistoricalBarsRequest): Promise<readonly MarketBar[]> {
    return [{ ...request, openedAt: request.from, open: 9, high: 11, low: 8, close: 10 }];
  }
}

const account: Account = {
  id: 'account-1', displayName: 'Principal', currency: 'BRL', balance: 100,
  equity: 100, observedAt: '2026-01-01T00:00:00.000Z',
};

class PortfolioFixture implements PortfolioProvider {
  async listAccounts(): Promise<readonly Account[]> { return [account]; }
  async getPortfolio(_request: PortfolioRequest): Promise<Portfolio> {
    return { account, positions: [], observedAt: account.observedAt };
  }
}

class BrokerFixture implements ExecutionBroker {
  async execute(intent: GovernedOrderIntent): Promise<ExecutionResult> {
    if (!isGovernedOrderIntent(intent)) throw new Error('unauthentic governed intent');
    return { status: 'UNKNOWN', correlationId: intent.correlationId, idempotencyKey: intent.idempotencyKey, reason: 'compile fixture only' };
  }
}

export const portFixtures = {
  catalog: new CatalogFixture(),
  marketData: new MarketDataFixture(),
  bars: new BarsFixture(),
  portfolio: new PortfolioFixture(),
  broker: new BrokerFixture(),
};
