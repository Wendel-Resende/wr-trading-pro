import { prisma } from '@/lib/prisma';
import { MT5ServiceSingleton } from '@/services/mt5Service';

const mt5Service = MT5ServiceSingleton.getInstance();

export interface Candle {
  time:   Date;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

class HistoricalDataService {
  async getCandles(symbol: string, timeframe: string, limit = 500): Promise<Candle[]> {
    const cached = await prisma.historicalCandle.findMany({
      where: { symbol, timeframe },
      orderBy: { time: 'desc' },
      take: limit,
    });

    if (cached.length < limit) {
      try {
        await this.syncCandles(symbol, timeframe, false);
        const fresh = await prisma.historicalCandle.findMany({
          where: { symbol, timeframe },
          orderBy: { time: 'desc' },
          take: limit,
        });
        return this._normalise(fresh).reverse();
      } catch {
        // return whatever is cached
      }
    }

    return this._normalise(cached).reverse();
  }

  private async _upsertCandleBars(
    symbol: string,
    timeframe: string,
    bars: { time: number; open: number; high: number; low: number; close: number; volume: number }[]
  ): Promise<number> {
    const CHUNK = 100;
    let upserted = 0;
    for (let i = 0; i < bars.length; i += CHUNK) {
      const chunk = bars.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map((bar) => {
          const time = new Date(bar.time * 1000);
          return prisma.historicalCandle.upsert({
            where: { symbol_timeframe_time: { symbol, timeframe, time } },
            update: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume ?? 0 },
            create: { symbol, timeframe, time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume ?? 0 },
          }).then(() => { upserted++; });
        })
      );
    }
    return upserted;
  }

  async syncCandles(symbol: string, timeframe: string, forceRefresh = false): Promise<number> {
    if (!forceRefresh) {
      const count = await prisma.historicalCandle.count({ where: { symbol, timeframe } });
      if (count >= 500) return count;
    }

    const bars = await mt5Service.getChartData(symbol, timeframe, 1000);
    if (!bars || bars.length === 0) return 0;

    return this._upsertCandleBars(symbol, timeframe, bars);
  }

  async upsertCandles(
    symbol: string,
    timeframe: string,
    bars: { time: number; open: number; high: number; low: number; close: number; volume: number }[]
  ): Promise<number> {
    return this._upsertCandleBars(symbol, timeframe, bars);
  }

  private _normalise(rows: { time: Date; open: number; high: number; low: number; close: number; volume: number }[]): Candle[] {
    return rows.map(r => ({ time: r.time, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
  }
}

export const historicalDataService = new HistoricalDataService();
