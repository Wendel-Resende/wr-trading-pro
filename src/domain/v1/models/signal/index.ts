import { compareInstants, parseInstant } from '../../time';

/**
 * Signal (Fase 5 / Item 3): a signal emitted by a ModelVersion for an
 * Instrument at an instant, with point-in-time provenance
 * (`knowledgeTime`). The engine never opens a position at the bar that
 * produced the signal (CR-9) — see backtest-run for entry-at-t+1.
 */

export type SignalId = string;

export type SignalDirection = 'BUY' | 'SELL' | 'HOLD';

export interface Signal {
  readonly signalId: SignalId;
  readonly modelVersionId: string;
  readonly instrumentId: string;
  readonly barTime: string;
  readonly direction: SignalDirection;
  readonly score: number | null;
  readonly knowledgeTime: string;
  readonly createdAt: string;
}

export interface SignalSubmission {
  readonly modelVersionId: string;
  readonly instrumentId: string;
  readonly barTime: string;
  readonly direction: SignalDirection;
  readonly score?: number | null;
  readonly knowledgeTime: string;
}

/** Pure rule (point-in-time, principle 1): knowledgeTime must be <= barTime. */
export function isPointInTimeSignal(barTime: string, knowledgeTime: string): boolean {
  const bar = parseInstant(barTime);
  const knowledge = parseInstant(knowledgeTime);
  if (bar === null || knowledge === null) return false;
  return compareInstants(knowledge, bar) <= 0;
}
