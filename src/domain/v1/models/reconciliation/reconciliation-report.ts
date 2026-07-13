import type { ReconciliationProvenance, ReconciliationRow } from './reconciliation-row';

/**
 * Fase 2 / Item 6 — relatório estruturado de reconciliação.
 *
 * - `PARIDADE`: amostras iguais em todos os domínios pedidos
 *   (mismatchSamples === 0 em toda linha).
 * - `PARIDADE_PARCIAL`: pelo menos um domínio sem mismatch, outro com.
 * - `SEM_PARIDADE`: todos os domínios comparados apresentam mismatch.
 *
 * Nenhum corte de legado é sugerido ou executado automaticamente a
 * partir deste status — é somente insumo para decisão humana.
 */
export type ReconciliationOverallStatus = 'PARIDADE' | 'PARIDADE_PARCIAL' | 'SEM_PARIDADE';

export interface ReconciliationReport {
  readonly reportId: string;
  readonly from: string;
  readonly to: string;
  readonly domains: readonly ReconciliationRow[];
  readonly overall: ReconciliationOverallStatus;
  readonly computedAt: string;
  readonly knowledgeTime: string;
  readonly decisionTime: string;
  readonly provenance: ReconciliationProvenance;
}
