export interface StockMonitoring {
  id: string;
  assetId: string;
  asset?: {
    id: string;
    symbol: string;
    name: string;
    type: string;
    exchange: string;
  };
  
  // Dados fundamentais
  stockType: 'ON' | 'PN';
  composition: number;
  payoutEstatuto?: number;
  dyMedia3Anos?: number;
  
  // Gatilhos de compra (indicadores para decisão)
  gatilhoROE?: number;
  gatilhoVPA?: number;
  gatilhoLPA?: number;
  
  // Preços de referência (cálculos da plataforma)
  precoTeto?: number;
  precoTetoReajustado?: number;
  
  // Metas de posição
  metaPapeis: number;
  investimentoNecessarioParaMeta?: number;
  
  // Dados financeiros da empresa (entrada manual)
  patrimonioLiquido?: number;
  lucroLiquido?: number;
  acoesEmitidas?: bigint;
  vpa?: number;
  pVpa?: number;
  lpa?: number;
  precoLucro?: number;
  roe?: number;
  
  // Projeção de dividendos
  previsaoDividendoAnual?: number;
  yieldOnCost?: number;
  
  // Dados de posição (vêm do MT5)
  precoAtual?: number;
  quantidadeAdquirida: number;
  precoMedioCompra?: number;
  valorInvestido?: number;
  valorCarteira?: number;
  resultado: number;
  participacaoCarteira?: number;
  
  // Status do monitoramento
  status: 'COMPRA' | 'VENDA' | 'NEUTRO' | 'ATENCAO';
  observacoes?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

export interface DividendMap {
  id: string;
  stockId: string;
  jan: number;
  fev: number;
  mar: number;
  abr: number;
  mai: number;
  jun: number;
  jul: number;
  ago: number;
  set: number;
  out: number;
  nov: number;
  dez: number;
  total: number;
  ano: number;
  stock?: StockMonitoring;
}

export interface StockMonitoringInput {
  assetId: string;
  stockType: 'ON' | 'PN';
  composition?: number;
  payoutEstatuto?: number;
  dyMedia3Anos?: number;
  gatilhoROE?: number;
  gatilhoVPA?: number;
  gatilhoLPA?: number;
  precoTeto?: number;
  precoTetoReajustado?: number;
  metaPapeis?: number;
  investimentoNecessarioParaMeta?: number;
  patrimonioLiquido?: number;
  lucroLiquido?: number;
  acoesEmitidas?: number;
  vpa?: number;
  pVpa?: number;
  lpa?: number;
  precoLucro?: number;
  roe?: number;
  previsaoDividendoAnual?: number;
  observacoes?: string;
  status?: 'COMPRA' | 'VENDA' | 'NEUTRO' | 'ATENCAO';
  // Campos de posição (para importação do MT5)
  quantidadeAdquirida?: number;
  precoMedioCompra?: number;
  valorInvestido?: number;
  valorCarteira?: number;
  resultado?: number;
  precoAtual?: number;
}

export interface DividendMapInput {
  stockId: string;
  jan?: number;
  fev?: number;
  mar?: number;
  abr?: number;
  mai?: number;
  jun?: number;
  jul?: number;
  ago?: number;
  set?: number;
  out?: number;
  nov?: number;
  dez?: number;
  ano: number;
}

export interface StockMonitoringUpdate {
  stockType?: 'ON' | 'PN';
  composition?: number;
  payoutEstatuto?: number;
  dyMedia3Anos?: number;
  gatilhoROE?: number;
  gatilhoVPA?: number;
  gatilhoLPA?: number;
  precoTeto?: number;
  precoTetoReajustado?: number;
  metaPapeis?: number;
  investimentoNecessarioParaMeta?: number;
  patrimonioLiquido?: number;
  lucroLiquido?: number;
  acoesEmitidas?: number;
  vpa?: number;
  pVpa?: number;
  lpa?: number;
  precoLucro?: number;
  roe?: number;
  previsaoDividendoAnual?: number;
  observacoes?: string;
  // Campos de sincronização com MT5
  precoAtual?: number;
  quantidadeAdquirida?: number;
  precoMedioCompra?: number;
  valorInvestido?: number;
  valorCarteira?: number;
  resultado?: number;
  participacaoCarteira?: number;
}
