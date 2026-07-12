import type { InstrumentId } from './instrument';

export type Timeframe =
  | '1m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '4h'
  | '1d'
  | '1w';

export interface MarketBar {
  readonly instrumentId: InstrumentId;
  readonly timeframe: Timeframe;
  readonly openedAt: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
}

export interface HistoricalBarsRequest {
  readonly instrumentId: InstrumentId;
  readonly timeframe: Timeframe;
  readonly from: string;
  readonly to: string;
  readonly limit?: number;
}
