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

/**
 * Piso de trades. Abaixo dele o embaralhamento não produz banda
 * informativa: com 1 trade não existe ordem alternativa e todos os
 * cenários são idênticos (é o que o teste
 * `monteCarloWithSingleTradeIsDegenerate` prova); com 2 ou 3 há tão poucas
 * permutações distintas que os percentis 5/50/95 caem sobre o mesmo punhado
 * de valores — uma banda degenerada que, no JSON, é indistinguível de uma
 * banda real.
 *
 * Mesma forma do `MIN_OBSERVATIONS` do teste de significância, do outro
 * lado desta mesma leva: abaixo do piso a plataforma diz
 * `insufficientData: true` e devolve `null`, em vez de números com a
 * aparência de um intervalo de confiança.
 *
 * Os `invariants` NÃO dependem deste piso — são exatos com qualquer número
 * de trades, inclusive um — e continuam sendo publicados.
 */
export const MIN_TRADES = 10;

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
  /**
   * Quantos cenários ficaram FORA dos percentis por não terem valor
   * definido — hoje só o Calmar de um cenário sem drawdown algum. Zero nas
   * demais bandas. Existe para o consumidor saber sobre quantos cenários a
   * banda de fato fala.
   */
  readonly excludedCount: number;
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
  /**
   * Drawdown máximo em unidades monetárias (negativo ou zero).
   * `null` quando `insufficientData`.
   */
  readonly maxDrawdown: PercentileBand | null;
  /** Drawdown máximo como fração de `startingBalance`. `null` quando `insufficientData`. */
  readonly maxDrawdownPct: PercentileBand | null;
  /**
   * Retorno total sobre |drawdown máximo|.
   *
   * `null` quando `insufficientData` OU quando TODOS os cenários ficaram
   * sem drawdown — nesse caso o Calmar não é zero, é indefinido (divisão
   * por zero). Publicar zero faria o melhor caso possível ordenar junto do
   * pior dentro de `band()`. Quando só parte dos cenários é indefinida,
   * eles saem dos percentis e aparecem em `excludedCount`.
   */
  readonly calmar: PercentileBand | null;
}

export interface MonteCarloResult {
  readonly nScenarios: number;
  readonly seed: number;
  readonly nTrades: number;
  /** `true` quando `nTrades < MIN_TRADES` — ver docblock de `MIN_TRADES`. */
  readonly insufficientData: boolean;
  /** Métricas do conjunto NÃO embaralhado, para comparação. */
  readonly original: {
    readonly maxDrawdown: number;
    readonly maxDrawdownPct: number;
    /** `null` quando não houve drawdown algum — indefinido, não zero. */
    readonly calmar: number | null;
  };
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

/**
 * Percentis sobre os cenários com valor DEFINIDO. Os `null` (Calmar de
 * cenário sem drawdown) são excluídos do cálculo e contados em
 * `excludedCount` — tratá-los como zero faria o melhor caso ordenar junto
 * do pior. Se todos forem `null`, não há banda: devolve `null`.
 */
function band(values: readonly (number | null)[]): PercentileBand | null {
  const defined = values.filter((value): value is number => value !== null);
  const excludedCount = values.length - defined.length;
  if (defined.length === 0) return null;
  const sorted = [...defined].sort((a, b) => a - b);
  return Object.freeze({
    p5: percentile(sorted, 0.05),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    ci90: Object.freeze([percentile(sorted, 0.05), percentile(sorted, 0.95)]) as readonly [number, number],
    ci95: Object.freeze([percentile(sorted, 0.025), percentile(sorted, 0.975)]) as readonly [number, number],
    excludedCount,
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
): { maxDrawdown: number; maxDrawdownPct: number; calmar: number | null } {
  const metrics = computeMetrics(trades, periodsPerYear);
  const maxDrawdown = metrics.maxDrawdown;
  const maxDrawdownPct = startingBalance > 0 ? maxDrawdown / startingBalance : 0;
  const absDrawdown = Math.abs(maxDrawdown);
  // Sem drawdown algum o Calmar é INDEFINIDO, não zero. Zero é o pior valor
  // possível da métrica; devolvê-lo aqui faria o melhor cenário possível
  // ordenar ao lado do pior dentro de `band()`.
  const calmar = absDrawdown > 0 ? metrics.totalNetPnl / absDrawdown : null;
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

  // Abaixo do piso não há banda a publicar — ver docblock de `MIN_TRADES`.
  // Os invariantes saem mesmo assim: são exatos com qualquer número de
  // trades, inclusive zero ou um.
  if (input.trades.length < MIN_TRADES) {
    return Object.freeze({
      nScenarios: 0,
      seed,
      nTrades: input.trades.length,
      insufficientData: true,
      original,
      invariants,
      pathDependent: Object.freeze({ maxDrawdown: null, maxDrawdownPct: null, calmar: null }),
    });
  }

  const rng = createRng(seed);
  const drawdowns: number[] = [];
  const drawdownPcts: number[] = [];
  const calmars: (number | null)[] = [];

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
    insufficientData: false,
    original,
    invariants,
    pathDependent: Object.freeze({
      maxDrawdown: band(drawdowns),
      maxDrawdownPct: band(drawdownPcts),
      calmar: band(calmars),
    }),
  });
}
