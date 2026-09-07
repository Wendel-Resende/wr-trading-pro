/**
 * PRNG determinístico semeado para os módulos de pesquisa estatística.
 *
 * Por que não `Math.random()`: um teste estatístico cujo resultado muda a
 * cada execução não trava regressão nenhuma, e um p-valor que não pode ser
 * reproduzido não é evidência de nada. O Jesse usa `np.random.default_rng`
 * com seed explícita pelo mesmo motivo; JS não tem equivalente na
 * biblioteca padrão, então trazemos um.
 *
 * Algoritmo: xoshiro128** (Blackman/Vigna), 32 bits, semeado por
 * splitmix32. Escolhido por ser curto, sem dependência, e ter período
 * suficiente (2^128-1) para as dezenas de milhões de sorteios que uma
 * corrida de 2000 simulações sobre alguns milhares de barras consome.
 */

export interface Rng {
  /** Próximo inteiro sem sinal de 32 bits. */
  nextUint32(): number;
  /** Próximo float em [0, 1). */
  nextFloat(): number;
  /** Próximo inteiro em [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
}

/** Seed default — mesmo valor do Jesse, para tornar comparações diretas possíveis. */
export const DEFAULT_SEED = 42;

function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function createRng(seed: number): Rng {
  if (!Number.isFinite(seed)) throw new Error('seed do RNG deve ser um número finito');

  const seeder = splitmix32(Math.trunc(seed));
  let s0 = seeder();
  let s1 = seeder();
  let s2 = seeder();
  let s3 = seeder();
  // xoshiro exige que o estado não seja todo zero.
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;

  const nextUint32 = (): number => {
    const result = (Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0);
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result;
  };

  const nextFloat = (): number => nextUint32() / 4_294_967_296;

  const nextInt = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error('maxExclusive deve ser inteiro positivo');
    }
    return Math.floor(nextFloat() * maxExclusive);
  };

  return { nextUint32, nextFloat, nextInt };
}
