/**
 * Sessão de pesquisa — o padrão draft→run→session portado do Jesse.
 *
 * O ganho de persistir o rascunho, e o motivo de não ser uma tool única com
 * 20 parâmetros: o agente monta a configuração incrementalmente, o `run` é
 * um passo separado e cancelável, e o rascunho sobrevive ao reinício do MCP
 * Pilot — que é processo filho do Electron e reinicia com frequência.
 */

export const RESEARCH_SESSION_KINDS = ['SIGNIFICANCE', 'MONTE_CARLO'] as const;
export type ResearchSessionKind = (typeof RESEARCH_SESSION_KINDS)[number];

export const RESEARCH_SESSION_STATUSES = ['DRAFT', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED'] as const;
export type ResearchSessionStatus = (typeof RESEARCH_SESSION_STATUSES)[number];

/**
 * Transições permitidas. Estados terminais (DONE, FAILED, CANCELLED) não
 * voltam: uma sessão concluída que pudesse rodar de novo tornaria o
 * `resultJson` ambíguo sobre qual configuração o produziu.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<ResearchSessionStatus, readonly ResearchSessionStatus[]>> = Object.freeze({
  DRAFT: ['RUNNING', 'CANCELLED'],
  RUNNING: ['DONE', 'FAILED', 'CANCELLED'],
  DONE: [],
  FAILED: [],
  CANCELLED: [],
});

export function canTransition(from: ResearchSessionStatus, to: ResearchSessionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface ResearchSessionPersistedShape {
  readonly sessionId: string;
  readonly kind: string;
  readonly status: string;
  readonly label: string;
  readonly notes: string | null;
  readonly configJson: string;
  readonly resultJson: string | null;
  readonly errorSummary: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
