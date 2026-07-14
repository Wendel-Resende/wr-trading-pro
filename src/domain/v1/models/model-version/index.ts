/**
 * ModelVersion (Fase 5 / Item 2): one model version (ML or rule-based)
 * with hyperparameter snapshot, training evidence, and invalidation
 * conditions. Corrects A20 (dossier finding): a `kind='ML'` version
 * without real fit/validation/test evidence is structurally rejected
 * (see `requiresTrainingEvidence` / `hasValidTrainingEvidence`).
 */

export type ModelVersionId = string;

export type ModelVersionKind = 'ML' | 'RULE';

export interface ModelVersion {
  readonly modelVersion: ModelVersionId;
  readonly kind: ModelVersionKind;
  readonly label: string;
  readonly asOf: string;
  readonly hyperparametersJson: string;
  readonly trainingEvidenceJson: string | null;
  readonly invalidatedAt: string | null;
  readonly invalidationReason: string | null;
  readonly createdAt: string;
}

export interface ModelVersionSubmission {
  readonly kind: ModelVersionKind;
  readonly label: string;
  readonly asOf: string;
  readonly hyperparametersJson: string;
  readonly trainingEvidenceJson?: string | null;
}

/** Pure rule: only `kind='ML'` requires a real trainingEvidenceJson. */
export function requiresTrainingEvidence(kind: ModelVersionKind): boolean {
  return kind === 'ML';
}

/** Pure rule: trainingEvidenceJson must be present and parse as a non-null JSON object when required. */
export function hasValidTrainingEvidence(trainingEvidenceJson: string | null | undefined): boolean {
  if (!trainingEvidenceJson) return false;
  try {
    const parsed: unknown = JSON.parse(trainingEvidenceJson);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/** Pure rule: kind='ML' without valid trainingEvidenceJson is invalid (A20). */
export function isValidModelVersionSubmission(submission: Pick<ModelVersionSubmission, 'kind' | 'trainingEvidenceJson'>): boolean {
  if (!requiresTrainingEvidence(submission.kind)) return true;
  return hasValidTrainingEvidence(submission.trainingEvidenceJson);
}
