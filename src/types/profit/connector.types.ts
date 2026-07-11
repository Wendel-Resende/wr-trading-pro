import {
  TConnectorOrderSide,
  TConnectorOrderType,
  TConnectorOrderStatus,
  TConnectorFeedType,
  TConnectorPriceDirection,
  TConnectorOrderFlags,
  TConnectorTradeSide,
  TConnectorTradeType,
} from "./enums";

/**
 * Identificador de ativo (ticker)
 * Corresponde a: TConnectorAssetIdentifier (C struct)
 */
export interface TConnectorAssetIdentifier {
  /** Código do ticker (ex: "PETR4", "WDOH26") */
  Ticker: string;
  /** Código da exchange (ex: "BBM", "B3") */
  Exchange: string;
  /** Tipo de feed de dados */
  FeedType: TConnectorFeedType;
}

/**
 * Identificador de conta
 * Corresponde a: TConnectorAccountIdentifier (C struct)
 */
export interface TConnectorAccountIdentifier {
  /** ID do corretora */
  BrokerID: string;
  /** ID da conta */
  AccountID: string;
  /** ID da sub-conta (opcional) */
  SubAccountID?: string;
}

/**
 * Identificador de ordem (sub-tipo)
 * Estende TConnectorOrder.OrderNo com suporte a localOrderId e clOrderId
 * Corresponde a: ProfitDLLOrder.orderId { localOrderId, clOrderId }
 */
export interface TConnectorOrderId {
  /** OrderNo local (retornado pelo sistema) */
  localOrderId: number;
  /** Client Order ID (enviado pelo cliente) */
  clOrderId: string;
}

/**
 * Dados de uma ordem
 * Corresponde a: TConnectorOrder (C struct)
 * Campos estendidos com ProfitDLLOrder para suporte a localOrderId + clOrderId
 */
export interface TConnectorOrder {
  /** Número da ordem no sistema */
  OrderNo: number;
  /** Identificador de ordem (local + client) - extensão ProfitDLL */
  OrderId?: TConnectorOrderId;
  /** Data/hora de registro (epoch ms) */
  DateTime: number;
  /** Código do ativo */
  Asset: TConnectorAssetIdentifier;
  /** Identificador da conta */
  Account: TConnectorAccountIdentifier;
  /** Lado da ordem (compra/venda) */
  Side: TConnectorOrderSide;
  /** Tipo de ordem (mercado/limit/stop) */
  Type: TConnectorOrderType;
  /** Quantidade solicitada */
  AskQty: number;
  /** Quantidade executada */
  FilledQty: number;
  /** Preço da ordem */
  Price: number;
  /** Preço trigger (para ordens stop) */
  TriggerPrice: number;
  /** Preço médio de execução */
  AvgPrice: number;
  /** Status atual da ordem */
  Status: TConnectorOrderStatus;
  /** Flags da ordem */
  Flags: TConnectorOrderFlags;
  /** Data/hora de expiração (epoch ms) */
  ExpireDate: number;
  /** ID da ordem no cliente (client order ID) */
  ClOrdID: string;
  /** ID da ordem pai (para ordens filhas) */
  ParentOrderNo: number;
  /** ID do usuário que enviou */
  UserID: number;
  /** Mensagem de rejeição (se houver) */
  RejectReason?: string;
}

/**
 * Dados de um trade executado
 * Corresponde a: TConnectorTrade (C struct)
 */
export interface TConnectorTrade {
  /** Número do trade */
  TradeNo: number;
  /** Data/hora do trade (epoch ms) */
  DateTime: number;
  /** Número da ordem associada */
  OrderNo: number;
  /** Código do ativo */
  Asset: TConnectorAssetIdentifier;
  /** Identificador da conta */
  Account: TConnectorAccountIdentifier;
  /** Lado do trade (compra/venda) */
  Side: TConnectorTradeSide;
  /** Tipo do trade */
  TradeType: TConnectorTradeType;
  /** Quantidade executada */
  Qty: number;
  /** Preço do trade */
  Price: number;
  /** Quantidade disponível para cierre */
  CloseQty: number;
  /** ID do corretor */
  BrokerID: number;
  /** IDs dos agentes (camarilla) */
  AgentID1: number;
  AgentID2: number;
  AgentID3: number;
  AgentID4: number;
  /** ID do usuário */
  UserID: number;
  /** ID do cliente */
  ClOrdID: string;
  /** ID da sessão */
  SessionID: string;
  /** Repartition number */
  Repartition: number;
}

