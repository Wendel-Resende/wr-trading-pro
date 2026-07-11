export interface StockReport {
  id: string;
  name: string;
  type: 'PORTFOLIO' | 'PERFORMANCE' | 'DIVIDENDS' | 'STATUS';
  startDate: Date;
  endDate: Date;
  data: PortfolioReportData | PerformanceReportData | DividendReportData | StatusReportData;
  generatedBy: string;
  createdAt: Date;
}

export interface StockReportInput {
  name: string;
  type: 'PORTFOLIO' | 'PERFORMANCE' | 'DIVIDENDS' | 'STATUS';
  startDate: Date;
  endDate: Date;
  data: PortfolioReportData | PerformanceReportData | DividendReportData | StatusReportData;
  generatedBy?: string;
}

// Estrutura de dados para relatórios

export interface PortfolioReportData {
  totalValue: number;
  totalInvested: number;
  totalProfit: number;
  totalProfitPercentage: number;
  stockCount: number;
  diversification: {
    bySector: { [key: string]: number };
    byStock: { symbol: string; value: number; percentage: number }[];
  };
  topPerformers: {
    symbol: string;
    profit: number;
    profitPercentage: number;
  }[];
  worstPerformers: {
    symbol: string;
    profit: number;
    profitPercentage: number;
  }[];
}

export interface PerformanceReportData {
  daily: {
    date: string;
    value: number;
    profit: number;
    profitPercentage: number;
  }[];
  weekly: {
    date: string;
    value: number;
    profit: number;
    profitPercentage: number;
  }[];
  monthly: {
    date: string;
    value: number;
    profit: number;
    profitPercentage: number;
  }[];
  totalReturn: number;
  averageDailyReturn: number;
  volatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

export interface DividendReportData {
  totalReceived: number;
  projectedAnnual: number;
  dividendYield: number;
  yieldOnCost: number;
  byStock: {
    symbol: string;
    totalReceived: number;
    projected: number;
    yield: number;
  }[];
  byMonth: {
    month: string;
    total: number;
  }[];
  dividendMap: {
    [stockSymbol: string]: {
      year: number;
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
    }[];
  };
}

export interface StatusReportData {
  totalStocks: number;
  buySignals: number;
  sellSignals: number;
  neutral: number;
  attention: number;
  byStatus: {
    status: string;
    count: number;
    percentage: number;
    stocks: {
      symbol: string;
      name: string;
      currentPrice: number;
      recommendation: string;
    }[];
  }[];
  alertCount: {
    critical: number;
    warning: number;
    info: number;
  };
}
