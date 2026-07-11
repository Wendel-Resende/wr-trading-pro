export type MT5ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

export interface MT5Config {
  login: number;
  password: string;
  server: string;
  path?: string;
}

export interface MT5AccountInfo {
  login: number;
  tradeMode: number;
  leverage: number;
  limitOrders: number;
  marginSoCall: number;
  marginSoMode: number;
  currency: string;
  balance: number;
  credit: number;
  profit: number;
  equity: number;
  margin: number;
  marginFree: number;
  marginLevel: number;
  marginInitial: number;
  marginMaintenance: number;
  marginRequired: number;
  assets: number;
  liabilities: number;
  commissionBlocked: number;
  name: string;
  server: string;
  currencyDigits: number;
  fifoClose: boolean;
}

export interface MT5Position {
  ticket: number;
  time: Date;
  timeMsc: number;
  timeUpdate: Date;
  timeUpdateMsc: number;
  type: 'BUY' | 'SELL';
  magic: number;
  identifier: number;
  reason: number;
  volume: number;
  priceOpen: number;
  sl: number;
  tp: number;
  priceCurrent: number;
  swap: number;
  profit: number;
  symbol: string;
  comment: string;
  externalId: string;
}

export interface MT5Order {
  ticket: number;
  timeSetup: Date;
  timeSetupMsc: number;
  timeDone: Date;
  timeDoneMsc: number;
  type: number;  // MT5 usa números para tipos de ordem (0=BUY, 1=SELL, etc.)
  state: number;  // MT5 usa números para estados de ordem (0=STARTED, 1=PLACED, etc.)
  expiration: Date;
  volume: number;
  priceCurrent: number;
  priceStopLimit: number;
  priceSl: number;
  priceTp: number;
  comment: string;
  position: number;
  positionBy: number;
  volumeInitial: number;
  volumeCurrent: number;
  priceOpen: number;
  magic: number;
  reason: number;
  symbol: string;
}

export interface MT5Trade {
  ticket: number;
  order: number;
  time: Date;
  timeMsc: number;
  type: number;  // MT5 usa números para tipos de trade (0=BUY, 1=SELL)
  entry: number;
  magic: number;
  reason: number;
  position: number;
  positionBy: number;
  volume: number;
  price: number;
  profit: number;
  commission: number;
  swap: number;
  symbol: string;
  comment: string;
}

export interface MT5Tick {
  symbol: string;
  time: Date;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  volumeReal: number;
  timeMsc: number;
  flags: number;
  volumeDiff: number;
  previousClose?: number;  // Preço de fechamento do dia anterior
  change?: number;  // Variação absoluta (preço atual - fechamento anterior)
  changePercent?: number;  // Variação percentual calculada pelo Python
  digits?: number;  // Número de casas decimais do símbolo (do MT5)
}

export interface MT5SymbolInfo {
  name: string;
  description: string;
  base: string;
  quote: string;
  type: 'CURRENCY' | 'CFD' | 'FUTURES' | 'STOCK' | 'INDEX' | 'CRYPTO' | 'METAL';
  visible: boolean;
  tradeMode: number;
  select: boolean;
  digits: number;
  point: number;
  tradeTickValue: number;
  tradeTickSize: number;
  tradeContractSize: number;
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
  volumeLong: number;
  volumeShort: number;
  volumeLimit: number;
  swapLong: number;
  swapShort: number;
  marginInitial: number;
  marginMaintenance: number;
  marginHedged: number;
  marginRequired: number;
  freezeLevel: number;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  time: Date;
}

export interface MT5BookInfo {
  time: Date;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  price: number;
  type: 'BUY' | 'SELL';
}

export interface MT5OrderRequest {
  action: 'TRADE_ACTION_DEAL' | 'TRADE_ACTION_PENDING' | 'TRADE_ACTION_SLTP' | 'TRADE_ACTION_MODIFY' | 'TRADE_ACTION_REMOVE' | 'TRADE_ACTION_CLOSE_BY';
  symbol: string;
  volume: number;
  type: 'ORDER_TYPE_BUY' | 'ORDER_TYPE_SELL' | 'ORDER_TYPE_BUY_LIMIT' | 'ORDER_TYPE_SELL_LIMIT' | 'ORDER_TYPE_BUY_STOP' | 'ORDER_TYPE_SELL_STOP';
  price?: number;
  sl?: number;
  tp?: number;
  position?: number;
  positionBy?: number;
  order?: number;
  deviation?: number;
  magic?: number;
  comment?: string;
  typeTime?: number;
  typeFilling?: number;
  expiration?: Date;
}

export interface MT5OrderResult {
  retcode: number;
  deal: number;
  order: number;
  volume: number;
  price: number;
  bid: number;
  ask: number;
  comment: string;
  request_id: number;
  retcodeExternal: number;
}

export interface MT5WebSocketMessage {
  type: 'STATE' | 'TICK' | 'POSITION' | 'ORDER' | 'TRADE' | 'ACCOUNT' | 'ORDER_RESULT' | 'ORDERBOOK' | 'CHART_DATA' | 'ERROR' | 'SYMBOLS' | 'SYMBOL_INFO' | 'EQUITIES';
  data: MT5Tick | MT5Position | MT5Order | MT5Trade | MT5AccountInfo | MT5OrderResult | MT5BookInfo | MT5ConnectionState | MT5ChartData | string;
  timestamp: Date;
  symbol?: string;
  timeframe?: string;
}

export interface MT5ConnectionStatus {
  state: MT5ConnectionState;
  isConnected: boolean;
  accountInfo?: MT5AccountInfo;
  lastError?: string;
}

export interface MT5Candle {
  time: number; // Unix timestamp em segundos
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MT5ChartData {
  symbol?: string;
  timeframe?: string;
  candles?: MT5Candle[];
}
