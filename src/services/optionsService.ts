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

// ─── Constantes B3 ─────────────────────────────────────────────────────────────

// B3 month letters (CORRIGIDO: A-H=CALL, J-R=PUT — igual dashboard de referência)
const CALL_LETTERS = 'ABCDEFGH';
const PUT_LETTERS = 'JKLMNOPQR';
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

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const squaredDiffs = arr.map((v) => (v - m) ** 2);
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / (arr.length - 1));
}

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
export function parseStrike(symbol: string): number {
  // Remove suffixes like .BVSP, .B3
  const name = symbol.replace('.BVSP', '').replace('.B3', '');
  // Extract digits from end
  let digits = '';
  for (let i = name.length - 1; i >= 0; i--) {
    const ch = name[i];
    if (/\d/.test(ch)) {
      digits = ch + digits;
    } else {
      break;
    }
  }
  if (!digits) return 0;
  const val = parseInt(digits, 10);
  return val >= 1000 ? val / 100 : val / 10;
}

/**
 * Identifica se é CALL ou PUT pela letra do código B3
 * A-H = CALL, J-R = PUT (genérico: usa última letra antes do strike)
 */
export function determineType(symbol: string): 'CALL' | 'PUT' | 'UNKNOWN' {
  const base = symbol.replace(/\d+$/, ''); // strip trailing digits
  const letter = base.slice(-1).toUpperCase();
  if (CALL_LETTERS.includes(letter)) return 'CALL';
  if (PUT_LETTERS.includes(letter)) return 'PUT';
  return 'UNKNOWN';
}

/**
 * Calcula DTE (Days To Expiration) a partir do timestamp Unix
 */
