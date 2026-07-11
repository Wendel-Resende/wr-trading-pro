'use client';

import React, { useState, useCallback } from 'react';
import { runMACrossover, runLinearRegression, type ModelPrediction, type Signal } from '@/services/mlModels';
import type { Candle } from '@/services/historicalDataService';
import { MT5ServiceSingleton } from '@/services/mt5Service';

const mt5Service = MT5ServiceSingleton.getInstance();

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
  const [candleRange, setCandleRange] = useState<{ from: string; to: string } | null>(null);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const bars = await mt5Service.getChartData(symbol, timeframe, 99999);
      if (!bars || bars.length === 0) throw new Error('Nenhum candle retornado pelo MT5');
      const res = await fetch('/api/historical-candles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, timeframe, candles: bars }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Sync falhou');
      setCandleCount(json.data.synced);
      const fmt = (ts: number) => new Date(ts * 1000).toLocaleDateString('pt-BR');
      setCandleRange({ from: fmt(bars[0].time), to: fmt(bars[bars.length - 1].time) });
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
      if (candles.length > 0) {
        const fmt = (d: Date) => d.toLocaleDateString('pt-BR');
        setCandleRange({ from: fmt(candles[0].time), to: fmt(candles[candles.length - 1].time) });
      }

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
        <p className="text-xs text-gray-400">
          {candleCount} candles — {symbol} {timeframe}
          {candleRange && <span className="ml-1 text-gray-500">({candleRange.from} → {candleRange.to})</span>}
        </p>
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
