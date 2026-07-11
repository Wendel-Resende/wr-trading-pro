/**
 * Enum TConnectorOrderSide
 * Lado da ordem
 */
export enum TConnectorOrderSide {
  Buy = 1,
  Sell = 2,
}

/**
 * Enum TConnectorOrderType
 * Tipo de ordem
 */
export enum TConnectorOrderType {
  Market = 1,
  Limit = 2,
  /** Stop limit (equivale a StopLimit) */
  Stop = 3,
  StopLimit = 4,
  /** Mercado a termo */
  MarketTerm = 5,
  /** Encerrar posição */
  ClosePosition = 6,
}

/**
 * Enum TConnectorOrderStatus
 * Status da ordem
 */
export enum TConnectorOrderStatus {
  /** Nova, não enviada */
  New = 0,
  /** Enviada ao servidor */
  Sent = 1,
  /** Enviada ao roteador */
  RouterSent = 2,
  /** Enviada ao mercado (BBM) */
  MarketSent = 3,
  /** Ordem não enviada (erro) */
  NotSent = 4,
  /** Enviada com sucesso (confirmada pelo servidor) */
  SendSuccess = 5,
  /** Enviada ao mercado */
  MarketConfirm = 6,
  /** Pré-confirmada */
  PreConfirm = 7,
  /** Confirmada na bolsa */
  BMBConfirm = 8,
  /** Parcialmente executada */
  PartialFilled = 9,
  /** Executada */
  Filled = 10,
  /** Parcialmente cancelada */
  PartialCanceled = 11,
  /** Cancelada */
  Canceled = 12,
  /** Rejeitada */
  Rejected = 14,
  /** Rejeitada pelo roteador */
  RouterRejected = 15,
  /** Rejeitada pelo mercado */
  MarketRejected = 16,
  /** Aguardando tempo/condição */
  PendingTime = 17,
  /** Aguardando o mercado */
  PendingMarket = 18,
  /** Aguardando roteador */
  PendingRouter = 19,
  /** Aguardando envio */
  PendingSend = 20,
  /** Aguardando pré-confirmação */
  PendingPreConfirm = 21,
  /** Aguardando abertura do mercado */
  PendingOpening = 22,
  /** Aguardando fechamento do mercado */
  PendingClosing = 23,
  /** Aguardando leilão de abertura */
  PendingAuction = 24,
  /** Suspensa pelo mercado */
  SuspendedByMarket = 25,
  /** Suspensa pelo usuário */
  SuspendedByUser = 26,
  /** Enviada ao corretora (BBM-API) */
  BrokerSent = 27,
  /** Aguardando cancelamento */
  PendingCancel = 28,
  /** Aguardando modificação */
  PendingModify = 29,
}

/**
 * Enum TConnectorFeedType
 * Tipo de feed de dados
 */
export enum TConnectorFeedType {
  /** Cotação nível 1 (tick) */
  CBT = 1,
  /** Livro de ofertas */
  Level2 = 2,
  /** Todos os campos de livro */
  FullBook = 3,
  /** Cotação e livro */
  CBTAndBook = 4,
}

/**
 * Enum TConnectorPriceDirection
 * Direção do preço
 */
export enum TConnectorPriceDirection {
  /** Compra (bid) */
  Buy = 1,
  /** Venda (ask) */
  Sell = 2,
}

/**
 * Enum TConnectorOrderFlags
 * Flags especiais da ordem
 */
export enum TConnectorOrderFlags {
  None = 0,
  /** Ordem é de day trade */
  DayTrade = 1,
  /** Ordem é de fechamento */
  ClosePosition = 2,
  /** Carregar quantidade */
  Carry = 4,
  /** Não carregar quantidade */
  NotCarry = 8,
  /** Garantia minima */
  MinGuarantee = 16,
  /** Ordem anônima */
  Anonymous = 32,
  /**Ordern de abertura */
  Opening = 64,
  /** Prevenção de exposição */
  ExposureProhibition = 128,
  /** Oferta automática */
  AutoOffer = 256,
  /** Melhor oferta */
  BestOffer = 512,
  /** Preço da oferta */
  OfferPrice = 1024,
  /** Ordem de primeira mão */
  FirstHand = 2048,
  /** Ordem deNH */
  NH = 4096,
}

/**
 * Enum TConnectorTradeSide
 * Lado do trade
 */
export enum TConnectorTradeSide {
  Buy = 1,
  Sell = 2,
}

/**
 * Enum TConnectorTradeType
 * Tipo de trade
 */
export enum TConnectorTradeType {
  /** Comum */
  Normal = 1,
  /**gmamento */
  Exercise = 2,
  /** Encerramento */
  Close = 3,
  /** Abrertura */
  Open = 4,
  /** Encerramento automático */
  AutoClose = 5,
  /** Stop */
  Stop = 6,
  /** Spread */
  Spread = 7,
  /** Combo */
  Combo = 8,
  /** Aluguel */
  Lease = 9,
  /** Recolhimento */
  Collection = 10,
}

/**
 * Enum TConnectorMarketState
 * Estado do mercado
 */
export enum TConnectorMarketState {
  /** Fechado */
  Closed = 1,
  /** Pré-abertura */
  PreOpening = 2,
  /** Aleghäo de abertura */
  OpeningAuction = 3,
  /** Contínuo */
  Continuous = 4,
  /** Aleghäo de fechamento */
  ClosingAuction = 5,
  /** Pós-fechamento */
  AfterClosing = 6,
  /** Indisponível */
  Unavailable = 7,
}

/**
 * Enum TConnectorStateCallback
 * Estado da conexão
 */
export enum TConnectorState {
  /** Desconectado */
  Disconnected = 0,
  /** Conectando */
  Connecting = 1,
  /** Conectado */
  Connected = 2,
  /** Autenticando */
  Authenticating = 3,
  /** Autenticado */
  Authenticated = 4,
  /** Erro */
  Error = 5,
}

/**
 * Enum TConnectorSubscribeResult
 * Resultado de subscribe
 */
export enum TConnectorSubscribeResultEnum {
  Success = 0,
  AlreadySubscribed = 1,
  NotConnected = 2,
  InvalidTicker = 3,
  Error = 4,
}

/**
 * Enum TConnectorMessageType
 * Tipo de mensagem de trading
 */
export enum TConnectorMessageType {
  /** Envio de ordem */
  Order = 1,
  /** Cancelamento */
  Cancel = 2,
  /** Modificação */
  Modify = 3,
}

/**
 * Enum TConnectorAssetType
 * Tipo de ativo
 */
export enum TConnectorAssetType {
  /** Ação */
  Stock = 1,
  /** Opção de ação */
  StockOption = 2,
  /** Índice */
  Index = 3,
  /** Dinheiro */
  Money = 4,
  /** Swap */
  Swap = 5,
  /** Termo */
  Term = 6,
  /** Futuro de índice */
  FutureIndex = 7,
  /** Futuro de ação */
  FutureStock = 8,
  /** Futuro de dólar */
  FutureDollar = 9,
  /** Opção de índice */
  IndexOption = 10,
  /** Opção de dólar */
  DollarOption = 11,
  /** ETF */
  ETF = 12,
  /** Renda fixa */
  FixedIncome = 13,
  /** ETF de índices */
  ETFIndex = 14,
  /** Títulos públicos */
  GovernmentBond = 15,
  /** Debêntures */
  Debenture = 16,
  /** Unit trusts */
  Unit = 17,
  /** Recebíveis */
  Receivable = 18,
  /** COE */
  COE = 19,
  /** Commodities */
  Commodity = 20,
  /** Moeda */
  Currency = 21,
}
