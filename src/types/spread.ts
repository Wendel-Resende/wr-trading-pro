/**
 * Tipos para análise de Spread entre ações da B3
 */

export interface SpreadDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SpreadPair {
  symbol1: string;
  symbol2: string;
  name1: string;
  name2: string;
}

export interface SpreadResult {
  hist1: SpreadDataPoint[];
  hist2: SpreadDataPoint[];
  spread: number[];
  oportunidades: SpreadOpportunity[];
  currentPrice1: number;
  currentPrice2: number;
  symbol1: string;
  symbol2: string;
  oportunidadesPorMes?: Record<string, number>;
}

export interface SpreadOpportunity {
  dataEntrada: Date;
  dataSaida: Date;
  precoVendaA1: number;
  precoCompraB1: number;
  precoVendaB2: number;
  precoCompraA2: number;
  ganho: number;
  volumeMedioA: number;
  volumeMedioB: number;
  retornoPercentual: number;
}

export interface SpreadMetrics {
  ganhoMedio: number;
  retornoMedio: number;
  spreadAtual: number;
  totalOportunidades: number;
  maiorGanho: number;
  melhorRetorno: number;
}

export interface SpreadPairAnalysis {
  par: string;
  oportunidades: number;
  maiorGanho: number;
  melhorRetorno: number;
  spreadAtual: number;
  currentPrice1?: number;
  currentPrice2?: number;
  symbol1?: string;
  symbol2?: string;
  ideal?: boolean;
  classificacaoOperacional?: 'Ideal Forte' | 'Ideal Limite' | 'Acompanhar' | 'Fraco' | string;
  score?: number;
  motivos?: string[];
  sinal?: 'VENDER_SPREAD' | 'COMPRAR_SPREAD' | 'AGUARDAR' | string;
  direcaoEntrada?: string;
  periodos?: number;
  correlacao?: number;
  correlacaoPrecos?: number | null;
  correlacaoRetornos?: number | null;
  zscore?: number;
  spreadMedio?: number;
  desvioSpread?: number;
  spreadAtualAssinado?: number;
  halfLife?: number | null;
  cruzamentosMedia?: number;
}

export interface SpreadRanking {
  rankingScore: SpreadPairAnalysis[];
  rankingGanho: SpreadPairAnalysis[];
  rankingRetorno: SpreadPairAnalysis[];
  rankingOportunidades: SpreadPairAnalysis[];
}

export interface SpreadConfig {
  symbol1: string;
  symbol2: string;
  startDate: Date;
  endDate: Date;
  ganhoMinimo: number;
}

export const PARES_SUGERIDOS: string[][] = [
  ['PETR4', 'PETR3'],
  ['VALE3', 'VALE4'],
  ['ITUB4', 'ITUB3'],
  ['BBDC4', 'BBDC3'],
  ['BBAS4', 'BBAS3'],
  ['ELET6', 'ELET3'],
  ['CMIG4', 'CMIG3'],
  ['GOAU4', 'GOAU3'],
  ['GGBR4', 'GGBR3'],
  ['USIM5', 'USIM3'],
  ['CSNA3', 'VALE3'],
  ['PETR4', 'VALE3'],
  ['ITUB4', 'BBDC4'],
  ['BBDC4', 'ITUB4'],
  ['PETR3', 'PETR4'],
  ['PETZ3', 'MGLU3'],
  ['MGLU3', 'PETZ3'],
  ['LREN3', 'MGLU3'],
  ['HAPV3', 'BRFS3'],
  ['BRFS3', 'JBSF3'],
  ['RAIL3', 'CCRO3'],
  ['CYRE3', 'MRVE3'],
  ['EQTL3', 'TAEE11'],
  ['EGIE3', 'CPFE3'],
  ['CMIG4', 'CPLE6'],
  ['WEGE3', 'ELET6'],
  ['RENT3', 'CVCB3'],
  ['CVCB3', 'RENT3'],
  ['HAPV3', 'JBSS3'],
  ['BRFS3', 'MRFG3'],
  ['SUZB3', 'KLBN11'],
  ['KLBN11', 'SUZB3'],
  ['RADL3', 'LWSA3'],
  ['CRFB3', 'HAPV3'],
  ['IGTI11', 'MRVE3'],
  ['MRVE3', 'CYRE3'],
  ['CYRE3', 'TOTS3'],
  ['TOTS3', 'CYRE3'],
  ['VBBR3', 'BBAS4'],
  ['BBAS3', 'VBBR3'],
  ['SAPR4', 'VIVT3'],
  ['VIVT3', 'SAPR4'],
  ['PRIO3', 'PETR4'],
  ['PETR4', 'PRIO3'],
  ['ENBR3', 'RENT3'],
  ['RENT3', 'ENBR3'],
  ['EQTL3', 'TAEE3'],
  ['TAEE3', 'EQTL3'],
  ['ALPA4', 'UGPA3'],
  ['UGPA3', 'ALPA4'],
  ['YDUQ3', 'COGN3'],
  ['COGN3', 'YDUQ3'],
  ['BEEF3', 'BRFS3'],
  ['BRFS3', 'BEEF3'],
  ['PTNT4', 'PCAR3'],
  ['PCAR3', 'PTNT4'],
  ['HAPV3', 'TEND3'],
  ['TEND3', 'HAPV3'],
  ['VAMO3', 'RAIL3'],
  ['RAIL3', 'VAMO3'],
  ['CPFE3', 'CMIG4'],
  ['CMIG4', 'CPFE3'],
  ['ENEV3', 'CPLE6'],
  ['CPLE6', 'ENEV3'],
];

