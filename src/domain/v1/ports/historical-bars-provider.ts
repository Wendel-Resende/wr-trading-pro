import type { HistoricalBarsRequest, MarketBar } from '../models';

export interface HistoricalBarsProvider {
  getBars(request: HistoricalBarsRequest): Promise<readonly MarketBar[]>;
}
