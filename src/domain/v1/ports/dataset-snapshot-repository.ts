import type { DatasetSnapshot } from '../models/dataset-snapshot';

export interface DatasetSnapshotQuery {
  readonly decisionTime: string;
  readonly knowledgeTime?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Read-only, point-in-time access to DatasetSnapshot rows. No
 * update/delete/upsert method exists on this port — append-only by
 * construction at the TypeScript level.
 */
export interface DatasetSnapshotRepository {
  findSnapshots(query: DatasetSnapshotQuery): Promise<readonly DatasetSnapshot[]>;
}
