import { NextRequest, NextResponse } from 'next/server';
import { historicalDataService } from '@/services/historicalDataService';

// GET /api/historical-candles?symbol=PETR4&timeframe=H1&limit=500
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol    = searchParams.get('symbol')    ?? 'PETR4';
    const timeframe = searchParams.get('timeframe') ?? 'H1';
    const limit     = parseInt(searchParams.get('limit') ?? '500', 10);

    const data = await historicalDataService.getCandles(symbol, timeframe, limit);
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// POST /api/historical-candles
// body: { symbol, timeframe, candles: [{time,open,high,low,close,volume}] }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbol, timeframe, candles } = body as {
      symbol: string;
      timeframe: string;
      candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[];
    };

    if (!symbol || !timeframe || !Array.isArray(candles)) {
      return NextResponse.json(
        { success: false, error: 'symbol, timeframe and candles[] are required' },
        { status: 400 }
      );
    }

    const count = await historicalDataService.upsertCandles(symbol, timeframe, candles);
    return NextResponse.json({ success: true, data: { synced: count } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
