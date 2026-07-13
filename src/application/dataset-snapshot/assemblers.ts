import type { DatasetSnapshot } from '../../domain/v1/models/dataset-snapshot';
import type { RunProvenanceDTO } from '../read-models-v1/dto';
import type { DatasetSnapshotReadModelV1 } from './dto';

/** Pure assembler: no I/O, no clock reads. Provenance is passed in, already resolved. */
export function assembleDatasetSnapshot(model: DatasetSnapshot, provenance: RunProvenanceDTO): DatasetSnapshotReadModelV1 {
  return Object.freeze({
    id: model.id,
    snapshotId: model.snapshotId,
    asOf: model.asOf,
    knowledgeTime: model.knowledgeTime,
    decisionTime: model.decisionTime,
    domains: model.domains,
    provenance,
  });
}
