export interface OptionStrike {
  symbol: string;
  type: 'CALL' | 'PUT';
  strike: number;
  bid: number;
  ask: number;
  dte: number;
  expiration: Date;
  otmPct: number;
  premioTotal: number;
  premioPct: number;
  anualizado: number;
  roi: number;
  margem?: number;
  cabeNoCapital?: boolean;
  // v4 fields
  pExerc?: number;
  spreadPct?: number;
  estilo?: 'AMERICANA' | 'EUROPEIA';
  isWeekly?: boolean;
}

export interface CoveredCall extends OptionStrike {
  tipo: 'COVERED_CALL';
  custoAcoes: number;
}

export interface CashSecuredPut extends OptionStrike {
  tipo: 'CASH_SECURED_PUT';
  margem: number;
}

export interface VolatilityData {
  dailyStd: number;
  annualStd: number;
  weeklyPct: number;
  mean30d: number;
  std30d: number;
  lastClose: number;
  nCandles: number;
}

export interface OptionsScanResult {
  spot: number;
  asset: string;
  calls: CoveredCall[];
  puts: CashSecuredPut[];
  topOportunidades: (CoveredCall | CashSecuredPut)[];
  alertas: string[];
  timestamp: Date;
  volatility?: VolatilityData;
  topCalls?: TopOption[]; // TOP 3 calls com score
  topPuts?: TopOption[];  // TOP 3 puts com score
}

export interface TopOption {
  symbol: string;
  strike: number;
  premio: number;
  nLotes: number;
  ganhoTotal: number;
  ganhoPct: number;
  score: number;
  // Cash-secured put specific
  precoEntrada?: number; // se designado: strike - bid
}

export interface OptionsConfig {
  capital: number;
  loteSize: number;
  rangePct: number;
  minAnualizado: number;
}

export const DEFAULT_OPTIONS_CONFIG: OptionsConfig = {
  capital: 10_000,
  loteSize: 100,
  rangePct: 0.10,
  minAnualizado: 0.05,
};