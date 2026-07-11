# Sub-projeto 3 — ML Pipeline: Implementação

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully functional ML pipeline that caches MT5 historical candle data in SQLite, runs pure-TypeScript MA Crossover and Linear Regression models, backtests them, and surfaces BUY/SELL/HOLD signals plus performance metrics in the existing ML tabs.

**Architecture:** Historical candle data is fetched from MT5 via `mt5Service.getChartData()`, persisted in SQLite through Prisma, and consumed by pure-TypeScript model services; a Next.js API route bridges the frontend tabs to the data layer; backtest results and live signals are rendered in the two ML tabs without touching the existing Python-backed `mlService.ts`.

**Tech Stack:** Next.js 15, TypeScript, Prisma/SQLite, mt5Service.getChartData()

---

## Mapa de Arquivos

### Modificados
- `prisma/schema.prisma` — adicionar modelo `HistoricalCandle`

### Criados
- `src/app/api/historical-candles/route.ts` — GET/POST para candles históricos
- `src/services/historicalDataService.ts` — cache MT5 → SQLite
- `src/services/mlModels.ts` — MA Crossover + Linear Regression em TypeScript puro
- `src/services/backtesting.ts` — motor de backtest com métricas
- `src/components/tabs/MLPredictionsTab.tsx` — reescrito (sinal BUY/SELL/HOLD em tempo real)
- `src/components/tabs/MLModelsTab.tsx` — reescrito (comparação de modelos + backtesting)

### NÃO tocar
- `src/services/mlService.ts` — serviço Python na porta 8767, não alterar

---

## Task 1 — Adicionar modelo HistoricalCandle ao schema Prisma

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Abrir `prisma/schema.prisma` e adicionar o novo modelo no final**

```prisma
model HistoricalCandle {
  id        Int      @id @default(autoincrement())
  symbol    String
  timeframe String
  time      DateTime
  open      Float
  high      Float
  low       Float
  close     Float
  volume    Float
  createdAt DateTime @default(now())

  @@unique([symbol, timeframe, time])
  @@index([symbol, timeframe, time])
}
```

- [ ] **Step 2: Rodar a migration**

```bash
cd "C:/Users/rwres/OneDrive/Área de Trabalho/AI/wr_trade_pro_"
conda run -n IA_Day_Trading npx prisma migrate dev --name add_historical_candle
```

Esperado: `✔ Generated Prisma Client` e nova pasta em `prisma/migrations/`.

- [ ] **Step 3: Regenerar o Prisma client**

```bash
conda run -n IA_Day_Trading npx prisma generate
```

- [ ] **Step 4: Verificar que a tabela foi criada**

```bash
conda run -n IA_Day_Trading npx prisma studio
```

Confirmar que `HistoricalCandle` aparece na lista de modelos.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(prisma): adicionar modelo HistoricalCandle para cache de candles MT5"
```

---

## Task 2 — Criar API route GET/POST /api/historical-candles

**Files:**
- Create: `src/app/api/historical-candles/route.ts`

- [ ] **Step 1: Criar o diretório**

```bash
mkdir -p "C:/Users/rwres/OneDrive/Área de Trabalho/AI/wr_trade_pro_/src/app/api/historical-candles"
```

- [ ] **Step 2: Criar `src/app/api/historical-candles/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { historicalDataService } from '@/services/historicalDataService';

