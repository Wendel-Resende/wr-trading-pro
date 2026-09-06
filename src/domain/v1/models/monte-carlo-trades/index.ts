/**
 * Monte Carlo por embaralhamento da ORDEM dos trades — porte de
 * `jesse/research/monte_carlo/monte_carlo_trades.py`, adaptado ao que o
 * motor da WR de fato permite afirmar.
 *
 * O motor da WR é ADITIVO: `netPnl` é valor absoluto por trade, com
 * `lotSize` fixo. Logo retorno total, Sharpe, win rate e desvio-padrão são
 * INVARIANTES à ordem — embaralhar não muda nenhum deles. O que varia é o
 * caminho: `maxDrawdown` e, por consequência, o Calmar.
 *
 * O Jesse consegue variar o retorno também porque compõe (o tamanho da
 * posição sai do saldo corrente). Replicar isso exigiria mudar o motor
 * para sizing proporcional ao saldo — decisão de modelagem, fora deste
 * escopo.
 *
 * Por isso o resultado separa `invariants` de `pathDependent` em vez de
 * publicar percentis idênticos em três casas: um percentil degenerado
 * pareceria informação sem ser.
 *
 * O que isto responde: quanto do drawdown observado é sorte de sequência.
 * Duas estratégias com o mesmo lucro e o mesmo Sharpe podem ter drawdowns
 * muito diferentes dependendo de em que ordem os perdedores apareceram —
 * e é o drawdown que estoura conta pequena.
 */
import type { BacktestTrade } from '../backtest-run';
import { computeMetrics } from '../backtest-run/metrics';
import { createRng, DEFAULT_SEED } from '../research-rng';

export const DEFAULT_N_SCENARIOS = 1000;

export interface MonteCarloInput {
  readonly trades: readonly BacktestTrade[];
  readonly periodsPerYear: number;
  /** Saldo inicial, usado para expressar o drawdown como fração da conta. */
  readonly startingBalance: number;
  readonly nScenarios?: number;
  readonly seed?: number;
}

export interface PercentileBand {
  readonly p5: number;
  readonly p50: number;
  readonly p95: number;
  /** IC de 90% = [p5, p95]; IC de 95% = [p2_5, p97_5]. Mesmos cortes do Jesse. */
  readonly ci90: readonly [number, number];
  readonly ci95: readonly [number, number];
}

export interface MonteCarloInvariants {
  /** Sempre `true`: existe para a leitura não confundir ausência de percentil com omissão. */
  readonly orderInvariant: true;
  readonly totalNetPnl: number;
  readonly totalNetReturn: number;
  readonly meanReturn: number;
  readonly sharpe: number;
  readonly winRate: number;
}

export interface MonteCarloPathDependent {
  /** Drawdown máximo em unidades monetárias (negativo ou zero). */
  readonly maxDrawdown: PercentileBand;
  /** Drawdown máximo como fração de `startingBalance`. */
  readonly maxDrawdownPct: PercentileBand;
  /** Retorno total sobre |drawdown máximo|. Zero quando não houve drawdown. */
  readonly calmar: PercentileBand;
}

export interface MonteCarloResult {
  readonly nScenarios: number;
  readonly seed: number;
  readonly nTrades: number;
  /** Métricas do conjunto NÃO embaralhado, para comparação. */
  readonly original: { readonly maxDrawdown: number; readonly maxDrawdownPct: number; readonly calmar: number };
  readonly invariants: MonteCarloInvariants;
  readonly pathDependent: MonteCarloPathDependent;
}

/** Percentil por interpolação linear sobre a amostra ordenada. */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function band(values: number[]): PercentileBand {
  const sorted = [...values].sort((a, b) => a - b);
  return Object.freeze({
    p5: percentile(sorted, 0.05),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    ci90: Object.freeze([percentile(sorted, 0.05), percentile(sorted, 0.95)]) as readonly [number, number],
    ci95: Object.freeze([percentile(sorted, 0.025), percentile(sorted, 0.975)]) as readonly [number, number],
  });
}

/** Fisher-Yates com o PRNG semeado — nunca `Math.random()`. */
function shuffled(trades: readonly BacktestTrade[], rng: ReturnType<typeof createRng>): BacktestTrade[] {
  const copy = [...trades];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rng.nextInt(i + 1);
    const swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  return copy;
}

function pathMetricsOf(
  trades: readonly BacktestTrade[],
  periodsPerYear: number,
  startingBalance: number,
): { maxDrawdown: number; maxDrawdownPct: number; calmar: number } {
  const metrics = computeMetrics(trades, periodsPerYear);
  const maxDrawdown = metrics.maxDrawdown;
  const maxDrawdownPct = startingBalance > 0 ? maxDrawdown / startingBalance : 0;
  const absDrawdown = Math.abs(maxDrawdown);
  const calmar = absDrawdown > 0 ? metrics.totalNetPnl / absDrawdown : 0;
  return { maxDrawdown, maxDrawdownPct, calmar };
}

export function monteCarloTrades(input: MonteCarloInput): MonteCarloResult {
  const nScenariosRequested = input.nScenarios ?? DEFAULT_N_SCENARIOS;
  const seed = input.seed ?? DEFAULT_SEED;
  if (nScenariosRequested < 1) throw new Error('nScenarios deve ser no mínimo 1');
  if (input.startingBalance <= 0) throw new Error('startingBalance deve ser positivo');

  const baseMetrics = computeMetrics(input.trades, input.periodsPerYear);
  const original = pathMetricsOf(input.trades, input.periodsPerYear, input.startingBalance);

  const invariants: MonteCarloInvariants = Object.freeze({
    orderInvariant: true as const,
    totalNetPnl: baseMetrics.totalNetPnl,
    totalNetReturn: baseMetrics.totalNetReturn,
    meanReturn: baseMetrics.meanReturn,
    sharpe: baseMetrics.sharpe,
    winRate: baseMetrics.winRate,
  });

  // Sem trades não há sequência a embaralhar: devolver bandas zeradas em
  // vez de simular cenários vazios, que dariam a impressão de resultado.
  if (input.trades.length === 0) {
    const zero = band([0]);
    return Object.freeze({
      nScenarios: 0,
      seed,
      nTrades: 0,
      original,
      invariants,
      pathDependent: Object.freeze({ maxDrawdown: zero, maxDrawdownPct: zero, calmar: zero }),
    });
  }

  const rng = createRng(seed);
  const drawdowns: number[] = [];
  const drawdownPcts: number[] = [];
  const calmars: number[] = [];

  for (let scenario = 0; scenario < nScenariosRequested; scenario += 1) {
    const path = pathMetricsOf(shuffled(input.trades, rng), input.periodsPerYear, input.startingBalance);
    drawdowns.push(path.maxDrawdown);
    drawdownPcts.push(path.maxDrawdownPct);
    calmars.push(path.calmar);
  }

  return Object.freeze({
    nScenarios: nScenariosRequested,
    seed,
    nTrades: input.trades.length,
    original,
    invariants,
    pathDependent: Object.freeze({
      maxDrawdown: band(drawdowns),
      maxDrawdownPct: band(drawdownPcts),
      calmar: band(calmars),
    }),
  });
}
