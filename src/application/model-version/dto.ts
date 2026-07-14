export interface ModelVersionReadModelV1 {
  readonly modelVersion: string;
  readonly kind: string;
  readonly label: string;
  readonly asOf: string;
  readonly hyperparametersJson: string;
  readonly trainingEvidenceJson: string | null;
  readonly invalidatedAt: string | null;
  readonly invalidationReason: string | null;
  readonly createdAt: string;
}
