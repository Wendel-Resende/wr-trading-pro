import type { ResearchSession as ResearchSessionRow } from '@prisma/client';
import type { ResearchSessionPersistedShape } from '../../../domain/v1/models/research-session';

export const toResearchSession = (row: ResearchSessionRow): ResearchSessionPersistedShape => ({
  sessionId: row.sessionId,
  kind: row.kind,
  status: row.status,
  label: row.label,
  notes: row.notes,
  configJson: row.configJson,
  resultJson: row.resultJson,
  errorSummary: row.errorSummary,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