/**
 * Nível do livro de preços
 * Corresponde a: TConnectorPriceGroup (C struct)
 */
export interface TConnectorPriceGroup {
  /** Quantidade no nível */
  Qty: number;
  /** Preço do nível */
  Price: number;
  /** Número de ordens no nível */
  OrderCount: number;
}

/**
 * Livros de preços (bids e asks)
 * Corresponde a: TConnectorPriceDepth (C struct)
 */
export interface TConnectorPriceDepth {
  /** Direção (1=compra, 2=venda) */
  Direction: TConnectorPriceDirection;
  /** Data/hora (epoch ms) */
  DateTime: number;
  /** ID do ticker */
  TickerID: number;
  /** Código do ticker */
  Ticker: string;
  /** Código da exchange */
  Exchange: string;
  /** Níveis de preço */
  PriceGroups: TConnectorPriceGroup[];
}

/**
 * Posição em custódia
 * Corresponde a: TConnectorPosition (C struct)
 */
export interface TConnectorPosition {
  /** Código do ativo */
  Asset: TConnectorAssetIdentifier;
  /** Quantidade em custódia */
  Qty: number;
  /** Quantidade disponível para cierre */
  AvailableQty: number;
  /** Quantidade bloqueada em ordens */
  BlockedQty: number;
  /** Preço médio */
  AvgPrice: number;
  /** P&L realized */
  RealizedPL: number;
  /** P&L unrealized */
  UnrealizedPL: number;
  /** Preço médio de venda do dia (ProfitDLL) */
  dailyAverageSellPrice?: number;
  /** Quantidade de venda do dia (ProfitDLL) */
  dailySellQuantity?: number;
  /** Preço médio de compra do dia (ProfitDLL) */
  dailyAverageBuyPrice?: number;
  /** Quantidade de compra do dia (ProfitDLL) */
  dailyBuyQuantity?: number;
  /** Quantidade total do dia (ProfitDLL) */
  dailyQuantity?: number;
  /** Quantidade disponível do dia (ProfitDLL) */
  dailyQuantityAvailable?: number;
  /** Tipo de posição: DAYTRADE ou CONSOLIDATED (ProfitDLL) */
  positionType?: 'DAYTRADE' | 'CONSOLIDATED';
  /** ID do evento (ProfitDLL) */
  eventId?: number;
}

/**
 * Detalhes da conta
 * Corresponde a: TConnectorAccountDetails (C struct)
 */
export interface TConnectorAccountDetails {
  /** Identificador da conta */
  Account: TConnectorAccountIdentifier;
  /** Tipo da conta (1=à vista, 2=margem, etc.) */
  AccountType: number;
  /** Patrimonio líquido */
  NetEquity: number;
  /** Total em cash */
  Cash: number;
  /** Volatile equity */
  VolatileEquity: number;
  /** Garantia total */
  Guarantee: number;
  /** Margem utilizada */
  UsedMargin: number;
  /** Margem disponível */
  AvailableMargin: number;
  /** P&L total */
  TotalPL: number;
  /** P&L day trade */
  DayTradePL: number;
  /** Equity intraday */
  IntradayEquity: number;
}

/**
 * Ativo da lista de ativos
 * Corresponde a: TAssetListInfo (C struct)
 */
export interface TAssetListInfo {
  /** Ticker completo (ex: "PETR4@bvmf") */
  Ticker: string;
  /** Nome da empresa/ativo */
  CompanyName: string;
  /** Código do ticker (ex: "PETR4") */
  AssetCode: string;
  /** Código da exchange (ex: "BVMF") */
  Exchange: string;
  /** Tipo de ativo (1=ação, 2=opção, etc.) */
  AssetType: number;
  /** Descrição do tipo */
  AssetTypeDescription: string;
  /** Preço do último fechamento */
  ClosePrice: number;
  /**Data do último fechamento (epoch ms) */
  CloseDate: number;
  /** Preço de exercício (para opções) */
  StrikePrice: number;
  /**Data de vencimento (epoch ms) */
  ExpirationDate: number;
  /** Quantidade de subyacente */
  SubJyQty: number;
  /** Tick mínimo (mínimo incremento de preço) */
  TickValue: number;
  /** Descrição do símbolo */
  SymbolDescription: string;
  /** Lote padrão */
  LotSize: number;
  /** Mercado de exercício (para opções) */
  ExerciseType: number;
  /** Ticker do subyacente (para derivados) */
  UnderlyingTicker: string;
}

