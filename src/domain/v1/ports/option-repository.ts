import type { OptionPosition, OptionPositionSubmission } from '../models/option-position';
import type { SpreadOrderAuditEntry, SpreadOrderAuditSubmission } from '../models/spread-order-audit';

/** Fase 6 — Consolidação. Port para persistência de `OptionPosition`. */
export interface OptionPositionRepository {
  save(submission: OptionPositionSubmission): Promise<OptionPosition>;
  findById(id: string): Promise<OptionPosition | null>;
  findByInstrumentId(instrumentId: string): Promise<readonly OptionPosition[]>;
}

/** Fase 6 — Consolidação. Port para o ledger append-only de ordens de spread. */
export interface SpreadOrderAuditRepository {
  append(submission: SpreadOrderAuditSubmission): Promise<SpreadOrderAuditEntry>;
  findByOrderId(orderId: string): Promise<readonly SpreadOrderAuditEntry[]>;
}
