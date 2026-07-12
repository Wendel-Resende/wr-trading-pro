import type { InstrumentId, MarketDataRequest, Quote, Tick } from '../models';

export interface MarketDataProvider {
  getQuote(instrumentId: InstrumentId): Promise<Quote | null>;
  streamTicks(request: MarketDataRequest): AsyncIterable<Tick>;
}
