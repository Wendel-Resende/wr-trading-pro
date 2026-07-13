import type { DatasetSnapshot as DatasetSnapshotRow } from '@prisma/client';
import type { DatasetSnapshot, DatasetSnapshotDomains } from '../../../domain/v1/models/dataset-snapshot';
import { DatasetSnapshotDomainsSchema } from './schemas';
import { InvalidDatasetSnapshotInputError } from './errors';

/** Parses the physical JSON TEXT `domains` column into the structured domain shape. Parsing happens ONLY at this adapter boundary. */
export function parseDomains(raw: string): DatasetSnapshotDomains {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidDatasetSnapshotInputError('domains: JSON inválido na linha persistida');
  }
  const result = DatasetSnapshotDomainsSchema.safeParse(parsed);
  if (!result.success) {
    throw new InvalidDatasetSnapshotInputError('domains: formato inválido na linha persistida');
  }
  return result.data;
}

export function stringifyDomains(domains: DatasetSnapshotDomains): string {
  return JSON.stringify(domains);
}

export const toDatasetSnapshot = (row: DatasetSnapshotRow): DatasetSnapshot => ({
  id: row.id,
  snapshotId: row.snapshotId,
  asOf: row.asOf.toISOString(),
  knowledgeTime: row.knowledgeTime.toISOString(),
  decisionTime: row.decisionTime.toISOString(),
  domains: parseDomains(row.domains),
  createdByRunId: row.createdByRunId,
  createdAt: row.createdAt.toISOString(),
});
