import type { RunProvenanceDTO } from '../read-models-v1/dto';

/**
 * Wire DTOs for Fase 2 / Item 5 (DatasetSnapshot). `domains` is
 * serialized verbatim as the structured domain object — never
 * re-flattened or renamed.
 */

export interface DatasetSnapshotDomainsDTO {
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

export interface DatasetSnapshotReadModelV1 {
  readonly id: string;
  readonly snapshotId: string;
  readonly asOf: string;
  readonly knowledgeTime: string;
  readonly decisionTime: string;
  readonly domains: DatasetSnapshotDomainsDTO;
  readonly provenance: RunProvenanceDTO;
}
