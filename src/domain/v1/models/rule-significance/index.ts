/**
 * Teste de significância de regra — porte de
 * `jesse/research/rule_significance_testing/`.
 *
 * H0: o retorno esperado da barra seguinte ao sinal NÃO é positivo.
 *
 * O Jesse precisa rodar um backtest só-de-sinal para coletar as entradas
 * porque lá o sinal só existe dentro do ciclo de vida da estratégia. Na WR
 * os sinais já são dado de primeira classe (`BacktestSignalInput`), então
 * a Fase 1 do Jesse não é portada: começamos direto na Fase 2.
 *
 * O que o teste responde: se o retorno médio da barra seguinte a este
 * conjunto de sinais poderia plausivelmente vir do acaso. Um p-valor alto
 * NÃO prova que a regra é inútil — prova que esta amostra não sustenta a
 * afirmação de que ela funciona.
 */
import type { BacktestBar, BacktestSignalInput } from '../backtest-run';
import { DEFAULT_SEED } from '../research-rng';
import { DEFAULT_MEAN_BLOCK_LENGTH, stationaryBootstrap } from './bootstrap';

export { DEFAULT_MEAN_BLOCK_LENGTH, stationaryBootstrap } from './bootstrap';

/**
 * Piso de observações — mesmo valor do Jesse (`MIN_OBSERVATIONS = 30`).
 * Abaixo disso não devolvemos p-valor: um número calculado sobre uma dúzia
 * de sinais tem a aparência de evidência sem a substância. Mesma regra do
 * "pilar sem dado não aprova e não reprova" da Saúde Financeira.
 */
export const MIN_OBSERVATIONS = 30;

export const DEFAULT_N_SIMULATIONS = 2000;

export interface RuleSignificanceInput {
  readonly bars: readonly BacktestBar[];
  readonly signals: readonly BacktestSignalInput[];
  readonly nSimulations?: number;
  readonly seed?: number;
  readonly meanBlockLength?: number;
}

export interface RuleSignificanceResult {
  /** Média do log-retorno da barra seguinte, com o sinal da direção aplicado. */
  readonly observedMean: number;
  /** `observedMean` anualizado pelo tempo de calendário efetivamente decorrido. */
  readonly annualizedReturn: number;
  /** `null` quando `insufficientData` — nunca um número calculado sobre amostra pequena demais. */
  readonly pValue: number | null;
  readonly nObservations: number;
  readonly nSimulations: number;
  /** O valor usado, não o default — um p-valor não significa nada sem ele. */
  readonly meanBlockLength: number;
  readonly insufficientData: boolean;
}

export interface NextBarReturns {
  readonly returns: number[];
  readonly firstTimeMs: number;
  readonly lastTimeMs: number;
}

/**
 * Log-retorno da barra seguinte a cada sinal, com o sinal da direção
 * aplicado (SELL inverte). Descarta o que não é mensurável em vez de
 * fabricar zero:
 *  - `HOLD` não é aposta;
 *  - sinal cuja barra não existe no conjunto;
 *  - sinal na última barra (não há sucessora);
 *  - preços não positivos (log indefinido).
 */
export function nextBarLogReturns(
  bars: readonly BacktestBar[],
  signals: readonly BacktestSignalInput[],
): NextBarReturns {
  const sorted = [...bars].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const indexByTime = new Map<string, number>();
  sorted.forEach((bar, i) => indexByTime.set(bar.time, i));

  const returns: number[] = [];
  let firstTimeMs = Number.POSITIVE_INFINITY;
  let lastTimeMs = Number.NEGATIVE_INFINITY;

  for (const signal of signals) {
    if (signal.direction === 'HOLD') continue;
    const index = indexByTime.get(signal.barTime);
    if (index === undefined) continue;
    const current = sorted[index];
    const next = sorted[index + 1];
    if (next === undefined) continue;
    if (current.close <= 0 || next.close <= 0) continue;

    const logReturn = Math.log(next.close / current.close);
    if (!Number.isFinite(logReturn)) continue;

    returns.push(signal.direction === 'BUY' ? logReturn : -logReturn);
    const currentMs = Date.parse(current.time);
    const nextMs = Date.parse(next.time);
    if (currentMs < firstTimeMs) firstTimeMs = currentMs;
    if (nextMs > lastTimeMs) lastTimeMs = nextMs;
  }

  return {
    returns,
    firstTimeMs: Number.isFinite(firstTimeMs) ? firstTimeMs : 0,
    lastTimeMs: Number.isFinite(lastTimeMs) ? lastTimeMs : 0,
  };
}

/**
 * Anualiza sobre o tempo de calendário REALMENTE decorrido, sem inferir
 * sessões nem assumir um número de barras por ano — porte de
 * `_elapsed_annualization_factor`. Assumir 252 pregões aqui inventaria
 * dado sobre a frequência das barras que não temos.
 */
function elapsedAnnualizationFactor(observationCount: number, startMs: number, endMs: number): number {
  const elapsedMs = endMs - startMs;
  if (elapsedMs <= 0) return 0;
  return (observationCount * 365 * 86_400_000) / elapsedMs;
}

export function ruleSignificanceTest(input: RuleSignificanceInput): RuleSignificanceResult {
  const nSimulations = input.nSimulations ?? DEFAULT_N_SIMULATIONS;
  const seed = input.seed ?? DEFAULT_SEED;
  const meanBlockLength = input.meanBlockLength ?? DEFAULT_MEAN_BLOCK_LENGTH;

  if (nSimulations < 1) throw new Error('nSimulations deve ser no mínimo 1');
  if (meanBlockLength < 1) throw new Error('meanBlockLength deve ser no mínimo 1');

  const { returns, firstTimeMs, lastTimeMs } = nextBarLogReturns(input.bars, input.signals);
  const nObservations = returns.length;
  const observedMean = nObservations > 0 ? returns.reduce((sum, r) => sum + r, 0) / nObservations : 0;
  const annualizedReturn = observedMean * elapsedAnnualizationFactor(nObservations, firstTimeMs, lastTimeMs);

  if (nObservations < MIN_OBSERVATIONS) {
    return Object.freeze({
      observedMean,
      annualizedReturn,
      pValue: null,
      nObservations,
      nSimulations: 0,
      meanBlockLength,
      insufficientData: true,
    });
  }

  const simulated = stationaryBootstrap(returns, observedMean, nSimulations, seed, meanBlockLength);
  let atLeastAsExtreme = 0;
  for (let i = 0; i < simulated.length; i += 1) {
    if (simulated[i] >= observedMean) atLeastAsExtreme += 1;
  }

  return Object.freeze({
    observedMean,
    annualizedReturn,
    pValue: atLeastAsExtreme / simulated.length,
    nObservations,
    nSimulations: simulated.length,
    meanBlockLength,
    insufficientData: false,
  });
}
