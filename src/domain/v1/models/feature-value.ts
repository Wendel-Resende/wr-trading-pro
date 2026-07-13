import type { IngestionRunId } from './ingestion';

/**
 * A single raw, already-computed and approved feature value
 * (Fase 2 / Item 5). NOT an ML engine: no scoring, ranking, signal,
 * decision, anomaly detection, or agent narrative text is modeled here
 * or anywhere reachable from this type. The intent is point-in-time
 * transparency over values that already exist elsewhere.
 *
 * `valueRaw` + `scalePow` (only for BIGINT) represent an exact integer
 * mantissa * 10^scalePow — never a float. `FLOAT` is not a member of
 * `FeatureType`, making it structurally impossible to represent a
 * floating-point feature type at the TypeScript level.
 *
 * Append-only: to "update" a value, insert a new entry with a later
 * `knowledgeTime`. The past is never altered.
 */

export type FeatureValueId = string;

export type FeatureType = 'STRING' | 'BIGINT' | 'DATE' | 'ENUM';

export interface FeatureValue {
  readonly id: FeatureValueId;
  readonly featureId: string;
  /** Canonical instrument/issuer id — never a loose ticker symbol. */
  readonly subjectId: string;
  readonly featureType: FeatureType;
  /** Exact string or bigint-string representation of the raw value. */
  readonly valueRaw: string;
  /** Required when featureType === 'BIGINT'; range [-18,18]. */
  readonly scalePow: number | null;
  /** Required when featureType === 'ENUM'. */
  readonly enumValue: string | null;
  /** Optional human-display label. */
  readonly label: string | null;
  /** Derived from the creating IngestionRun, exactly like VersionedMarketBar. */
  readonly sourceKey: string;
  readonly knowledgeTime: string;
  readonly decisionTime: string;
  readonly createdByRunId: IngestionRunId;
  readonly createdAt: string;
}

/** Submission shape for internal seeding (test harness only) — no HTTP write path exists for FeatureValue. */
export interface FeatureValueSubmission {
  readonly featureId: string;
  readonly subjectId: string;
  readonly featureType: FeatureType;
  readonly valueRaw: string;
  readonly scalePow?: number | null;
  readonly enumValue?: string | null;
  readonly label?: string | null;
  readonly knowledgeTime: string;
  readonly decisionTime: string;
}
