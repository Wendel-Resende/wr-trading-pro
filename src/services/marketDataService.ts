import { TickerData, OrderBook, ChartData, MarketData } from '@/types';

// Mock data for Brazilian stocks
const MOCK_ASSETS = [
  { symbol: 'PETR4', name: 'Petrobras PN', type: 'STOCK', exchange: 'B3' },
  { symbol: 'VALE3', name: 'Vale ON', type: 'STOCK', exchange: 'B3' },
  { symbol: 'ITUB4', name: 'Itaú Unibanco PN', type: 'STOCK', exchange: 'B3' },
  { symbol: 'BBDC4', name: 'Bradesco PN', type: 'STOCK', exchange: 'B3' },
  { symbol: 'WEGE3', name: 'WEG ON', type: 'STOCK', exchange: 'B3' },
  { symbol: 'MGLU3', name: 'Magazine Luiza ON', type: 'STOCK', exchange: 'B3' },
  { symbol: 'BOVA11', name: 'BOVA11 ETF', type: 'ETF', exchange: 'B3' },
  { symbol: 'IVVB11', name: 'IVVB11 ETF', type: 'ETF', exchange: 'B3' },
];

// Base prices for mock data
const BASE_PRICES: Record<string, number> = {
  'PETR4': 34.20,
  'VALE3': 66.50,
  'ITUB4': 29.10,
  'BBDC4': 14.80,
  'WEGE3': 38.50,
  'MGLU3': 2.15,
  'BOVA11': 125.30,
  'IVVB11': 285.40,
};

// Generate random price variation
function randomVariation(base: number, percent: number = 0.02): number {
  const variation = (Math.random() - 0.5) * 2 * percent;
  return base * (1 + variation);
}

// Generate mock ticker data
export function getMockTickerData(symbol: string): TickerData {
  const basePrice = BASE_PRICES[symbol] || 100;
  const currentPrice = randomVariation(basePrice, 0.01);
  const change = currentPrice - basePrice;
  const changePercent = (change / basePrice) * 100;
  
  return {
    symbol,
    price: currentPrice,
    change,
    changePercent,
    volume: Math.floor(Math.random() * 10000000) + 1000000,
    high: currentPrice * 1.02,
    low: currentPrice * 0.98,
    timestamp: new Date(),
  };
}

// Generate mock order book
export function getMockOrderBook(symbol: string): OrderBook {
  const basePrice = BASE_PRICES[symbol] || 100;
  const bids: any[] = [];
  const asks: any[] = [];
  
  for (let i = 0; i < 10; i++) {
    const bidPrice = basePrice * (1 - (i + 1) * 0.001);
    const askPrice = basePrice * (1 + (i + 1) * 0.001);
    
    bids.push({
      price: bidPrice,
      quantity: Math.floor(Math.random() * 10000) + 1000,
      orders: Math.floor(Math.random() * 50) + 1,
    });
    
    asks.push({
      price: askPrice,
      quantity: Math.floor(Math.random() * 10000) + 1000,
      orders: Math.floor(Math.random() * 50) + 1,
    });
  }
  
  return {
    symbol,
    bids,
    asks,
    timestamp: new Date(),
  };
}

// Generate mock chart data (candlesticks)
export function getMockChartData(symbol: string, count: number = 100): ChartData[] {
  const basePrice = BASE_PRICES[symbol] || 100;
  const data: ChartData[] = [];
  let currentPrice = basePrice;
  const now = Date.now();
  
  for (let i = count; i >= 0; i--) {
    const time = now - i * 60000; // 1 minute intervals
    const open = currentPrice;
    const close = randomVariation(open, 0.005);
    const high = Math.max(open, close) * (1 + Math.random() * 0.003);
    const low = Math.min(open, close) * (1 - Math.random() * 0.003);
    const volume = Math.floor(Math.random() * 1000000) + 100000;
    
    data.push({
      time: Math.floor(time / 1000),
      open,
      high,
      low,
      close,
      volume,
    });
    
    currentPrice = close;
  }
  
  return data;
}

// Get all mock tickers
export function getAllMockTickers(): TickerData[] {
  return MOCK_ASSETS.map(asset => getMockTickerData(asset.symbol));
}

// Get mock assets list
export function getMockAssets() {
  return MOCK_ASSETS;
}

// Simulate real-time updates
export function subscribeToTicker(symbol: string, callback: (data: TickerData) => void): () => void {
  const interval = setInterval(() => {
    callback(getMockTickerData(symbol));
  }, 1000);
  
  return () => clearInterval(interval);
}

// Subscribe to all tickers
export function subscribeToAllTickers(callback: (data: TickerData[]) => void): () => void {
  const interval = setInterval(() => {
    callback(getAllMockTickers());
  }, 1000);
  
  return () => clearInterval(interval);
}

// Subscribe to order book updates
export function subscribeToOrderBook(symbol: string, callback: (data: OrderBook) => void): () => void {
  const interval = setInterval(() => {
    callback(getMockOrderBook(symbol));
  }, 500);
  
  return () => clearInterval(interval);
}