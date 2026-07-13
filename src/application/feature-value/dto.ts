import type { RunProvenanceDTO } from '../read-models-v1/dto';

/** Exact scaled value for BIGINT features: real value = raw * 10^scalePow. `decimal` is computed deterministically, no float. */
export interface ScaledFeatureDecimalDTO {
  readonly raw: string;
  readonly scalePow: number;
  readonly decimal: string;
}

export interface FeatureValueReadModelV1 {
  readonly id: string;
  readonly featureId: string;
  readonly subjectId: string;
  readonly featureType: string;
  /** Present only when featureType === 'BIGINT'; exact decimal reconstruction, never float. */
  readonly bigintValue: ScaledFeatureDecimalDTO | null;
  /** Raw string form of the value, always present for auditability regardless of type. */
  readonly valueRaw: string;
  readonly enumValue: string | null;
  readonly label: string | null;
  readonly sourceKey: string;
  readonly knowledgeTime: string;
  readonly decisionTime: string;
  readonly provenance: RunProvenanceDTO;
}
