/**
 * Fase 6 — Consolidação. `OptionPosition` governada (repository tipado),
 * distinta do estado volátil de scan (`OptionStrike`/`OptionsScanResult` em
 * `src/types/options.ts`, inalterados). Puro e determinístico: sem I/O, sem
 * `mt5Service`, sem `process.env`.
 */

import { calcExerciseProb, getDTE } from './option-math';

export const OPTION_POSITION_VERSION = 'option-position/v1' as const;

export type OptionKind = 'CALL' | 'PUT';
export type OptionSide = 'LONG' | 'SHORT';
export type OptionPositionSource = 'MT5' | 'MANUAL' | 'REPLAY';

export interface OptionPosition {
  readonly id: string;
  readonly instrumentId: string;
  readonly kind: OptionKind;
  /** Strike em centavos (inteiro), evita ponto flutuante. */
  readonly strike: number;
  readonly expiration: string;
  readonly side: OptionSide;
  readonly quantity: number;
  readonly source: OptionPositionSource;
  readonly knowledgeTime: string;
  readonly createdAt: string;
}

/** Payload usado para persistir uma nova `OptionPosition` (identidade sempre gerada no servidor). */
export interface OptionPositionSubmission {
  readonly instrumentId: string;
  readonly kind: OptionKind;
  readonly strike: number;
  readonly expiration: string;
  readonly side: OptionSide;
  readonly quantity: number;
  readonly source: OptionPositionSource;
  readonly knowledgeTime: string;
}

export type OptionPositionRejectionReason =
  | 'INVALID_STRIKE'
  | 'INVALID_QUANTITY'
  | 'EXPIRED_BEFORE_KNOWLEDGE_TIME';

export type ValidateOptionPositionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: OptionPositionRejectionReason };

/**
 * Núcleo puro de regras de opção (strike/quantity/expiration vs
 * knowledgeTime). Não persiste nada; apenas decide se a submissão é válida.
 */
export function validateOptionPositionSubmission(input: OptionPositionSubmission): ValidateOptionPositionResult {
  if (!Number.isInteger(input.strike) || input.strike <= 0) {
    return { ok: false, reason: 'INVALID_STRIKE' };
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return { ok: false, reason: 'INVALID_QUANTITY' };
  }
  const expirationMs = new Date(input.expiration).getTime();
  const knowledgeTimeMs = new Date(input.knowledgeTime).getTime();
  if (expirationMs <= knowledgeTimeMs) {
    return { ok: false, reason: 'EXPIRED_BEFORE_KNOWLEDGE_TIME' };
  }
  return { ok: true };
}

/** Bar mínimo necessário para o replay determinístico point-in-time (subconjunto de `VersionedMarketBar`). */
export interface OptionReplayBar {
  readonly openedAt: string;
  readonly closeRaw: bigint;
  readonly priceScalePow: number;
}

export interface OptionReplayResult {
  readonly instrumentId: string;
  readonly decisionTime: string;
  readonly knowledgeTime: string;
  readonly spot: number;
  readonly dte: number;
  readonly moneyness: number;
  readonly exerciseProbPct: number;
  readonly barsUsed: number;
}

/**
 * Replay determinístico: dado um conjunto de `MarketBar` point-in-time
 * (já filtradas por `knowledgeTime <= decisionTime` na camada de
 * repository, Fase 2) e uma posição de opção, calcula moneyness e
 * probabilidade de exercício sem tocar em MT5/API Python ao vivo. Mesma
 * entrada -> mesma saída.
 */
export function replayOptionPosition(
  position: Pick<OptionPosition, 'instrumentId' | 'kind' | 'strike' | 'expiration'>,
  bars: readonly OptionReplayBar[],
  decisionTime: string,
  knowledgeTime: string,
): OptionReplayResult {
  const sorted = [...bars].sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime());
  const last = sorted[sorted.length - 1];
  const spot = last ? Number(last.closeRaw) * 10 ** last.priceScalePow : 0;

  const dte = getDTE(Math.floor(new Date(position.expiration).getTime() / 1000), new Date(decisionTime).getTime());
  const strikeReais = position.strike / 100;
  const moneyness = spot > 0 ? strikeReais / spot : 0;

  const returns: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prevClose = Number(sorted[i - 1].closeRaw) * 10 ** sorted[i - 1].priceScalePow;
    const close = Number(sorted[i].closeRaw) * 10 ** sorted[i].priceScalePow;
    if (prevClose > 0) returns.push((close - prevClose) / prevClose);
  }
  const dailyStd = returns.length >= 2 ? stdDev(returns) : 0;
  const exerciseProbPct = spot > 0 && dte > 0 ? calcExerciseProb(spot, strikeReais, dte, dailyStd, position.kind) : 0;

  return {
    instrumentId: position.instrumentId,
    decisionTime,
    knowledgeTime,
    spot,
    dte,
    moneyness,
    exerciseProbPct,
    barsUsed: sorted.length,
  };
}

function stdDev(arr: readonly number[]): number {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const squaredDiffs = arr.map((v) => (v - m) ** 2);
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / (arr.length - 1));
}
