import type { ResearchRunReadModelV1 } from '../../../../application/research-run/dto';

/**
 * Bloqueador 3 (revisão Guardião): DTO público allowlist para ResearchRun.
 * `paramsJson` (hiperparâmetros brutos), `datasetId` e `createdBy` nunca são
 * expostos por esta rota — aplicado somente aos caminhos NOVOS
 * (`modelVersionId`, `name`); o caminho legado `datasetId` continua cru.
 *
 * Revisão final (2026-07-21): `hypothesis` também removida do DTO público —
 * é texto livre de até 5.000 caracteres, não necessário para o histórico
 * resumido da aba pública, e sem allowlist de conteúdo (mesmo risco de
 * vazamento incidental de `source`). Mantém-se só o que a UI realmente
 * precisa: identificador, nome, janela, outcome e referência de versão.
 *
 * Achado médio 7 (auditoria final do Guardião, 2026-07-22): `outcome` NÃO
 * pode mais ser inferido só de `modelVersionId !== null` — o POST público
 * de ResearchRun aceitava esse campo do chamador (já removido do schema,
 * ver `route.ts`), mas mesmo com isso corrigido, `outcome` só é `'APROVADO'`
 * quando o `ModelVersion` referenciado REALMENTE existe e carrega
 * `gate.approved === true` na sua evidência persistida (checado aqui via
 * `gateApprovedByModelVersionId`, resolvido pelo chamador a partir do
 * `ModelVersionService` real) — nunca um booleano forjável.
 */
export type ResearchRunOutcome = 'APROVADO' | 'REPROVADO';

export interface ResearchRunPublicDTO {
  readonly runId: string;
  readonly name: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly createdAt: string;
  readonly modelVersionId: string | null;
  readonly outcome: ResearchRunOutcome;
}

export function toResearchRunPublicDTO(
  r: ResearchRunReadModelV1,
  gateApprovedByModelVersionId: ReadonlyMap<string, boolean>,
): ResearchRunPublicDTO {
  const isApproved = r.modelVersionId !== null && gateApprovedByModelVersionId.get(r.modelVersionId) === true;
  return {
    runId: r.runId,
    name: r.name,
    windowStart: r.windowStart,
    windowEnd: r.windowEnd,
    createdAt: r.createdAt,
    modelVersionId: r.modelVersionId,
    outcome: isApproved ? 'APROVADO' : 'REPROVADO',
  };
}
