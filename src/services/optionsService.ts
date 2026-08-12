/**
 * Opções B3 Service — Utilitários para análise de opções
 *
 * Baseado em python/options/scanner_opcoes.py do Guardião
 * Conversão das funções Python para TypeScript
 * v4: Score ranking, volatilidade, P.Exerc, estilo, semanal
 */

import type { OptionStrike, OptionsConfig, OptionsScanResult, CoveredCall, CashSecuredPut, VolatilityData, TopOption } from '@/types/options';
import { mt5Service } from '@/services/mt5Service';
import { DEFAULT_OPTIONS_CONFIG } from '@/types/options';
import {
  anualizar as pureAnualizar,
  calcExerciseProb as pureCalcExerciseProb,
  determineType as pureDetermineType,
  getDTE as pureGetDTE,
  mean as pureMean,
  parseStrike as pureParseStrike,
  std as pureStd,
} from '@/domain/v1/models/option-position/option-math';

// ─── Constantes B3 ─────────────────────────────────────────────────────────────

const LOT_SIZE = 100; // 1 lote B3 = 100 ações

// ─── Volatilidade (v4) ────────────────────────────────────────────────────────

export interface VolatilityResult {
  dailyStd: number;
  mean30d: number;
  std30d: number;
  annualStd: number;
  weeklyPct: number;
  lastClose: number;
  nCandles: number;
}

/**
 * Obtém volatilidade diária a partir dos últimos N candles diários
 */
export async function getVolatility(asset: string): Promise<VolatilityResult | null> {
  return new Promise((resolve) => {
    const handler = (data: { symbol: string; timeframe?: string; candles?: { time: number; open: number; high: number; low: number; close: number; volume: number }[] }) => {
      if (data.symbol === asset && data.candles && data.candles.length >= 10) {
        mt5Service.off('chartData', handler);
        const closes = data.candles.map((c) => c.close);
        const returns: number[] = [];
        for (let i = 1; i < closes.length; i++) {
          returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
        }
        const dailyStd = std(returns);
        const mean30d = mean(returns.slice(-30));
        const last30 = returns.slice(-30);
        const std30d = last30.length >= 2 ? std(last30) : dailyStd;
        const annualStd = dailyStd * Math.sqrt(252);
        const lastClose = closes[closes.length - 1];
        const prevClose = closes.length >= 6 ? closes[closes.length - 6] : closes[0];
        const weeklyPct = ((lastClose - prevClose) / prevClose) * 100;
        resolve({ dailyStd, mean30d, std30d, annualStd, weeklyPct, lastClose, nCandles: closes.length });
      }
    };

    mt5Service.on('chartData', handler);
    mt5Service.getChartData(asset, 'D1', 60);

    setTimeout(() => {
      mt5Service.off('chartData', handler);
      resolve(null);
    }, 10000);
  });
}

const mean = pureMean;
const std = pureStd;

// ─── Estilo e Periodicidade (v4) ─────────────────────────────────────────────

/**
 * Verifica se é opção semanal B3 (termina com W+dígito)
 */
export function isWeekly(symbol: string): boolean {
  const clean = symbol.replace(/\d+$/, '');
  return clean.endsWith('W');
}

/**
 * Determina se é americana ou europeia (via option_mode do MT5)
 * Por enquanto retorna 'AMERICANA' como default para americanas, 'EUROPEIA' para europeas
 * O MT5 bridge precisaria enviar option_mode - por ora inferimos do DTE
 */
export function getOptStyle(dte: number): 'AMERICANA' | 'EUROPEIA' {
  // Semanais são americano, mensais são europeo (regra geral B3)
  return dte <= 7 ? 'AMERICANA' : 'EUROPEIA';
}

// ─── SQLite Persistence (v4) ─────────────────────────────────────────────────

/**
 * Save scan to SQLite via Electron IPC.
 * Called from renderer - delegates to main process which has Node.js access.
 */
