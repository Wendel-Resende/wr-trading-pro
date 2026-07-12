import type { InstrumentId } from './instrument';

export type AccountId = string;
export type PositionSide = 'long' | 'short';

export interface Account {
  readonly id: AccountId;
  readonly displayName: string;
  readonly currency: string;
  readonly balance: number;
  readonly equity: number;
  readonly availableFunds?: number;
  readonly observedAt: string;
}

export interface Position {
  readonly accountId: AccountId;
  readonly instrumentId: InstrumentId;
  readonly side: PositionSide;
  readonly quantity: number;
  readonly averagePrice: number;
  readonly marketPrice?: number;
  readonly unrealizedPnl?: number;
}

export interface Portfolio {
  readonly account: Account;
  readonly positions: readonly Position[];
  readonly observedAt: string;
}

export interface PortfolioRequest {
  readonly accountId: AccountId;
}
