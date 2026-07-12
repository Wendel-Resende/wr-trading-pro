export type InstrumentId = string;

export type AssetClass =
  | 'equity'
  | 'future'
  | 'option'
  | 'currency'
  | 'fixed-income'
  | 'fund'
  | 'index'
  | 'other';

export interface Instrument {
  readonly id: InstrumentId;
  readonly symbol: string;
  readonly displayName: string;
  readonly assetClass: AssetClass;
  readonly currency: string;
  readonly exchange?: string;
  readonly priceScale: number;
  readonly quantityScale: number;
  readonly active: boolean;
}

export interface InstrumentQuery {
  readonly text?: string;
  readonly assetClass?: AssetClass;
  readonly active?: boolean;
  readonly limit?: number;
}