export async function saveScanToDBIPC(
  asset: string,
  spot: number,
  volData: VolatilityResult | null,
  calls: OptionStrike[],
  puts: OptionStrike[]
): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).electronAPI?.saveOptionsScan) {
    try {
      // Contrato IPC explícito: não enviar o objeto de domínio completo.
      const toIpcOption = (option: OptionStrike) => ({
        symbol: option.symbol,
        strike: option.strike,
        bid: option.bid,
        ask: option.ask,
        spreadPct: option.spreadPct,
        otmPct: option.otmPct,
        dte: option.dte,
        expiration: option.expiration.toISOString(),
        anualizado: option.anualizado,
        pExerc: option.pExerc,
        estilo: option.estilo,
        isWeekly: option.isWeekly,
      });

      await (window as any).electronAPI.saveOptionsScan({
        asset,
        spot,
        volData,
        calls: calls.map(toIpcOption),
        puts: puts.map(toIpcOption),
      });
    } catch (e) {
      console.warn('[Options] IPC save failed:', e);
    }
  }
}

// ─── Utilitários de parsing ───────────────────────────────────────────────────

/**
 * Extrai o strike de um símbolo B3 (genérico para qualquer ativo: PETR4, VALE3, etc.)
 * Extrai os dígitos do final, ignora letras do meio.
 * PETRF480 → 48.00, VALEG420 → 42.00
 */
export const parseStrike = pureParseStrike;

/**
 * Identifica se é CALL ou PUT pela letra do código B3
 * A-H = CALL, J-R = PUT (genérico: usa última letra antes do strike)
 */
export const determineType = pureDetermineType;

/**
 * Calcula DTE (Days To Expiration) a partir do timestamp Unix
 */
export function getDTE(expirationTs: number): number {
  return pureGetDTE(expirationTs, Date.now());
}

/**
 * Anualiza o prêmio em base 365, alinhado ao scanner Python.
 */
export const anualizar = pureAnualizar;

/**
 * Probabilidade de exercício (v4 - modelo log-normal simplificado)
 * P(S_T > K) para calls, P(S_T < K) para puts
 */
export const calcExerciseProb = pureCalcExerciseProb;

// ─── Busca de opções no MT5 ───────────────────────────────────────────────────

/**
 * Obtém lista de ações (equities) disponíveis na B3
 */
export async function getEquities(): Promise<string[]> {
  return new Promise((resolve) => {
    const handler = (data: { equities?: string[] }) => {
      if (data.equities) {
        mt5Service.off('equities', handler);
        resolve(data.equities);
      }
    };

    mt5Service.on('equities', handler);
    mt5Service.getEquities();

    setTimeout(() => {
      mt5Service.off('equities', handler);
      resolve([]);
    }, 10000);
  });
}

// ─── Scan principal ────────────────────────────────────────────────────────────

/**
 * Escaneia opções de um ativo (CALLs e PUTs) com filtros de faixa e DTE
 * v4: volatilidade, score ranking, P.Exerc, estilo, semanal
 */
/**
 * Item de opção como o `spread_api` devolve (snake_case, prêmio já escolhido
 * entre bid/last/ask do lado Python).
 */
interface ScanBackendOption {
  symbol: string;
  exp: string;
  dte: number;
  strike: number;
  bid: number;
  otm_pct: number;
  premio_total: number;
  anual: number;
  roi: number;
  p_exerc?: number;
  spread_pct?: number;
  margem?: number;
  cabe?: boolean;
}

interface ScanBackendResult {
  spot: number;
  calls?: ScanBackendOption[];
  puts?: ScanBackendOption[];
  top?: unknown[];
  scan_id?: number;
}

/**
 * Converte o item do backend para o contrato da UI.
 *
 * O `ask` não vem no payload, mas é DERIVÁVEL sem inventar nada: o Python
 * calcula `spread_pct = (ask - bid) / ask * 100`, então `ask = bid / (1 - s)`.
 * Quando o spread não é utilizável, o ask fica igual ao prêmio em vez de virar
 * zero — zero seria lido como "sem oferta de venda", que é outra afirmação.
 */