export const TIPOS_ACOES = {
  ON: 'Ordinárias - Com direito a voto',
  PN: 'Preferenciais - Prioridade nos dividendos',
  UNT: 'Units - Conjunto de diferentes tipos de ações'
};

export const ESTRATEGIA = `
A estratégia de arbitragem com pares de ações consiste em:

1. Identificar pares de ações que apresentem alta correlação e diferença de preços:
   - Ações da mesma empresa (ON/PN)
   - Empresas do mesmo setor
   - Empresas com modelos de negócio similares
   - Empresas afetadas pelos mesmos fatores de mercado

2. Vender a ação mais cara e comprar a mais barata

3. Aguardar a convergência dos preços

4. Reverter as operações: vender a ação comprada e recomprar a ação vendida

5. Lucrar com a diferença das operações

Fatores importantes:
- Volume de negociação (liquidez)
- Histórico de spreads
- Velocidade de convergência
- Correlação entre os ativos
- Fatores setoriais
- Custos operacionais
`;

export interface SpreadOrder {
  symbol: string;
  quantity: number;
  action: 'buy' | 'sell';
  price?: number;
}

export interface SpreadOrderResult {
  success: boolean;
  message: string;
  order1?: {
    success: boolean;
    symbol: string;
    action: string;
    quantity: number;
    price: number;
    ticket?: number;
    error?: string;
  };
  order2?: {
    success: boolean;
    symbol: string;
    action: string;
    quantity: number;
    price: number;
    ticket?: number;
    error?: string;
  };
}

export type SpreadCondition = 'greater_than' | 'less_than' | 'equal_to';

export interface SpreadAutomation {
  enabled: boolean;
  targetValue: number;
  condition: SpreadCondition;
  symbol1: string;
  symbol2: string;
  quantity1: number;
  quantity2: number;
  action1: 'buy' | 'sell';
  action2: 'buy' | 'sell';
}

export interface SpreadOrderEntry {
  symbol: string;
  currentPrice: number;
  quantity: number;
  action: 'buy' | 'sell';
}

export enum SpreadOrderStatus {
  PENDING = 'pending',      // Aguardando spread atingir alvo
  EXECUTED = 'executed',    // Ordem executada com sucesso
  CANCELLED = 'cancelled',  // Cancelada pelo usuário
  FAILED = 'failed'         // Falha na execução
}

export interface SpreadPendingOrder {
  id: string;
  symbol1: string;
  symbol2: string;
  action1: 'buy' | 'sell';
  action2: 'buy' | 'sell';
  quantity1: number;
  quantity2: number;
  price1: number;
  price2: number;
  targetSpread: number;
  condition: SpreadCondition;
  currentSpread: number;
  status: SpreadOrderStatus;
  createdAt: Date;
  executedAt?: Date;
  profit?: number;
  error?: string;
  order1Ticket?: number;
  order2Ticket?: number;
  triggered?: boolean; // Marca se a ordem já foi acionada para execução
  executing?: boolean; // Marca se a ordem está sendo executada no momento
}

export interface SpreadSummary {
  pendingOrders: number;
  executedToday: number;
  totalProfitToday: number;
}
