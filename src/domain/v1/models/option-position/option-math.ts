/**
 * Fase 6 — Consolidação. Núcleo puro de cálculo de opções B3, extraído de
 * `src/services/optionsService.ts` (que passa a delegar para estas mesmas
 * funções em vez de reimplementá-las). Sem I/O, sem `mt5Service`, sem
 * `process.env`: recebe apenas primitivos e retorna primitivos.
 */

const CALL_LETTERS = 'ABCDEFGH';
const PUT_LETTERS = 'JKLMNOPQR';

export function mean(arr: readonly number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function std(arr: readonly number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const squaredDiffs = arr.map((v) => (v - m) ** 2);
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / (arr.length - 1));
}

/** Extrai o strike de um símbolo B3 (genérico: PETRF480 -> 48.00). */
export function parseStrike(symbol: string): number {
  const name = symbol.replace('.BVSP', '').replace('.B3', '');
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

/** A-H = CALL, J-R = PUT (letra do código B3 antes do strike). */
export function determineType(symbol: string): 'CALL' | 'PUT' | 'UNKNOWN' {
  const base = symbol.replace(/\d+$/, '');
  const letter = base.slice(-1).toUpperCase();
  if (CALL_LETTERS.includes(letter)) return 'CALL';
  if (PUT_LETTERS.includes(letter)) return 'PUT';
  return 'UNKNOWN';
}

/** DTE (Days To Expiration) a partir de um timestamp Unix de expiração e um "agora" explícito. */
export function getDTE(expirationTs: number, nowMs: number): number {
  if (!expirationTs) return 999;
  const expDate = new Date(expirationTs * 1000);
  return Math.floor((expDate.getTime() - nowMs) / (1000 * 60 * 60 * 24));
}

/** Anualiza o prêmio em base 365. */
export function anualizar(premioPorAcao: number, strike: number, dte: number): number {
  if (dte <= 0 || strike <= 0) return 0;
  return (premioPorAcao / strike) * (365 / dte);
}

/** Aproximação da CDF da normal padrão (Abramowitz & Stegun 7.1.26). */
export function normCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);

  return 0.5 * (1 + sign * y);
}

/** P(S_T > K) para CALL, P(S_T < K) para PUT — modelo log-normal simplificado. */
export function calcExerciseProb(
  spot: number,
  strike: number,
  dte: number,
  dailyStd: number,
  optType: 'CALL' | 'PUT',
): number {
  if (dte <= 0 || dailyStd <= 0) return 0;

  const sigma = dailyStd * Math.sqrt(dte);
  if (sigma <= 0) return 0;

  const d = Math.log(strike / spot) / sigma;

  if (optType === 'CALL') {
    return Math.max(0, Math.min(1, 1 - normCdf(d))) * 100;
  }
  return Math.max(0, Math.min(1, normCdf(d))) * 100;
}
