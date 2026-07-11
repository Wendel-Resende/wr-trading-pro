export type ProfitDLLConnectorState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

export interface ProfitDLLConfig {
  dllPath: string;
  accessKey: string;
  username: string;
  password: string;
  enableRouting: boolean;
}

export interface ProfitDLLAsset {
  ticker: string;
  exchange: string;
  feedType: number;
  name?: string;
  description?: string;
  sector?: string;
  subSector?: string;
  segment?: string;
}

export interface ProfitDLLAccount {
  brokerId: number;
  accountId: string;
  subAccountId?: string;
  brokerName?: string;
  ownerName?: string;
  subOwnerName?: string;
  accountType: number;
}

export interface ProfitDLLPosition {
  accountId: ProfitDLLAccount;
  asset: ProfitDLLAsset;
  openQuantity: number;
  openAveragePrice: number;
  openSide: 'BUY' | 'SELL';
  dailyAverageSellPrice: number;
  dailySellQuantity: number;
  dailyAverageBuyPrice: number;
  dailyBuyQuantity: number;
  dailyQuantity: number;
  dailyQuantityAvailable: number;
  positionType: 'DAYTRADE' | 'CONSOLIDATED';
  eventId: number;
}

export interface ProfitDLLTrade {
  assetId: ProfitDLLAsset;
  date: Date;
  tradeNumber: number;
  price: number;
  quantity: number;
  volume: number;
  buyAgent: number;
  sellAgent: number;
  tradeType: number;
  isEdit: boolean;
}

export interface ProfitDLLOrder {
  orderId: {
    localOrderId: number;
    clOrderId: string;
  };
  accountId: ProfitDLLAccount;
  asset: ProfitDLLAsset;
  quantity: number;
  tradedQuantity: number;
  leavesQuantity: number;
  price: number;
  stopPrice: number;
  averagePrice: number;
  orderSide: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT' | 'STOP';
  orderStatus: 'PENDING' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'REJECTED';
  validityType: number;
  date: Date;
  lastUpdate: Date;
  closeDate?: Date;
  validityDate?: Date;
  textMessage?: string;
  eventId: number;
}

export interface ProfitDLLPriceGroup {
  price: number;
  count: number;
  quantity: number;
  priceGroupFlags: number;
}

export interface ProfitDLLPriceDepth {
  assetId: ProfitDLLAsset;
  side: 'BUY' | 'SELL';
  position: number;
  updateType: 'ADD' | 'EDIT' | 'DELETE' | 'INSERT' | 'FULL_BOOK' | 'PREPARE' | 'FLUSH' | 'THEORETIC_PRICE' | 'DELETE_FROM';
  priceGroup?: ProfitDLLPriceGroup;
}

export interface ProfitDLLOfferBookEntry {
  price: number;
  quantity: number;
  agent: number;
  offerId: number;
  date: Date;
}

export interface ProfitDLLOfferBook {
  assetId: ProfitDLLAsset;
  action: number;
  position: number;
  side: 'BUY' | 'SELL';
  quantity: number;
  agent: number;
  offerId: number;
  price: number;
  hasPrice: boolean;
  hasQuantity: boolean;
  hasDate: boolean;
  hasOfferId: boolean;
  hasAgent: boolean;
  date?: Date;
  buyOffers: ProfitDLLOfferBookEntry[];
  sellOffers: ProfitDLLOfferBookEntry[];
}

export interface ProfitDLLDailyData {
  assetId: ProfitDLLAsset;
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjustment: number;
  maxLimit: number;
  minLimit: number;
  volumeBuyer: number;
  volumeSeller: number;
  quantity: number;
  trades: number;
  openContracts: number;
  quantityBuyer: number;
  quantitySeller: number;
  tradesBuyer: number;
  tradesSeller: number;
}

export interface ProfitDLLTheoreticalPrice {
  assetId: ProfitDLLAsset;
  theoreticalPrice: number;
  theoreticalQuantity: number;
}

export interface ProfitDLLTinyBook {
  assetId: ProfitDLLAsset;
  price: number;
  quantity: number;
  side: 'BUY' | 'SELL';
}

export interface ProfitDLLWebSocketMessage {
  type: 'STATE' | 'TRADE' | 'PRICE_DEPTH' | 'OFFER_BOOK' | 'DAILY' | 'THEORETICAL_PRICE' | 'TINY_BOOK' | 'ORDER' | 'POSITION' | 'ACCOUNT' | 'ERROR';
  data:
    | ProfitDLLConnectionState
    | ProfitDLLTrade
    | ProfitDLLPriceDepth
    | ProfitDLLOfferBook
    | ProfitDLLDailyData
    | ProfitDLLTheoreticalPrice
    | ProfitDLLTinyBook
    | ProfitDLLOrder
    | ProfitDLLPosition
    | ProfitDLLAccount
    | { error: string; code?: number };
  timestamp: Date;
}

export interface ProfitDLLConnectionState {
  state: ProfitDLLConnectorState;
  isConnected: boolean;
  isMarketConnected: boolean;
  isActivated: boolean;
  lastError?: string;
}