function toOptionStrike(o: ScanBackendOption, type: 'CALL' | 'PUT', loteSize: number): OptionStrike {
  const spreadPct = typeof o.spread_pct === 'number' && Number.isFinite(o.spread_pct) ? o.spread_pct : 0;
  const ask = spreadPct > 0 && spreadPct < 100 ? o.bid / (1 - spreadPct / 100) : o.bid;
  const premioTotal = o.bid * loteSize;
  const expDate = /^\d{4}-\d{2}-\d{2}$/.test(o.exp) ? new Date(`${o.exp}T00:00:00`) : new Date();

  return {
    symbol: o.symbol,
    type,
    strike: o.strike,
    bid: o.bid,
    ask,
    dte: o.dte,
    expiration: expDate,
    otmPct: o.otm_pct,
    premioTotal,
    premioPct: o.strike > 0 ? premioTotal / (o.strike * loteSize) : 0,
    anualizado: o.anual,
    roi: o.roi,
    margem: o.margem,
    cabeNoCapital: o.cabe,
    pExerc: o.p_exerc,
    spreadPct,
    estilo: getOptStyle(o.dte),
    isWeekly: isWeekly(o.symbol),
  };
}

export async function scanOptions(
  asset: string,
  config: OptionsConfig = DEFAULT_OPTIONS_CONFIG
): Promise<OptionsScanResult> {
  const { capital, loteSize, rangePct, minAnualizado } = config;

  // Volatilidade (v4) — serviço próprio, independente do scan
  const vol = await getVolatility(asset);

  // O scan roda SERVER-SIDE, no `spread_api` (Python + pacote MetaTrader5), via
  // proxy em /api/options/scan. Não é preferência de estilo: o servidor MCP do
  // terminal MT5 NÃO expõe tool de `symbol_info` (sonda de 2026-08-11), e sem
  // ela não há bid, ask nem vencimento por opção. Este é também o caminho que o
  // agente de IA já usa (`market.scan_options`) — antes desta mudança a aba e o
  // agente enxergavam coisas diferentes.
  let response: Response;
  try {
    response = await fetch('/api/options/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        symbol: asset,
        capital,
        strike_range_pct: rangePct * 100,
        min_annual_pct: minAnualizado * 100,
      }),
    });
  } catch {
    throw new Error('Falha de rede ao chamar o scan de opções.');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || `Falha no scan de opções (HTTP ${response.status}).`);
  }

  const scan = payload.data as ScanBackendResult;
  const spot = typeof scan.spot === 'number' ? scan.spot : 0;
  if (spot <= 0) {
    // Estado honesto: sem spot não há faixa de strikes válida. Nunca seguir com
    // zero, que faria o filtro rejeitar tudo e a aba mostrar "nenhuma opção"
    // como se fosse resultado de mercado.
    throw new Error(`Preço spot não disponível para ${asset}. Verifique se o MetaTrader 5 está aberto e conectado.`);
  }

  const allOptions: OptionStrike[] = [
    ...(scan.calls ?? []).map((o) => toOptionStrike(o, 'CALL', loteSize)),
    ...(scan.puts ?? []).map((o) => toOptionStrike(o, 'PUT', loteSize)),
  ];
  console.log(`[Options] scan server-side: ${allOptions.length} opções para ${asset} (spot ${spot})`);

  // Separar calls e puts
  const calls = allOptions.filter((o) => o.type === 'CALL');
  const puts = allOptions.filter((o) => o.type === 'PUT');

  // v4: Score ranking = Anual%(40%) + Seguranca/P.Exerc(30%) + Liquidez/Spread(30%)
  function calcScore(o: OptionStrike): number {
    const segScore = Math.max(0, 100 - (o.pExerc ?? 0));
    const rawSpread = o.spreadPct ?? 0;
    const liqScore = rawSpread >= 999 ? 50 : Math.max(0, 100 - rawSpread);
    return (o.anualizado * 100) * 0.4 + segScore * 0.3 + liqScore * 0.3;
  }

  const scoreSorted = (opts: OptionStrike[]) =>
    opts.sort((a, b) => calcScore(b) - calcScore(a));

  // v4: Calls exigem bid > 0 E DTE 10-90
  const liquidCalls = calls.filter((c) => c.bid > 0 && c.dte >= 10 && c.dte <= 90);
  const rankedCalls = scoreSorted(liquidCalls).slice(0, 10);

  // Puts: bid > 0 E DTE 10-90 (filtro mínimo de liquidez)
  const liquidPuts = puts.filter((p) => p.bid > 0 && p.dte >= 10 && p.dte <= 90);
  const rankedPuts = scoreSorted(liquidPuts).slice(0, 10);

  // Build topCalls (v4)
  const topCalls: TopOption[] = rankedCalls.slice(0, 3).map((c) => {
    const premio = c.bid * loteSize;
    const custoLote = c.strike * loteSize;
    const nLotes = Math.floor(capital / custoLote);
    const ganhoTotal = premio * nLotes;
    const ganhoPct = (ganhoTotal / capital) * 100;
    return { symbol: c.symbol, strike: c.strike, premio, nLotes, ganhoTotal, ganhoPct, score: calcScore(c) };
  });

  // Build topPuts (v4)
  const topPuts: TopOption[] = rankedPuts.slice(0, 3).map((p) => {
    const premio = p.bid * loteSize;
    const margemLote = p.strike * loteSize;
    const nLotes = Math.floor(capital / margemLote);
    const ganhoTotal = premio * nLotes;
    const ganhoPct = (ganhoTotal / capital) * 100;
    const precoEntrada = p.strike - p.bid;
    return { symbol: p.symbol, strike: p.strike, premio, nLotes, ganhoTotal, ganhoPct, score: calcScore(p), precoEntrada };
  });

  // Top 5 combinadas
  const combined: (CoveredCall | CashSecuredPut)[] = [
    ...rankedCalls.slice(0, 5).map((c) => ({ ...c, tipo: 'COVERED_CALL' as const, custoAcoes: spot * loteSize })),
    ...rankedPuts.slice(0, 5).map((p) => ({ ...p, tipo: 'CASH_SECURED_PUT' as const, margem: p.strike * loteSize, cabeNoCapital: p.strike * loteSize <= capital })),
  ].sort((a, b) => b.anualizado - a.anualizado);

  // Todas calls e puts filtradas
  const topCallsFinal: CoveredCall[] = rankedCalls.map((c) => ({ ...c, tipo: 'COVERED_CALL' as const, custoAcoes: spot * loteSize }));
  const topPutsFinal: CashSecuredPut[] = rankedPuts.map((p) => ({ ...p, tipo: 'CASH_SECURED_PUT' as const, margem: p.strike * loteSize, cabeNoCapital: p.strike * loteSize <= capital }));

  // Alertas
  const alertas: string[] = [];
  const wideSpreads = allOptions.filter((o) => (o.spreadPct ?? 0) > 50);
  if (wideSpreads.length > 0) alertas.push(`${wideSpreads.length} opções com spread > 50%`);
  const lotesPossiveis = Math.floor(capital / (spot * loteSize));
  if (lotesPossiveis === 0) alertas.push(`Capital R$${capital.toLocaleString('pt-BR')} não compra 1 lote`);

  // Persistir no SQLite (v4)
  try {
    await saveScanToDBIPC(asset, spot, vol, rankedCalls, rankedPuts);
  } catch (e) {
    console.warn('[Options] SQLite save failed:', e);
  }

  return {
    spot,
    asset,
    calls: topCallsFinal,
    puts: topPutsFinal,
    topOportunidades: combined,
    alertas,
    timestamp: new Date(),
    volatility: vol ? { dailyStd: vol.dailyStd, annualStd: vol.annualStd, weeklyPct: vol.weeklyPct, mean30d: vol.mean30d, std30d: vol.std30d, lastClose: vol.lastClose, nCandles: vol.nCandles } : undefined,
    topCalls,
    topPuts,
  };
}

// ─── Helpers MT5 ──────────────────────────────────────────────────────────────
