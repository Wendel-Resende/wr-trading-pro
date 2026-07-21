/**
 * Item A (D5, revisão 4): custo B3 nunca fica implícito. Toda submissão
 * exige `source` (proveniência do número) e `createdBy` (identidade da
 * sessão) — nunca aceitos como "default". Perfis são append-only:
 * arquivar preenche `archivedAt`/`archivedBy`, nunca deleta a linha.
 */
export interface BacktestCostProfile {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly fixedBrokerage: number;
  readonly emolumentsPct: number;
  readonly spreadBps: number;
  readonly slippageBps: number;
  readonly lotSize: number;
  readonly source: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly archivedAt: string | null;
  readonly archivedBy: string | null;
}

export interface BacktestCostProfileSubmission {
  readonly version: number;
  readonly label: string;
  readonly fixedBrokerage: number;
  readonly emolumentsPct: number;
  readonly spreadBps: number;
  readonly slippageBps: number;
  readonly lotSize: number;
  readonly source: string;
  readonly createdBy: string;
}
