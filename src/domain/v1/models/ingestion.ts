/**
 * Ledger de ingestão de dados de referência (Fase 2 / Item 1).
 *
 * Uma execução (run) nasce RUNNING e termina exatamente uma vez em
 * SUCCEEDED ou FAILED. O `completedAt` de uma run SUCCEEDED é o
 * knowledgeTime das linhas de referência criadas por ela: leituras
 * "as-known-at" só enxergam linhas cuja run criadora completou em
 * instante <= knowledgeTime.
 *
 * Todos os instantes são strings ISO-8601 com offset explícito (UTC
 * recomendado) e precisão máxima de milissegundos. Nenhum componente
 * de domínio lê o relógio; timestamps são sempre explícitos.
 */

export type IngestionRunId = string;

export type IngestionRunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED';

/**
 * Chave imutável e normalizada da fonte de dados (minúsculas,
 * `[a-z0-9:._/-]`). É uma String livre de propósito descritivo — sem
 * relação com cadastros legados de fontes.
 */
export type IngestionSourceKey = string;

export interface IngestionRun {
  readonly id: IngestionRunId;
  readonly sourceKey: IngestionSourceKey;
  readonly status: IngestionRunStatus;
  /** Instante ISO-8601 em que a run foi aberta. */
  readonly startedAt: string;
  /** Instante ISO-8601 do término (SUCCEEDED/FAILED); null enquanto RUNNING. */
  readonly completedAt: string | null;
  /** Resumo serializado (JSON) do resultado; null enquanto RUNNING. */
  readonly summary: string | null;
}

/**
 * Visão de conhecimento para leituras bitemporais: apenas fatos cuja
 * run criadora completou com sucesso em instante <= knowledgeTime são
 * visíveis. Fechamentos de intervalo registrados por runs posteriores
 * ao knowledgeTime são ignorados (o intervalo aparece aberto).
 */
export interface KnowledgeView {
  /** Instante ISO-8601, inclusivo (completedAt == knowledgeTime é visível). */
  readonly knowledgeTime: string;
}