/**
 * Resultado de envio de ordem
 * Corresponde a: TConnectorTradingMessageResult (C struct)
 */
export interface TConnectorTradingMessageResult {
  /** Message ID único */
  MessageID: number;
  /** Tipo da mensagem (1=ordem, 2=cancelamento, 3=modificação) */
  MessageType: number;
  /** Resultado (0=sucesso, >0=código de erro) */
  Result: number;
  /** Mensagem descritiva */
  Message: string;
  /** OrderNo da ordem afetada (se aplicável) */
  OrderNo: number;
  /** Data/hora (epoch ms) */
  DateTime: number;
  /** Reservado */
  Reserved: number;
}

/**
 * Resultado de envio de ordem
 * Versão V2 com mais campos
 * Corresponde a: TConnectorTradingMessageResultV2 (C struct)
 */
export interface TConnectorTradingMessageResultV2 {
  /** Message ID único */
  MessageID: number;
  /** Tipo da mensagem (1=ordem, 2=cancelamento, 3=modificação) */
  MessageType: number;
  /** Resultado (0=sucesso, >0=código de erro) */
  Result: number;
  /** Mensagem descritiva */
  Message: string;
  /** ID do cliente */
  ClOrdID: string;
  /** OrderNo da ordem afetada (se aplicável) */
  OrderNo: number;
  /** Data/hora (epoch ms) */
  DateTime: number;
  /** Número de sequência */
  Sequence: number;
}

/**
 * Estado do ticker
 * Corresponde a: TChangeStateTickerData (C struct)
 */
export interface TChangeStateTickerData {
  /** Ticker ID */
  TickerID: number;
  /** Código do ticker */
  Ticker: string;
  /** Código da exchange */
  Exchange: string;
  /** Tipo de feed */
  FeedType: TConnectorFeedType;
  /** Estado (1=aberto, 2=fechado, 3=suspenso, etc.) */
  State: number;
  /** Quantidade de auctions */
  AuctionNumber: number;
  /** Tempo de auction */
  AuctionTime: number;
  /** Indicador de mercado em geral */
  MarketStateIndicator: number;
}

/**
 * Preço teórico
 * Corresponde a: TTheoreticalPriceData (C struct)
 */
export interface TTheoreticalPriceData {
  /** Ticker ID */
  TickerID: number;
  /** Preço teórico de compra */
  BidPrice: number;
  /** Preço teórico de venda */
  AskPrice: number;
  /** Quantidade teórica de compra */
  BidQty: number;
  /** Quantidade teórica de venda */
  AskQty: number;
  /** Momento do cálculo (epoch ms) */
  CalcTime: number;
  /** Preço de fechamento anterior */
  ClosePrice: number;
}

/**
 * Candle OHLCV diário
 * Corresponde a: TNewDailyData (C struct)
 */
export interface TNewDailyData {
  /** Ticker ID */
  TickerID: number;
  /** Código do ticker */
  Ticker: string;
  /** Código da exchange */
  Exchange: string;
  /** Timestamp (epoch ms) */
  DateTime: number;
  /** Opening price */
  Open: number;
  /** Highest price */
  High: number;
  /** Lowest price */
  Low: number;
  /** Closing price */
  Close: number;
  /** Volume */
  Volume: number;
  /** Monetary volume */
  Moneyness: number;
  /** Quantidade de negócios */
  NumTrades: number;
  /** Quantidade de ofertas */
  BidQty: number;
  /** Quantidade de demandas */
  AskQty: number;
  /** Preço de abertura (anterior) */
  OpenPrice: number;
  /** Fator de ajuste */
  AdjustmentFactor: number;
  /** Timestamp de validade */
  ExpirationDate: number;
  /** Preço de exercício (para opções) */
  StrikePrice: number;
  /** Indicador de exercício automático */
  AutoExercise: boolean;
  /** Lote de negociação */
  TradingLot: number;
}

