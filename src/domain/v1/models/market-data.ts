import type { InstrumentId } from './instrument';

export interface Quote {
  readonly instrumentId: InstrumentId;
  readonly observedAt: string;
  readonly bid?: number;
  readonly ask?: number;
  readonly last?: number;
}

export interface Tick extends Quote {
  readonly quantity?: number;
  readonly sequence?: number;
}

export interface MarketDataRequest {
  readonly instrumentIds: readonly InstrumentId[];
  readonly signal?: AbortSignal;
}
