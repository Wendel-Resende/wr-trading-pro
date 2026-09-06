/**
 * Bootstrap estacionário (Politis & Romano) — porte de
 * `jesse/research/rule_significance_testing/bootstrap.py`.
 *
 * A série é centrada em zero ANTES de reamostrar: é isso que materializa a
 * hipótese nula "o retorno esperado da regra não é positivo". Reamostrar a
 * série crua testaria outra coisa.
 *
 * Os blocos têm comprimento geométrico (a cada posição, probabilidade
 * `1/meanBlockLength` de iniciar um bloco novo em um índice sorteado
 * uniformemente; entre reinícios o índice avança, com wrap circular). Isso
 * preserva a dependência serial local — um bootstrap i.i.d. a destruiria e
 * subestimaria a variância do nulo, produzindo p-valores otimistas demais.
 */
import { createRng } from '../research-rng';

/** Comprimento médio de bloco, em barras. Mesmo default do Jesse. */
export const DEFAULT_MEAN_BLOCK_LENGTH = 10;

export function stationaryBootstrap(
  returns: readonly number[],
  observedMean: number,
  nSimulations: number,
  seed: number,
  meanBlockLength: number,
): Float64Array {
  if (meanBlockLength < 1) throw new Error('meanBlockLength deve ser no mínimo 1');
  if (nSimulations < 0) throw new Error('nSimulations não pode ser negativo');

  const n = returns.length;
  if (n === 0) return new Float64Array(0);

  const centered = new Float64Array(n);
  for (let i = 0; i < n; i += 1) centered[i] = returns[i] - observedMean;

  const rng = createRng(seed);
  const restartProbability = 1 / meanBlockLength;
  const simulated = new Float64Array(nSimulations);

  for (let sim = 0; sim < nSimulations; sim += 1) {
    let sum = 0;
    // A primeira posição é sempre um reinício de bloco.
    let sourceIndex = rng.nextInt(n);
    for (let position = 0; position < n; position += 1) {
      if (position > 0) {
        if (rng.nextFloat() < restartProbability) {
          sourceIndex = rng.nextInt(n);
        } else {
          sourceIndex = (sourceIndex + 1) % n;
        }
      }
      sum += centered[sourceIndex];
    }
    simulated[sim] = sum / n;
  }

  return simulated;
}