export function getDTE(expirationTs: number): number {
  if (!expirationTs) return 999;
  const expDate = new Date(expirationTs * 1000);
  const now = new Date();
  return Math.floor((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Anualiza o prêmio em base 365, alinhado ao scanner Python.
 */
export function anualizar(premioPorAcao: number, strike: number, dte: number): number {
  if (dte <= 0 || strike <= 0) return 0;
  return (premioPorAcao / strike) * (365 / dte);
}

/**
 * Probabilidade de exercício (v4 - modelo log-normal simplificado)
 * P(S_T > K) para calls, P(S_T < K) para puts
 */
export function calcExerciseProb(
  spot: number,
  strike: number,
  dte: number,
  dailyStd: number,
  optType: 'CALL' | 'PUT'
): number {
  if (dte <= 0 || dailyStd <= 0) return 0;

  const sigma = dailyStd * Math.sqrt(dte);
  if (sigma <= 0) return 0;

  const d = Math.log(strike / spot) / sigma;

  if (optType === 'CALL') {
    // P(spot_T > strike) = 1 - Phi(d)
    return Math.max(0, Math.min(1, 1 - normCdf(d))) * 100;
  } else {
    // P(spot_T < strike) = Phi(d)
    return Math.max(0, Math.min(1, normCdf(d))) * 100;
  }
}

/**
 * Aproxima a CDF da distribuição normal padrão
 */
function normCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1 + sign * y);
}

// ─── Busca de opções no MT5 ───────────────────────────────────────────────────

/**
 * Obtém todos os símbolos de opções de um ativo base no MT5
 * Ex: PETR4 → todas as opções PETR (PETRA276, PETRB400, etc.)
 */
export async function getOptionSymbols(asset: string): Promise<string[]> {
  return new Promise((resolve) => {
    const symbols: string[] = [];

    const handler = (data: { symbols?: string[] }) => {
      if (data.symbols && data.symbols.length > 0) {
        const assetBase = asset.replace(/\d+$/, '');
        // Filter by B3 option code shape. Do not block month letters like F/M/W,
        // because they can be valid option codes depending on the symbol.
        const filtered = data.symbols.filter((s: string) => {
          const namePart = s.slice(assetBase.length);
          if (!namePart) return false;
          if (!s.startsWith(assetBase)) return false;
          return determineType(s) !== 'UNKNOWN' && parseStrike(s) > 0;
        });
        if (filtered.length > 0) {
          console.log(`[Options] GET_SYMBOLS: ${data.symbols.length} total, ${filtered.length} matched '${assetBase}'`);
          symbols.push(...filtered);
          mt5Service.off('symbols', handler);
          resolve(symbols);
        }
      }
    };

    mt5Service.on('symbols', handler);

    // Use group search like the Python script (more reliable than path prefix)
    mt5Service.send({ type: 'GET_SYMBOLS', data: { group: asset.replace(/\d+$/, '') } });

    setTimeout(() => {
      mt5Service.off('symbols', handler);
      console.log(`[Options] GET_SYMBOLS timeout — resolved with ${symbols.length} symbols`);
      resolve(symbols);
    }, 10000);
  });
}

/**
 * Seleciona símbolo no MT5 (necessário antes de consultar)
 */
function selectSymbol(symbol: string): void {
  mt5Service.send({ type: 'SELECT_SYMBOL', data: { symbol } });
}

/**
 * Remove símbolo do Market Watch (libera memória RAM do MT5)
 */
function unselectSymbol(symbol: string): void {
  mt5Service.send({ type: 'UNSELECT_SYMBOL', data: { symbol } });
}

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
export async function scanOptions(
  asset: string,
  config: OptionsConfig = DEFAULT_OPTIONS_CONFIG
): Promise<OptionsScanResult> {
  const { capital, loteSize, rangePct, minAnualizado } = config;

  // Obter preço spot do ativo
  const spotInfo = await getSpotPrice(asset);
  const spot = spotInfo.last > 0 ? spotInfo.last : spotInfo.ask;

  // Guard: se spot=0, o filtro de faixa rejeita tudo — abortar
  if (spot <= 0) {
    throw new Error(`Preço spot não disponível para ${asset} (timeout do MT5). Verifique a conexão.`);
  }

  // Obter volatilidade (v4)
  const vol = await getVolatility(asset);
  const dailyStd = vol?.dailyStd ?? 0;

  // Buscar símbolos de opções
  const optionSymbols = await getOptionSymbols(asset);
  console.log(`[Options] scanOptions: found ${optionSymbols.length} option symbols for ${asset}`);

  // Selecionar cada opção no MT5 (para poder consultar dados)
  const selectedSymbols: string[] = [];
  optionSymbols.forEach((sym) => {
    selectSymbol(sym);
    selectedSymbols.push(sym);
  });

  // Coletar dados de cada opção
  const allOptions: OptionStrike[] = [];

  for (const sym of optionSymbols) {
    const info = await getSymbolInfo(sym);
    if (!info) continue;

    const strike = parseStrike(sym);
    if (strike <= 0) continue;

    const tipo = determineType(sym);
    if (tipo === 'UNKNOWN') continue;

    const dte = getDTE(info.expiration_time ?? 0);
    if (dte < 5) continue;

    // Filtro de faixa ±rangePct
    if (!(spot * (1 - rangePct) <= strike && strike <= spot * (1 + rangePct))) continue;

    const bid = info.bid ?? 0;
    const ask = info.ask ?? 0;
    const last = info.last ?? 0;
    const premium = bid > 0 ? bid : (last > 0 ? last : (ask > 0 ? ask : 0));

    if (premium <= 0) continue;

    const expDate = info.expiration_time ? new Date(info.expiration_time * 1000) : new Date();
    const premioTotal = premium * loteSize;
    const premioPct = premioTotal / (strike * loteSize);
    const anu = anualizar(premium, strike, dte);
    const isOtm = tipo === 'CALL' ? strike > spot : strike < spot;
    if (!isOtm) continue;

    const otmPct = tipo === 'CALL'
      ? ((strike - spot) / spot) * 100
      : ((spot - strike) / spot) * 100;
    const roi = (premioTotal / capital) * 100;

    // v4: spread %, P.Exerc, estilo, semanal
    const spreadPct = ask > 0 && bid > 0 ? ((ask - bid) / ask) * 100 : (ask > 0 ? 0 : 999);
    const pExerc = calcExerciseProb(spot, strike, dte, dailyStd, tipo);
    const estilo = getOptStyle(dte);
    const isWk = isWeekly(sym);

    allOptions.push({
      symbol: sym,
      type: tipo,
      strike,
      bid,
      ask,
      dte,
      expiration: expDate,
      otmPct,
      premioTotal,
      premioPct,
      anualizado: anu,
      roi,
      spreadPct,
      pExerc,
      estilo,
      isWeekly: isWk,
    });
  }

  // Limpar symbols não usados
  const processedSymbols = new Set(allOptions.map((o) => o.symbol));
  selectedSymbols.forEach((sym) => {
    if (!processedSymbols.has(sym)) unselectSymbol(sym);
  });

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

export async function getSpotPrice(asset: string): Promise<{ last: number; ask: number; bid: number }> {
  return new Promise((resolve) => {
    const handler = (data: { symbol: string; last?: number; ask?: number; bid?: number }) => {
      if (data.symbol === asset) {
        mt5Service.off('tick', handler);
        resolve({ last: data.last ?? 0, ask: data.ask ?? 0, bid: data.bid ?? 0 });
      }
    };

    mt5Service.on('tick', handler);
    mt5Service.send({ type: 'SUBSCRIBE_TICKS', data: { symbol: asset } });

    setTimeout(() => {
      mt5Service.off('tick', handler);
      resolve({ last: 0, ask: 0, bid: 0 });
    }, 15000);
  });
}

interface SymbolInfo {
  bid?: number;
  ask?: number;
  last?: number;
  expiration_time?: number;
}

async function getSymbolInfo(symbol: string): Promise<SymbolInfo | null> {
  return new Promise((resolve) => {
    const handler = (data: { symbol: string; bid?: number; ask?: number; last?: number; expiration_time?: number }) => {
      if (data.symbol === symbol) {
        mt5Service.off('symbolInfo', handler);
        resolve(data);
      }
    };

    mt5Service.on('symbolInfo', handler);
    mt5Service.send({ type: 'GET_SYMBOL_INFO', data: { symbol } });

    setTimeout(() => {
      mt5Service.off('symbolInfo', handler);
      resolve(null);
    }, 5000);
  });
}
