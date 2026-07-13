import type { IngestionRunId } from './ingestion';

/**
 * Point-in-time metadata about the state of the data repository
 * (Fase 2 / Item 5). Read-only: no write/HTTP path is exposed for this
 * model; `DatasetSnapshotSubmission` exists only for the internal test
 * harness seeding helper.
 *
 * `domains` is a structured, parsed object at the domain boundary — the
 * physical column is JSON TEXT; parsing/serialization happens only at
 * the adapter boundary (mapping.ts), never here.
 *
 * Two rows sharing the same `decisionTime` with distinct `knowledgeTime`
 * are NOT conflicting: they represent different states of knowledge
 * over time for the same decision instant.
 */

export type DatasetSnapshotId = string;

export interface DatasetSnapshotDomains {
  readonly referenceData: {
    readonly issuers: number;
    readonly instrumentVersions: number;
  };
  readonly cvm: {
    readonly filings: number;
    readonly facts: number;
    readonly shareCapitalFacts: number;
  };
  readonly marketBars: {
    readonly count: number;
  };
}

export interface DatasetSnapshot {
  readonly id: DatasetSnapshotId;
  readonly snapshotId: string;
  /** Civil date/time the snapshot describes. */
  readonly asOf: string;
  /** Instant the platform came to know/display this snapshot; knowledgeTime <= decisionTime. */
  readonly knowledgeTime: string;
  /** External decision instant this snapshot refers to. */
  readonly decisionTime: string;
  readonly domains: DatasetSnapshotDomains;
  readonly createdByRunId: IngestionRunId;
  /** Real back-end insert timestamp; always > knowledgeTime. */
  readonly createdAt: string;
}

/** Submission shape for internal seeding (test harness only) — no HTTP write path exists for DatasetSnapshot. */
export interface DatasetSnapshotSubmission {
  readonly snapshotId: string;
  readonly asOf: string;
  readonly knowledgeTime: string;
  readonly decisionTime: string;
  readonly domains: DatasetSnapshotDomains;
}