/**
 * Callback de ajuste de histórico (V2)
 * Corresponde a: TAdjustHistoryCallbackV2 (C struct)
 * Usado para eventos de ajustes históricos (proventos, splits, grupamentos)
 */
export interface TAdjustHistoryCallbackV2 {
  /** Ticker ID */
  TickerID: number;
  /** Data/hora do ajuste (epoch ms) */
  DateTime: number;
  /** Código do ticker */
  Ticker: string;
  /** Código da exchange */
  Exchange: string;
  /** Tipo de feed */
  FeedType: TConnectorFeedType;
  /** Estado do ticker */
  State: number;
  /** fator de ajuste (ex: 0.5 para split 2:1) */
  AdjustmentFactor: number;
  /** Preço ajustado */
  Price: number;
  /** Quantidade ajustada */
  Qty: number;
  /** Tipo de ajuste (1=provento, 2=split, 3=grupamento, etc) */
  AdjustmentType: number;
  /** Mensagem descritiva */
  Message: string;
  /** Resultado (0=sucesso) */
  Result: number;
  /** Número de sequência */
  Sequence: number;
}

/**
 * Resposta de histórico de ordens
 * Corresponde a: TConnectorOrderHistoryData (C struct)
 */
export interface TConnectorOrderHistoryData {
  /** Número de páginas total */
  TotalPages: number;
  /** Número de registros total */
  TotalRecords: number;
  /** Número de registros no callback atual */
  CurrentRecords: number;
  /** Offset do primeiro registro */
  Offset: number;
  /** Número da página atual */
  PageNo: number;
  /** Data/hora inicial do filtro (epoch ms) */
  StartDate: number;
  /** Data/hora final do filtro (epoch ms) */
  EndDate: number;
  /** Array de ordens */
  Orders: TConnectorOrder[];
}

/**
 * Resposta de histórico de trades
 * Corresponde a: TConnectorTradeHistoryData (C struct)
 */
export interface TConnectorTradeHistoryData {
  /** Total de páginas */
  TotalPages: number;
  /** Total de registros */
  TotalRecords: number;
  /** Registros no callback atual */
  CurrentRecords: number;
  /** Offset do primeiro registro */
  Offset: number;
  /** Número da página atual */
  PageNo: number;
  /** Array de trades */
  Trades: TConnectorTrade[];
}

/**
 * Estatísticas de mercado
 * Corresponde a: TMarketStatisticsData (C struct)
 */
export interface TMarketStatisticsData {
  /** Ticker ID */
  TickerID: number;
  /** Maior preço do dia */
  HighPrice: number;
  /** Menor preço do dia */
  LowPrice: number;
  /** Volume do dia (em lotes) */
  Volume: number;
  /** Volume financeiro */
  Moneyness: number;
  /** Quantidade de negócios */
  NumTrades: number;
  /** Data/hora (epoch ms) */
  DateTime: number;
  /** Preço de abertura */
  OpenPrice: number;
  /** Timestamp de abertura */
  OpenDateTime: number;
  /** Timestamp de fechamento */
  CloseDateTime: number;
}

/**
 * Filtro de histórico
 * Corresponde a: TConnectorHistoryFilter (C struct)
 */
export interface TConnectorHistoryFilter {
  /** Data/hora inicial (epoch ms) */
  StartDate: number;
  /** Data/hora final (epoch ms) */
  EndDate: number;
  /** Número máximo de registros por página */
  PageSize: number;
  /** Número da página */
  PageNumber: number;
  /** Incluir ordens canceladas */
  IncludeCanceled: boolean;
}

/**
 * Resultado de subscribe
 * Corresponde a: TConnectorSubscribeResult (C struct)
 */
export interface TConnectorSubscribeResult {
  /** Resultado (0=sucesso) */
  Result: number;
  /** Mensagem */
  Message: string;
  /** ID do ticker (quando aplicável) */
  TickerID: number;
}