// GET /api/historical-candles?symbol=EURUSD&timeframe=H1&limit=500
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol    = searchParams.get('symbol')    ?? 'EURUSD';
    const timeframe = searchParams.get('timeframe') ?? 'H1';
    const limit     = parseInt(searchParams.get('limit') ?? '500', 10);

    const data = await historicalDataService.getCandles(symbol, timeframe, limit);
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// POST /api/historical-candles  body: { symbol, timeframe, forceRefresh? }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbol, timeframe, forceRefresh = false } = body as {
      symbol: string;
      timeframe: string;
      forceRefresh?: boolean;
    };

    if (!symbol || !timeframe) {
      return NextResponse.json(
        { success: false, error: 'symbol and timeframe are required' },
        { status: 400 }
      );
    }

    const count = await historicalDataService.syncCandles(symbol, timeframe, forceRefresh);
    return NextResponse.json({ success: true, data: { synced: count } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verificar TypeScript**

```bash
cd "C:/Users/rwres/OneDrive/Área de Trabalho/AI/wr_trade_pro_"
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/historical-candles/
git commit -m "feat(api): rota GET/POST /api/historical-candles para candles históricos"
```

---

## Task 3 — Criar `src/services/historicalDataService.ts`

**Files:**
- Create: `src/services/historicalDataService.ts`

- [ ] **Step 1: Ler `src/services/mt5Service.ts` para verificar a assinatura de `getChartData`**

```bash
grep -n "getChartData" "C:/Users/rwres/OneDrive/Área de Trabalho/AI/wr_trade_pro_/src/services/mt5Service.ts"
```

Confirmar: `getChartData(symbol: string, timeframe: string, count: number): Promise<MT5Candle[]>`
O tipo `MT5Candle` tem campos: `time` (Unix seconds), `open`, `high`, `low`, `close`, `volume`.

- [ ] **Step 2: Ler `src/lib/prisma.ts` para confirmar o caminho do singleton**

```bash
cat "C:/Users/rwres/OneDrive/Área de Trabalho/AI/wr_trade_pro_/src/lib/prisma.ts"
```

- [ ] **Step 3: Criar `src/services/historicalDataService.ts`**

```typescript
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
  /**
   * Return up to `limit` candles from SQLite cache (oldest → newest).
   * If fewer than `limit` rows exist, tries to sync from MT5 first.
   */
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
        // Fall through to whatever is cached
      }
    }

    return this._normalise(cached).reverse(); // oldest → newest
  }

  /**
   * Fetch from MT5 via getChartData() and upsert into SQLite.
   * Returns the number of rows upserted.
   */
  async syncCandles(
    symbol: string,
    timeframe: string,
    forceRefresh = false
  ): Promise<number> {
    if (!forceRefresh) {
      const count = await prisma.historicalCandle.count({ where: { symbol, timeframe } });
      if (count >= 500) return count; // cache is already warm
    }

    const bars = await mt5Service.getChartData(symbol, timeframe, 1000);
    if (!bars || bars.length === 0) return 0;

    let upserted = 0;
    for (const bar of bars) {
      const time = new Date(bar.time * 1000); // MT5 returns UNIX seconds
      await prisma.historicalCandle.upsert({
        where: { symbol_timeframe_time: { symbol, timeframe, time } },
        update: {
          open:   bar.open,
          high:   bar.high,
          low:    bar.low,
          close:  bar.close,
          volume: bar.volume ?? 0,
        },
        create: {
          symbol,
          timeframe,
          time,
          open:   bar.open,
          high:   bar.high,
          low:    bar.low,
          close:  bar.close,
          volume: bar.volume ?? 0,
        },
      });
      upserted++;
    }

    return upserted;
  }

  private _normalise(
    rows: { time: Date; open: number; high: number; low: number; close: number; volume: number }[]
  ): Candle[] {
    return rows.map(r => ({
      time:   r.time,
      open:   r.open,
      high:   r.high,
      low:    r.low,
      close:  r.close,
      volume: r.volume,
    }));
  }
}

export const historicalDataService = new HistoricalDataService();
```

- [ ] **Step 4: Verificar TypeScript**

```bash
cd "C:/Users/rwres/OneDrive/Área de Trabalho/AI/wr_trade_pro_"
npx tsc --noEmit 2>&1 | head -20
```

Corrigir quaisquer erros encontrados (especialmente se o campo `volume` no `MT5Candle` tiver nome diferente).

- [ ] **Step 5: Commit**

```bash
git add src/services/historicalDataService.ts
git commit -m "feat(ml): historicalDataService — cache candles MT5 no SQLite"
```

---

## Task 4 — Criar `src/services/mlModels.ts`

**Files:**
- Create: `src/services/mlModels.ts`

TypeScript puro — sem Python, sem HTTP calls. Dois modelos: MA Crossover e Regressão Linear (OLS via equações normais).

- [ ] **Step 1: Criar `src/services/mlModels.ts`**

```typescript
import type { Candle } from './historicalDataService';

// ─── Shared types ─────────────────────────────────────────────────────────────

export type Signal = 'BUY' | 'SELL' | 'HOLD';

export interface ModelPrediction {
  signal:     Signal;
  confidence: number;   // 0–1
  meta:       Record<string, number | string>;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sma(closes: number[], period: number): number[] {
  return closes.map((_, i) => {
    if (i < period - 1) return NaN;
    const slice = closes.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function ema(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = new Array(closes.length).fill(NaN);
  const start = period - 1;
  if (start >= closes.length) return result;
  result[start] = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = start + 1; i < closes.length; i++) {
    result[i] = closes[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

// ─── Model 1: MA Crossover ────────────────────────────────────────────────────

export interface MACrossoverParams {
  fastPeriod:  number;   // default 10
  slowPeriod:  number;   // default 30
  useEMA:      boolean;  // default true
}

export function runMACrossover(
  candles: Candle[],
  params: Partial<MACrossoverParams> = {}
): ModelPrediction {
  const { fastPeriod = 10, slowPeriod = 30, useEMA = true } = params;

  if (candles.length < slowPeriod + 2) {
    return { signal: 'HOLD', confidence: 0, meta: { error: 'insufficient data' } };
  }

  const closes = candles.map(c => c.close);
  const maFn   = useEMA ? ema : sma;
  const fast   = maFn(closes, fastPeriod);
  const slow   = maFn(closes, slowPeriod);
  const last   = closes.length - 1;
  const prev   = last - 1;

  const [fL, sL, fP, sP] = [fast[last], slow[last], fast[prev], slow[prev]];
  if ([fL, sL, fP, sP].some(isNaN)) {
    return { signal: 'HOLD', confidence: 0, meta: { error: 'NaN in MA calculation' } };
  }

  const crossedUp   = fP <= sP && fL > sL;
  const crossedDown = fP >= sP && fL < sL;
  const spread      = Math.abs(fL - sL) / sL;

  let signal: Signal;
  let confidence: number;

  if (crossedUp)        { signal = 'BUY';  confidence = Math.min(0.5 + spread * 100, 0.95); }
  else if (crossedDown) { signal = 'SELL'; confidence = Math.min(0.5 + spread * 100, 0.95); }
  else if (fL > sL)     { signal = 'BUY';  confidence = Math.min(0.3 + spread * 50,  0.75); }
  else if (fL < sL)     { signal = 'SELL'; confidence = Math.min(0.3 + spread * 50,  0.75); }
  else                  { signal = 'HOLD'; confidence = 0.1; }

  return {
    signal,
    confidence,
    meta: {
      fastMA:     +fL.toFixed(5),
      slowMA:     +sL.toFixed(5),
      lastClose:  +closes[last].toFixed(5),
      fastPeriod,
      slowPeriod,
      maType:     useEMA ? 'EMA' : 'SMA',
    },
  };
}

// ─── Model 2: Linear Regression ──────────────────────────────────────────────

export interface LinearRegressionParams {
  lookback:  number;   // bars usados para fit, default 50
  horizon:   number;   // bars à frente para prever, default 5
}

export function runLinearRegression(
  candles: Candle[],
  params: Partial<LinearRegressionParams> = {}
): ModelPrediction {
  const { lookback = 50, horizon = 5 } = params;

  if (candles.length < lookback) {
    return { signal: 'HOLD', confidence: 0, meta: { error: 'insufficient data' } };
  }

  const closes = candles.slice(-lookback).map(c => c.close);
  const n      = closes.length;
  const xs     = Array.from({ length: n }, (_, i) => i);

  const sumX  = xs.reduce((a, b) => a + b, 0);
  const sumY  = closes.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, x, i) => acc + x * closes[i], 0);
  const sumX2 = xs.reduce((acc, x) => acc + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;

  if (denom === 0) {
    return { signal: 'HOLD', confidence: 0, meta: { error: 'degenerate regression' } };
  }

  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const predictedPrice = intercept + slope * (n - 1 + horizon);
  const currentPrice   = closes[n - 1];
  const pctChange      = (predictedPrice - currentPrice) / currentPrice;

  // R² para ponderar confiança
  const yMean = sumY / n;
  const ssTot = closes.reduce((acc, y) => acc + (y - yMean) ** 2, 0);
  const ssRes = closes.reduce((acc, y, i) => acc + (y - (intercept + slope * xs[i])) ** 2, 0);
  const r2    = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

  const THRESHOLD = 0.001; // 0.1 % de movimento → sinal
  let signal: Signal;
  if (pctChange > THRESHOLD)       signal = 'BUY';
  else if (pctChange < -THRESHOLD) signal = 'SELL';
  else                             signal = 'HOLD';

  const confidence = Math.min(r2 * Math.abs(pctChange) * 500, 0.95);

  return {
    signal,
    confidence,
    meta: {
      slope:          +slope.toFixed(8),
      intercept:      +intercept.toFixed(5),
      r2:             +r2.toFixed(4),
      predictedPrice: +predictedPrice.toFixed(5),
      currentPrice:   +currentPrice.toFixed(5),
      pctChange:      +(pctChange * 100).toFixed(4),
      horizon,
      lookback,
    },
  };
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd "C:/Users/rwres/OneDrive/Área de Trabalho/AI/wr_trade_pro_"
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/services/mlModels.ts
git commit -m "feat(ml): mlModels — MA Crossover + Linear Regression em TypeScript puro"
```

---

## Task 5 — Criar `src/services/backtesting.ts`

**Files:**
- Create: `src/services/backtesting.ts`

- [ ] **Step 1: Criar `src/services/backtesting.ts`**

```typescript
import type { Candle } from './historicalDataService';
import type { ModelPrediction } from './mlModels';

export interface BacktestParams {
  initialCapital:   number;   // ex: 10000
  positionSizePct:  number;   // fração do capital por trade, ex: 0.1 = 10%
  stopLossPct:      number;   // ex: 0.01 = 1%
  takeProfitPct:    number;   // ex: 0.02 = 2%
  minConfidence:    number;   // confiança mínima para entrar, ex: 0.4
  warmupBars:       number;   // bars para pular antes de começar, ex: 50
}

export interface Trade {
  entryBar:   number;
  exitBar:    number;
  direction:  'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice:  number;
  pnl:        number;
  pnlPct:     number;
  exitReason: 'TP' | 'SL' | 'END' | 'SIGNAL_FLIP';
}

export interface BacktestResult {
  trades:       Trade[];
  totalReturn:  number;   // decimal, ex: 0.23 = 23%
  winRate:      number;   // decimal
  maxDrawdown:  number;   // decimal, pior pico-ao-vale na curva de equity
  sharpeRatio:  number;   // anualizado (252 dias)
  totalTrades:  number;
  profitFactor: number;
  finalCapital: number;
  equityCurve:  number[]; // valor do capital em cada bar
}

type ModelFn = (candles: Candle[], params?: Record<string, unknown>) => ModelPrediction;

export function runBacktest(
  candles:     Candle[],
  modelFn:     ModelFn,
  modelParams: Record<string, unknown> = {},
  btParams:    Partial<BacktestParams> = {}
): BacktestResult {
  const {
    initialCapital  = 10_000,
    positionSizePct = 0.1,
    stopLossPct     = 0.01,
    takeProfitPct   = 0.02,
    minConfidence   = 0.4,
    warmupBars      = 50,
  } = btParams;

  let capital = initialCapital;
  let peakCap = initialCapital;
  let maxDD   = 0;
  const trades: Trade[]  = [];
  const equity: number[] = [];

  let openTrade: {
    direction:  'LONG' | 'SHORT';
    entryBar:   number;
    entryPrice: number;
    size:       number;
  } | null = null;

  for (let i = warmupBars; i < candles.length; i++) {
    const window  = candles.slice(0, i + 1);
    const price   = candles[i].close;

    // ── Verificar SL/TP em trade aberto ──
    if (openTrade) {
      const { direction, entryPrice, size, entryBar } = openTrade;
      const movePct    = (price - entryPrice) / entryPrice;
      const signedMove = direction === 'LONG' ? movePct : -movePct;
      let closed     = false;
      let exitReason: Trade['exitReason'] = 'SIGNAL_FLIP';

      if (signedMove <= -stopLossPct)  { exitReason = 'SL'; closed = true; }
      if (signedMove >= takeProfitPct) { exitReason = 'TP'; closed = true; }

      if (closed) {
        const pnl    = direction === 'LONG' ? size * (price - entryPrice) : size * (entryPrice - price);
        const pnlPct = pnl / (size * entryPrice);
        capital += pnl;
        trades.push({ entryBar, exitBar: i, direction, entryPrice, exitPrice: price, pnl, pnlPct, exitReason });
        openTrade = null;
      }
    }

    // ── Obter sinal do modelo ──
    const { signal, confidence } = modelFn(window, modelParams as never);

    // ── Fechar por flip de sinal ──
    if (openTrade && confidence >= minConfidence) {
      const { direction, entryPrice, size, entryBar } = openTrade;
      const shouldClose =
        (direction === 'LONG' && signal === 'SELL') ||
        (direction === 'SHORT' && signal === 'BUY');

      if (shouldClose) {
        const pnl    = direction === 'LONG' ? size * (price - entryPrice) : size * (entryPrice - price);
        const pnlPct = pnl / (size * entryPrice);
        capital += pnl;
        trades.push({ entryBar, exitBar: i, direction, entryPrice, exitPrice: price, pnl, pnlPct, exitReason: 'SIGNAL_FLIP' });
        openTrade = null;
      }
    }

    // ── Abrir novo trade ──
    if (!openTrade && confidence >= minConfidence && signal !== 'HOLD') {
      const notional = capital * positionSizePct;
      openTrade = {
        direction:  signal === 'BUY' ? 'LONG' : 'SHORT',
        entryBar:   i,
        entryPrice: price,
        size:       notional / price,
      };
    }

    // ── Equity curve ──
    let unrealised = 0;
    if (openTrade) {
      const { direction, entryPrice, size } = openTrade;
      unrealised = direction === 'LONG' ? size * (price - entryPrice) : size * (entryPrice - price);
    }
    const equityNow = capital + unrealised;
    equity.push(equityNow);

    if (equityNow > peakCap) peakCap = equityNow;
    const dd = (peakCap - equityNow) / peakCap;
    if (dd > maxDD) maxDD = dd;
  }

  // ── Fechar trade aberto no último bar ──
  if (openTrade) {
    const { direction, entryPrice, size, entryBar } = openTrade;
    const price  = candles[candles.length - 1].close;
    const pnl    = direction === 'LONG' ? size * (price - entryPrice) : size * (entryPrice - price);
    const pnlPct = pnl / (size * entryPrice);
    capital += pnl;
    trades.push({ entryBar, exitBar: candles.length - 1, direction, entryPrice, exitPrice: price, pnl, pnlPct, exitReason: 'END' });
  }

  // ── Métricas ──
  const wins        = trades.filter(t => t.pnl > 0);
  const losses      = trades.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss   = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 1) : grossProfit / grossLoss;

  const dailyReturns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    dailyReturns.push((equity[i] - equity[i - 1]) / equity[i - 1]);
  }
  const meanReturn = dailyReturns.length ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
  const stdReturn  = dailyReturns.length > 1
    ? Math.sqrt(dailyReturns.reduce((a, r) => a + (r - meanReturn) ** 2, 0) / (dailyReturns.length - 1))
    : 0;
  const sharpeRatio = stdReturn === 0 ? 0 : (meanReturn / stdReturn) * Math.sqrt(252);

  return {
    trades,
    totalReturn:  (capital - initialCapital) / initialCapital,
    winRate:      trades.length ? wins.length / trades.length : 0,
    maxDrawdown:  maxDD,
    sharpeRatio:  +sharpeRatio.toFixed(4),
    totalTrades:  trades.length,
    profitFactor: +profitFactor.toFixed(4),
    finalCapital: +capital.toFixed(2),
    equityCurve:  equity,
  };
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd "C:/Users/rwres/OneDrive/Área de Trabalho/AI/wr_trade_pro_"
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/services/backtesting.ts
git commit -m "feat(ml): backtesting engine — win rate, drawdown, sharpe, equity curve"
```

---

## Task 6 — Reescrever MLPredictionsTab.tsx

**Files:**
- Modify: `src/components/tabs/MLPredictionsTab.tsx`

- [ ] **Step 1: Ler o arquivo atual para entender o que existe**

```bash
cat "C:/Users/rwres/OneDrive/Área de Trabalho/AI/wr_trade_pro_/src/components/tabs/MLPredictionsTab.tsx"
```

- [ ] **Step 2: Sobrescrever com a nova implementação**

```tsx
'use client';

import React, { useState, useCallback } from 'react';
import { runMACrossover, runLinearRegression, type ModelPrediction, type Signal } from '@/services/mlModels';
import type { Candle } from '@/services/historicalDataService';

const SYMBOLS    = ['PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'ABEV3', 'WEGE3', 'EURUSD', 'GBPUSD'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
const MODELS     = ['MA Crossover', 'Linear Regression'] as const;
type ModelName   = typeof MODELS[number];

const SIGNAL_STYLES: Record<Signal, string> = {
  BUY:  'bg-green-500/20 text-green-400 border border-green-500/40',
  SELL: 'bg-red-500/20   text-red-400   border border-red-500/40',
  HOLD: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40',
};

export default function MLPredictionsTab() {
  const [symbol,      setSymbol]      = useState('PETR4');
  const [timeframe,   setTimeframe]   = useState('H1');
  const [model,       setModel]       = useState<ModelName>('MA Crossover');
  const [fastPeriod,  setFastPeriod]  = useState(10);
  const [slowPeriod,  setSlowPeriod]  = useState(30);
  const [lookback,    setLookback]    = useState(50);
  const [horizon,     setHorizon]     = useState(5);
  const [loading,     setLoading]     = useState(false);
  const [syncing,     setSyncing]     = useState(false);
  const [result,      setResult]      = useState<ModelPrediction | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [candleCount, setCandleCount] = useState<number>(0);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res  = await fetch('/api/historical-candles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, timeframe, forceRefresh: true }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Sync falhou');
      setCandleCount(json.data.synced);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [symbol, timeframe]);

  const handleRun = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res  = await fetch(`/api/historical-candles?symbol=${symbol}&timeframe=${timeframe}&limit=500`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Fetch falhou');

      const candles: Candle[] = (json.data as { time: string; open: number; high: number; low: number; close: number; volume: number }[]).map(c => ({
        ...c,
        time: new Date(c.time),
      }));

      setCandleCount(candles.length);

      const prediction = model === 'MA Crossover'
        ? runMACrossover(candles, { fastPeriod, slowPeriod, useEMA: true })
        : runLinearRegression(candles, { lookback, horizon });

      setResult(prediction);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe, model, fastPeriod, slowPeriod, lookback, horizon]);

  return (
    <div className="p-6 space-y-6 text-white">
      <h2 className="font-orbitron text-2xl font-bold neon-text-cyan">Previsões ML</h2>

      {/* Controles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Símbolo</label>
          <select value={symbol} onChange={e => setSymbol(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm">
            {SYMBOLS.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Timeframe</label>
          <select value={timeframe} onChange={e => setTimeframe(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm">
            {TIMEFRAMES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Modelo</label>
          <select value={model} onChange={e => setModel(e.target.value as ModelName)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm">
            {MODELS.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-2 pt-4">
          <button onClick={handleSync} disabled={syncing}
            className="w-full bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded px-3 py-2 text-sm">
            {syncing ? 'Sincronizando...' : 'Sincronizar MT5'}
          </button>
          <button onClick={handleRun} disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded px-3 py-2 text-sm font-semibold">
            {loading ? 'Calculando...' : 'Executar Modelo'}
          </button>
        </div>
      </div>

      {/* Parâmetros do modelo */}
      {model === 'MA Crossover' && (
        <div className="flex gap-6">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Período Rápido</label>
            <input type="number" min={2} max={100} value={fastPeriod}
              onChange={e => setFastPeriod(+e.target.value)}
              className="w-24 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Período Lento</label>
            <input type="number" min={2} max={300} value={slowPeriod}
              onChange={e => setSlowPeriod(+e.target.value)}
              className="w-24 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm" />
          </div>
        </div>
      )}

      {model === 'Linear Regression' && (
        <div className="flex gap-6">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Lookback</label>
            <input type="number" min={10} max={500} value={lookback}
              onChange={e => setLookback(+e.target.value)}
              className="w-24 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Horizonte (bars)</label>
            <input type="number" min={1} max={50} value={horizon}
              onChange={e => setHorizon(+e.target.value)}
              className="w-24 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm" />
          </div>
        </div>
      )}

      {candleCount > 0 && (
        <p className="text-xs text-gray-400">{candleCount} candles carregados para {symbol} {timeframe}</p>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-500/40 rounded p-3 text-red-400 text-sm">{error}</div>
      )}

      {result && (
        <div className="cyber-card p-6 space-y-4">
          <div className="flex items-center gap-4">
            <span className={`text-3xl font-black px-6 py-3 rounded-lg ${SIGNAL_STYLES[result.signal]}`}>
              {result.signal}
            </span>
            <div>
              <p className="text-sm text-gray-400">Confiança</p>
              <p className="text-xl font-bold">{(result.confidence * 100).toFixed(1)}%</p>
            </div>
          </div>

          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                result.signal === 'BUY' ? 'bg-green-500' :
                result.signal === 'SELL' ? 'bg-red-500' : 'bg-yellow-500'
              }`}
              style={{ width: `${(result.confidence * 100).toFixed(1)}%` }}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-2">
            {Object.entries(result.meta).map(([k, v]) => (
              <div key={k} className="bg-gray-900/60 rounded p-2">
                <p className="text-xs text-gray-400 capitalize">{k.replace(/([A-Z])/g, ' $1')}</p>
                <p className="text-sm font-mono font-semibold">{v}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!result && !loading && !error && (
        <div className="text-center py-12 text-gray-500 text-sm">
          Sincronize os dados do MT5 e execute o modelo para ver a previsão.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add src/components/tabs/MLPredictionsTab.tsx
git commit -m "feat(ml): MLPredictionsTab com sinal BUY/SELL/HOLD em tempo real"
```

---

## Task 7 — Reescrever MLModelsTab.tsx

**Files:**
- Modify: `src/components/tabs/MLModelsTab.tsx`

- [ ] **Step 1: Ler o arquivo atual**

```bash
cat "C:/Users/rwres/OneDrive/Área de Trabalho/AI/wr_trade_pro_/src/components/tabs/MLModelsTab.tsx"
```

- [ ] **Step 2: Sobrescrever com a nova implementação**

```tsx
'use client';

import React, { useState, useCallback } from 'react';
import { runMACrossover, runLinearRegression } from '@/services/mlModels';
import { runBacktest, type BacktestResult, type BacktestParams } from '@/services/backtesting';
import type { Candle } from '@/services/historicalDataService';

const SYMBOLS    = ['PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'ABEV3', 'WEGE3', 'EURUSD'];
const TIMEFRAMES = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

interface ModelConfig {
  id:          string;
  name:        string;
  description: string;
  params:      Record<string, number | boolean>;
}

const MODEL_CONFIGS: ModelConfig[] = [
  {
    id:          'ma_crossover',
    name:        'MA Crossover',
    description: 'Gera sinais BUY/SELL quando a EMA rápida cruza a EMA lenta.',
    params:      { fastPeriod: 10, slowPeriod: 30, useEMA: true },
  },
  {
    id:          'linear_regression',
    name:        'Regressão Linear',
    description: 'Ajusta reta OLS nos closes recentes e extrapola N bars à frente.',
    params:      { lookback: 50, horizon: 5 },
  },
];

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 300, h = 60, pad = 4;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const colour = data[data.length - 1] >= data[0] ? '#22c55e' : '#ef4444';
  return (
    <svg width={w} height={h} className="mt-2">
      <polyline points={pts} fill="none" stroke={colour} strokeWidth={1.5} />
    </svg>
  );
}

function MetricCell({ label, value, good }: { label: string; value: string; good?: boolean | null }) {
  const colour = good === true ? 'text-green-400' : good === false ? 'text-red-400' : 'text-white';
  return (
    <div className="bg-gray-900/60 rounded p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-base font-bold font-mono ${colour}`}>{value}</p>
    </div>
  );
}

export default function MLModelsTab() {
  const [symbol,    setSymbol]    = useState('PETR4');
  const [timeframe, setTimeframe] = useState('H1');
  const [results,   setResults]   = useState<Record<string, BacktestResult>>({});
  const [loading,   setLoading]   = useState<string | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [btParams,  setBtParams]  = useState<Partial<BacktestParams>>({
    initialCapital:  10_000,
    positionSizePct: 0.1,
    stopLossPct:     0.01,
    takeProfitPct:   0.02,
    minConfidence:   0.4,
  });

  const fetchCandles = useCallback(async (): Promise<Candle[]> => {
    const res  = await fetch(`/api/historical-candles?symbol=${symbol}&timeframe=${timeframe}&limit=500`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error ?? 'Fetch falhou');
    return (json.data as { time: string; open: number; high: number; low: number; close: number; volume: number }[]).map(c => ({
      ...c, time: new Date(c.time),
    }));
  }, [symbol, timeframe]);

  const handleBacktest = useCallback(async (cfg: ModelConfig) => {
    setLoading(cfg.id);
    setError(null);
    try {
      const candles = await fetchCandles();
      const modelFn = cfg.id === 'ma_crossover' ? runMACrossover : runLinearRegression;
      const result  = runBacktest(candles, modelFn as Parameters<typeof runBacktest>[1], cfg.params, btParams);
      setResults(prev => ({ ...prev, [cfg.id]: result }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }, [fetchCandles, btParams]);

  return (
    <div className="p-6 space-y-6 text-white">
      <h2 className="font-orbitron text-2xl font-bold neon-text-cyan">Modelos ML & Backtesting</h2>

      {/* Controles globais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Símbolo</label>
          <select value={symbol} onChange={e => setSymbol(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm">
            {SYMBOLS.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Timeframe</label>
          <select value={timeframe} onChange={e => setTimeframe(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm">
            {TIMEFRAMES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Capital Inicial (R$)</label>
          <input type="number" min={100} value={btParams.initialCapital}
            onChange={e => setBtParams(p => ({ ...p, initialCapital: +e.target.value }))}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Confiança Mínima</label>
          <input type="number" min={0} max={1} step={0.05} value={btParams.minConfidence}
            onChange={e => setBtParams(p => ({ ...p, minConfidence: +e.target.value }))}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-2 text-sm" />
        </div>
      </div>

      {/* Parâmetros avançados */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { key: 'positionSizePct', label: 'Tamanho Posição %', step: 0.01 },
          { key: 'stopLossPct',     label: 'Stop Loss %',        step: 0.005 },
          { key: 'takeProfitPct',   label: 'Take Profit %',      step: 0.005 },
        ].map(({ key, label, step }) => (
          <div key={key}>
            <label className="block text-xs text-gray-400 mb-1">{label}</label>
            <input type="number" min={0} max={1} step={step}
              value={btParams[key as keyof BacktestParams] as number}
              onChange={e => setBtParams(p => ({ ...p, [key]: +e.target.value }))}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-2 text-sm" />
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-500/40 rounded p-3 text-red-400 text-sm">{error}</div>
      )}

      {/* Cards de modelos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {MODEL_CONFIGS.map(cfg => {
          const res  = results[cfg.id];
          const busy = loading === cfg.id;
          return (
            <div key={cfg.id} className="cyber-card p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold font-orbitron">{cfg.name}</h3>
                  <p className="text-xs text-gray-400 mt-1">{cfg.description}</p>
                </div>
                <button onClick={() => handleBacktest(cfg)} disabled={busy}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded px-4 py-2 text-sm font-semibold whitespace-nowrap">
                  {busy ? 'Calculando...' : 'Executar Backtest'}
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {Object.entries(cfg.params).map(([k, v]) => (
                  <span key={k} className="text-xs bg-gray-700 rounded px-2 py-0.5 font-mono">
                    {k}: {String(v)}
                  </span>
                ))}
              </div>

              {res && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <MetricCell label="Retorno Total" value={`${(res.totalReturn * 100).toFixed(2)}%`} good={res.totalReturn > 0} />
                    <MetricCell label="Win Rate"      value={`${(res.winRate * 100).toFixed(1)}%`}    good={res.winRate > 0.5} />
                    <MetricCell label="Max Drawdown"  value={`${(res.maxDrawdown * 100).toFixed(2)}%`} good={res.maxDrawdown < 0.1} />
                    <MetricCell label="Sharpe Ratio"  value={res.sharpeRatio.toFixed(3)}              good={res.sharpeRatio > 1} />
                    <MetricCell label="Profit Factor" value={res.profitFactor === Infinity ? '∞' : res.profitFactor.toFixed(3)} good={res.profitFactor > 1} />
                    <MetricCell label="Total Trades"  value={String(res.totalTrades)}                 good={null} />
                    <MetricCell label="Capital Final" value={`R$ ${res.finalCapital.toLocaleString('pt-BR')}`} good={res.finalCapital > (btParams.initialCapital ?? 10_000)} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Curva de Equity</p>
                    <Sparkline data={res.equityCurve} />
                  </div>
                </div>
              )}

              {!res && !busy && (
                <p className="text-sm text-gray-500 italic">
                  Clique em Executar Backtest para ver os resultados com {symbol} {timeframe}.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verificar TypeScript final**

```bash
cd "C:/Users/rwres/OneDrive/Área de Trabalho/AI/wr_trade_pro_"
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add src/components/tabs/MLModelsTab.tsx
git commit -m "feat(ml): MLModelsTab com backtesting, métricas e curva de equity"
```

---

## Validação Final do Sub-projeto 3

- [ ] `prisma/migrations/` tem pasta `_add_historical_candle`
- [ ] `GET /api/historical-candles?symbol=PETR4&timeframe=H1&limit=10` retorna `{ "success": true, "data": [...] }`
- [ ] MLPredictionsTab renderiza sem erros; executar modelo retorna sinal BUY/SELL/HOLD
- [ ] MLModelsTab renderiza sem erros; Executar Backtest mostra tabela de métricas e curva de equity
- [ ] `mlService.ts` não foi tocado (serviço Python na porta 8767 intacto)
- [ ] `npx tsc --noEmit` sem erros

```bash
cd "C:/Users/rwres/OneDrive/Área de Trabalho/AI/wr_trade_pro_"
npx tsc --noEmit 2>&1 | wc -l  # deve ser 0
git log --oneline | head -10
```
