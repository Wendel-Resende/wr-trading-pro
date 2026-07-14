import type { SpreadOrderAuditAction, SpreadOrderAuditEntry } from '../../domain/v1/models/spread-order-audit';
import { createSpreadOrderAuditSubmission, isNoLookahead } from '../../domain/v1/models/spread-order-audit';
import type { SpreadOrderAuditRepository } from '../../domain/v1/ports/option-repository';
import { ReadModelError } from '../read-models-v1/errors';

export interface SpreadOrderAuditServicePorts {
  readonly spreadOrderAuditRepository: SpreadOrderAuditRepository;
}

export interface RecordSpreadOrderAuditInputV1 {
  readonly orderId: string;
  readonly action: SpreadOrderAuditAction;
  readonly requestedBy: string;
  readonly payload: unknown;
  readonly policyVersion: string;
  readonly decisionTime: string;
  readonly knowledgeTime: string;
}

/**
 * Application service for the append-only spread-order audit ledger
 * (Fase 6 — Consolidação). Reuses the `RiskDecision`/`OrderIntent`
 * pattern: this service NEVER executes an order — it only records the
 * CREATE/CANCEL intention (`/api/spread-orders` + `WR_TRADING_ENABLED`
 * keeps owning execution, unchanged).
 */
export class SpreadOrderAuditService {
  constructor(private readonly ports: SpreadOrderAuditServicePorts) {}

  async record(input: RecordSpreadOrderAuditInputV1): Promise<SpreadOrderAuditEntry> {
    if (!isNoLookahead(input.decisionTime, input.knowledgeTime)) {
      throw new ReadModelError('INVALID_QUERY', 'knowledgeTime não pode exceder decisionTime (CR-9)');
    }
    const submission = createSpreadOrderAuditSubmission(input);
    return this.ports.spreadOrderAuditRepository.append(submission);
  }

  async listByOrderId(orderId: string): Promise<readonly SpreadOrderAuditEntry[]> {
    return this.ports.spreadOrderAuditRepository.findByOrderId(orderId);
  }
}
