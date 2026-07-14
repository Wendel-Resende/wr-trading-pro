import type { SpreadOrderAudit as SpreadOrderAuditRow } from '@prisma/client';
import type { SpreadOrderAuditAction, SpreadOrderAuditEntry } from '../../../domain/v1/models/spread-order-audit';

export const toSpreadOrderAuditEntry = (row: SpreadOrderAuditRow): SpreadOrderAuditEntry => ({
  auditId: row.auditId,
  orderId: row.orderId,
  action: row.action as SpreadOrderAuditAction,
  requestedBy: row.requestedBy,
  payloadJson: row.payloadJson,
  policyVersion: row.policyVersion,
  decisionTime: row.decisionTime.toISOString(),
  knowledgeTime: row.knowledgeTime.toISOString(),
  createdAt: row.createdAt.toISOString(),
});
