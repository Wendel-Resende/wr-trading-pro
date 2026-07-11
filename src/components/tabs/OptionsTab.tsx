"use client";

import { useState, useCallback } from "react";
import { TrendingUp, TrendingDown, AlertTriangle, Star, RefreshCw, Loader2, Activity } from "lucide-react";
import { scanOptions, parseStrike, determineType, anualizar } from "@/services/optionsService";
import type { OptionsScanResult, OptionsConfig, CoveredCall, CashSecuredPut } from "@/types/options";
import { DEFAULT_OPTIONS_CONFIG } from "@/types/options";

const SIGNAL_STYLES = {
  'COVERED_CALL': 'text-green-400 border-green-500/40',
  'CASH_SECURED_PUT': 'text-red-400 border-red-500/40',
};

// ─── VolatilityCard (v4) ───────────────────────────────────────────────────────

function VolatilityCard({ vol, spot }: { vol: NonNullable<import('@/types/options').OptionsScanResult['volatility']>; spot: number }) {
  const move1d = spot * vol.dailyStd;
  const move5d = spot * vol.dailyStd * Math.sqrt(5);
  const move20d = spot * vol.dailyStd * Math.sqrt(20);
  const trendColor = vol.weeklyPct > 0 ? 'text-green-400' : 'text-red-400';

  return (
    <div className="cyber-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-yellow-400" />
        <h3 className="text-sm font-bold text-yellow-400 tracking-widest uppercase">
          Análise de Volatilidade
        </h3>
        <span className="text-xs text-gray-500">({vol.nCandles} candles)</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div>
          <p className="text-xs text-gray-400">Vol. Diária</p>
          <p className="font-mono font-bold text-white">{(vol.dailyStd * 100).toFixed(2)}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Vol. Anual</p>
          <p className="font-mono font-bold text-white">{(vol.annualStd * 100).toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Tendência Semanal</p>
          <p className={`font-mono font-bold ${trendColor}`}>
            {vol.weeklyPct >= 0 ? '+' : ''}{vol.weeklyPct.toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Preço Atual</p>
          <p className="font-mono font-bold text-white">R$ {spot.toFixed(2)}</p>
        </div>
      </div>

      <div className="mb-2">
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Movimento Esperado</p>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: '1 dia', value: move1d },
            { label: '5 dias', value: move5d },
            { label: '20 dias', value: move20d },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-900/50 rounded p-2 text-center">
              <p className="text-xs text-gray-400">{label}</p>
              <p className="font-mono text-sm text-white">±R$ {value.toFixed(2)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-700/50 pt-2 mt-2">
        <p className="text-[10px] text-gray-500">
          P.Exerc = Probabilidade de exercício ao vencimento (modelo log-normal)
        </p>
      </div>
    </div>
  );
}

// ─── RankCard (v4) ───────────────────────────────────────────────────────────

function RankCard({ result }: { result: NonNullable<import('@/types/options').OptionsScanResult> }) {
  return (
    <div className="cyber-card p-4">
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <Star className="w-4 h-4 text-yellow-400" />
          <h3 className="text-sm font-bold text-yellow-400 tracking-widest uppercase">Ranking de Oportunidades</h3>
        </div>
        <p className="text-[10px] text-gray-500">
          Score = Anual%(40%) + Segurança/P.Exerc(30%) + Liquidez/Spread(30%)
        </p>
      </div>

      {result.topCalls && result.topCalls.length > 0 && (
        <div className="mb-4 p-3 rounded bg-green-900/10 border border-green-800/30">
          <p className="text-xs font-bold text-green-400 tracking-wider mb-2">🏆 TOP 3 VENDA DE CALL</p>
          {result.topCalls.map((c, i) => (
            <div key={c.symbol} className="flex items-center gap-2 text-xs py-1 border-b border-green-800/20 last:border-0">
              <span className="bg-green-600 text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold">
                #{i + 1}
              </span>
              <span className="font-mono text-white font-semibold">{c.symbol}</span>
              <span className="text-gray-400">K={c.strike.toFixed(2)}</span>
              <span className="text-green-400">R${c.premio.toFixed(0)}/lot</span>
              <span className="text-gray-300">Lotes: {c.nLotes}</span>
              <span className="text-green-400 font-bold ml-auto">+R${c.ganhoTotal.toFixed(0)} ({c.ganhoPct.toFixed(1)}%)</span>
            </div>
          ))}
        </div>
      )}

      {result.topPuts && result.topPuts.length > 0 && (
        <div className="p-3 rounded bg-purple-900/10 border border-purple-800/30">
          <p className="text-xs font-bold text-purple-400 tracking-wider mb-2">🏆 TOP 3 VENDA DE PUT (Cash-Secured)</p>
          {result.topPuts.map((p, i) => (
            <div key={p.symbol} className="flex items-center gap-2 text-xs py-1 border-b border-purple-800/20 last:border-0">
              <span className="bg-purple-600 text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold">
                #{i + 1}
              </span>
              <span className="font-mono text-white font-semibold">{p.symbol}</span>
              <span className="text-gray-400">K={p.strike.toFixed(2)}</span>
              <span className="text-green-400">R${p.premio.toFixed(0)}/lot</span>
              <span className="text-gray-300">Lotes: {p.nLotes}</span>
              {p.precoEntrada !== undefined && (
                <span className="text-orange-400 text-[10px]">Se design.: R${p.precoEntrada.toFixed(2)}/ação</span>
              )}
              <span className="text-green-400 font-bold ml-auto">+R${p.ganhoTotal.toFixed(0)} ({p.ganhoPct.toFixed(1)}%)</span>
            </div>
          ))}
        </div>
      )}

      {!result.topCalls?.length && !result.topPuts?.length && (
        <p className="text-xs text-gray-500 text-center py-4">
          Nenhuma oportunidade com liquidez (spread &lt; 5%, DTE 10-90)
        </p>
      )}
    </div>
  );
}

// ─── OptionCard (v4) ──────────────────────────────────────────────────────────

function OptionCard({ option, tipo }: { option: CoveredCall | CashSecuredPut; tipo: 'COVERED_CALL' | 'CASH_SECURED_PUT' }) {
  const expStr = option.expiration instanceof Date
    ? option.expiration.toLocaleDateString('pt-BR')
    : new Date(option.expiration as unknown as string).toLocaleDateString('pt-BR');

  const pExerc = 'pExerc' in option ? option.pExerc : undefined;
  const spreadPct = 'spreadPct' in option ? option.spreadPct : undefined;
  const isWeekly = 'isWeekly' in option ? option.isWeekly : undefined;
  const estilo = 'estilo' in option ? option.estilo : undefined;

  return (
    <div className={`cyber-card p-4 border ${SIGNAL_STYLES[tipo]}`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-sm font-mono text-white">{option.symbol}</p>
          <p className="text-xs text-gray-400">
            {expStr} · {option.dte} DTE
            {isWeekly !== undefined && (
              <span className={`ml-1 ${isWeekly ? 'text-orange-400' : 'text-gray-500'}`}>
                · {isWeekly ? 'Semanal' : 'Mensal'}
              </span>
            )}
          </p>
          {estilo && <p className="text-[10px] text-gray-500">{estilo}</p>}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded border ${SIGNAL_STYLES[tipo]}`}>
          {tipo === 'COVERED_CALL' ? '📈 CALL' : '📉 PUT'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-gray-400">Strike</p>
          <p className="font-mono font-bold text-white">R$ {option.strike.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-gray-400">Bid</p>
          <p className="font-mono font-bold text-white">R$ {option.bid.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-gray-400">Prêmio</p>
          <p className="font-mono font-bold text-white">R$ {option.premioTotal.toFixed(0)}</p>
        </div>
        <div>
          <p className="text-gray-400">Anualizado</p>
          <p className={`font-mono font-bold ${option.anualizado >= 0.05 ? 'text-green-400' : 'text-yellow-400'}`}>
            {(option.anualizado * 100).toFixed(1)}%
          </p>
        </div>
        <div>
          <p className="text-gray-400">OTM</p>
          <p className={`font-mono ${option.otmPct > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {option.otmPct >= 0 ? '+' : ''}{option.otmPct.toFixed(1)}%
          </p>
        </div>
        <div>
          <p className="text-gray-400">ROI</p>
          <p className="font-mono font-bold text-white">{option.roi.toFixed(2)}%</p>
        </div>
        {pExerc !== undefined && (
          <div>
            <p className="text-gray-400">P.Exerc</p>
            <p className={`font-mono font-bold ${pExerc > 60 ? 'text-red-400' : pExerc < 30 ? 'text-green-400' : 'text-yellow-400'}`}>
              {pExerc.toFixed(1)}%
            </p>
          </div>
        )}
        {spreadPct !== undefined && spreadPct < 999 && (
          <div>
            <p className="text-gray-400">Spread</p>
            <p className={`font-mono ${spreadPct > 5 ? 'text-red-400' : 'text-green-400'}`}>
              {spreadPct.toFixed(1)}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function AlertaItem({ msg }: { msg: string }) {
  const isError = msg.includes('❌') || msg.includes('Capital');
  return (
    <div className={`flex items-center gap-2 text-xs p-2 rounded ${isError ? 'text-red-400 bg-red-900/20' : 'text-green-400 bg-green-900/20'}`}>
      {isError ? <AlertTriangle className="w-3 h-3 flex-shrink-0" /> : <span>✅</span>}
      <span>{msg.replace(/^[❌✅]\s*/, '')}</span>
    </div>
  );
}

export default function OptionsTab() {
  const [asset, setAsset] = useState('PETR4');
  const [capital, setCapital] = useState(DEFAULT_OPTIONS_CONFIG.capital);
  const [rangePct, setRangePct] = useState(DEFAULT_OPTIONS_CONFIG.rangePct * 100);
  const [minAnualizado, setMinAnualizado] = useState(DEFAULT_OPTIONS_CONFIG.minAnualizado * 100);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OptionsScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'calls' | 'puts' | 'top'>('top');
  const [debugStatus, setDebugStatus] = useState('');

  const handleScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setDebugStatus('[1/4] Conectando ao MT5...');

    try {
      setDebugStatus('[1/4] Obtendo preço spot...');
      const config: OptionsConfig = {
        capital,
        loteSize: 100,
        rangePct: rangePct / 100,
        minAnualizado: minAnualizado / 100,
      };

      setDebugStatus('[2/4] Calculando volatilidade...');
      setDebugStatus('[3/4] Buscando símbolos de opções...');
      const scanResult = await scanOptions(asset, config);
      setDebugStatus('[4/4] Processando resultados...');
      setResult(scanResult);
      setDebugStatus('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao escanear opções');
      setDebugStatus('');
    } finally {
      setLoading(false);
    }
  }, [asset, capital, rangePct, minAnualizado]);

  return (
    <div className="p-6 space-y-6 text-white">
      <h2 className="font-orbitron text-2xl font-bold neon-text-cyan">Opções B3</h2>

      {/* Controles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Ativo (ex: PETR4, VALE3, MGLU3)</label>
          <input
            type="text"
            value={asset}
            onChange={(e) => setAsset(e.target.value.toUpperCase())}
            placeholder="Digite o ticker..."
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm uppercase"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Capital (R$)</label>
          <input type="number" value={capital} onChange={(e) => setCapital(+e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Faixa Strikes (%)</label>
          <input type="number" min={5} max={30} value={rangePct}
            onChange={(e) => setRangePct(+e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Min. Anualizado (%)</label>
          <input type="number" min={1} max={30} value={minAnualizado}
            onChange={(e) => setMinAnualizado(+e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
        </div>
        <div className="flex flex-col gap-2 pt-4">
          <button onClick={handleScan} disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded px-3 py-2 text-sm font-semibold flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {loading ? 'Escaneando...' : 'Escanear'}
          </button>
        </div>
      </div>

      {/* Info do ativo */}
      {result && (
        <>
          <div className="cyber-card p-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Preço spot</p>
              <p className="text-xl font-bold font-mono text-white">
                R$ {result.spot.toFixed(2)} <span className="text-gray-500 text-sm">{result.asset}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">Último scan</p>
              <p className="text-sm text-gray-300">{result.timestamp.toLocaleTimeString('pt-BR')}</p>
            </div>
          </div>

          {/* VolatilityCard (v4) */}
          {result.volatility && (
            <VolatilityCard vol={result.volatility} spot={result.spot} />
          )}

          {/* RankCard (v4) */}
          <RankCard result={result} />
        </>
      )}

      {/* Debug status */}
      {(loading || debugStatus) && (
        <div className="bg-blue-900/20 border border-blue-500/40 rounded p-3 text-blue-400 text-sm font-mono">
          {debugStatus || 'Escaneando...'}
        </div>
      )}

      {/* Erro */}
      {error && (
        <div className="bg-red-900/30 border border-red-500/40 rounded p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Abas */}
      {result && (
        <div className="flex gap-2">
          {(['calls', 'puts', 'top'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
                view === v ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}>
              {v === 'calls' ? `📈 Calls (${result.calls.length})` :
               v === 'puts' ? `📉 Puts (${result.puts.length})` :
               `🏆 Top 5`}
            </button>
          ))}
        </div>
      )}

      {/* Cards de opções */}
      {result && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {view === 'top' && result.topOportunidades.map((opp, i) => (
            <div key={`${opp.symbol}-${i}`} className="relative">
              <span className="absolute -top-2 -left-2 bg-cyan-600 text-white text-xs w-6 h-6 rounded-full flex items-center justify-center font-bold z-10">
                #{i + 1}
              </span>
              <OptionCard
                option={opp}
                tipo={opp.tipo as 'COVERED_CALL' | 'CASH_SECURED_PUT'}
              />
            </div>
          ))}

          {view === 'calls' && result.calls.map((c, i) => (
            <OptionCard key={`${c.symbol}-${i}`} option={c} tipo="COVERED_CALL" />
          ))}

          {view === 'puts' && result.puts.map((p, i) => (
            <OptionCard key={`${p.symbol}-${i}`} option={p} tipo="CASH_SECURED_PUT" />
          ))}
        </div>
      )}

      {/* Alertas */}
      {result && result.alertas.length > 0 && (
        <div className="cyber-card p-4">
          <h3 className="text-sm font-bold text-yellow-400 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Alertas
          </h3>
          <div className="space-y-2">
            {result.alertas.map((msg, i) => (
              <AlertaItem key={i} msg={msg} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-sm">Configure os parâmetros e clique em "Escanear" para buscar oportunidades de opções.</p>
          <p className="text-xs mt-2 text-gray-600">Suporta PETR4, VALE3, ITUB4, BBDC4, ABEV3, WEGE3</p>
        </div>
      )}
    </div>
  );
}