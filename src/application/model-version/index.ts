export * from './dto';
export * from './assemblers';
export { createModelVersionService } from './compose';
export { ModelVersionService, type ModelVersionServicePorts } from './service';

/**
 * Nenhuma `ModelVersion` conta como aprovada só por label/não-invalidação: o
 * `trainingEvidenceJson` precisa carregar `gate.approved === true` de fato
 * (parse estrito; qualquer erro de parse ou shape inesperado é tratado como
 * reprovado).
 *
 * Item D: preservado ao remover o motor híbrido porque as `ModelVersion`
 * históricas (treinos do híbrido, incluindo o que o gate reprovou em
 * 2026-07-18) continuam no banco e precisam continuar legíveis. Modelos novos
 * usam `DirectionalModelVersion.status`, não este campo.
 */
export function isTrainingEvidenceApproved(trainingEvidenceJson: string | null): boolean {
  if (!trainingEvidenceJson) return false;
  try {
    const parsed: unknown = JSON.parse(trainingEvidenceJson);
    return (parsed as { gate?: { approved?: unknown } } | null)?.gate?.approved === true;
  } catch {
    return false;
  }
}
