'use client';

import React, { useState, useCallback } from 'react';
import { runMACrossover, runLinearRegression } from '@/services/mlModels';
import { runBacktest, type BacktestResult, type BacktestParams } from '@/services/backtesting';
import type { Candle } from '@/services/historicalDataService';
import { MT5ServiceSingleton } from '@/services/mt5Service';

const mt5Service = MT5ServiceSingleton.getInstance();

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
  const [results,      setResults]      = useState<Record<string, BacktestResult>>({});
  const [candleRanges, setCandleRanges] = useState<Record<string, { count: number; from: string; to: string }>>({});
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
    const bars = await mt5Service.getChartData(symbol, timeframe, 99999);
    if (!bars || bars.length === 0) throw new Error('Nenhum candle retornado pelo MT5');
    return bars.map(b => ({
      time:   new Date(b.time * 1000),
      open:   b.open,
      high:   b.high,
      low:    b.low,
      close:  b.close,
      volume: b.volume ?? 0,
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
      if (candles.length > 0) {
        const fmt = (d: Date) => d.toLocaleDateString('pt-BR');
        setCandleRanges(prev => ({ ...prev, [cfg.id]: { count: candles.length, from: fmt(candles[0].time), to: fmt(candles[candles.length - 1].time) } }));
      }
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
                  {candleRanges[cfg.id] && (
                    <p className="text-xs text-gray-500">
                      {candleRanges[cfg.id].count} candles — {candleRanges[cfg.id].from} → {candleRanges[cfg.id].to}
                    </p>
                  )}
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
