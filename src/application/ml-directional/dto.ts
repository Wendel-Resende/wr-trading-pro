import type {
  DirectionalModelVersion,
  DirectionalPrediction,
} from '../../domain/v1/models/ml-directional';
import { evaluateDirectionalGate } from './gate';

/**
 * Item D — DTOs públicos.
 *
 * Regra central: `artifactPath` NUNCA sai daqui. É um caminho do filesystem
 * do servidor (mesma classe de vazamento que o Guardião apontou no
 * `trainingEvidenceJson` do Item B). Tudo que a UI precisa é a versão, as
 * métricas e o veredito do gate.
 */

export interface DirectionalGateCheckDTO {
  readonly code: string;
  readonly label: string;
  readonly threshold: number;
  readonly observed: number | null;
  readonly passed: boolean;
}

export interface DirectionalModelVersionPublicDTO {
  readonly modelVersion: string;
  readonly createdAt: string;
  readonly researchRunId: string;
  readonly status: string;
  readonly gateApproved: boolean;
  readonly gateFailures: readonly string[];
  readonly gateChecks: readonly DirectionalGateCheckDTO[];
  readonly metrics: DirectionalModelVersion['metrics'];
}

export function toDirectionalModelVersionPublicDTO(
  model: DirectionalModelVersion,
): DirectionalModelVersionPublicDTO {
  // Reavalia o gate na leitura: se os limiares mudarem, a UI mostra a
  // conferência atual contra as métricas gravadas, em vez de um "aprovado"
  // congelado que ninguém consegue reconferir. `status` continua sendo o
  // veredito do momento do treino — os dois convivem, explicitamente.
  const gate = evaluateDirectionalGate(model.metrics);
  return {
    modelVersion: model.modelVersion,
    createdAt: model.createdAt,
    researchRunId: model.researchRunId,
    status: model.status,
    gateApproved: model.status === 'ACTIVE',
    gateFailures: model.gateFailures,
    gateChecks: gate.checks.map((c) => ({
      code: c.code,
      label: c.label,
      threshold: c.threshold,
      observed: c.observed,
      passed: c.passed,
    })),
    metrics: model.metrics,
  };
}

/**
 * Ranking fundamentalista — DTO público (reposicionado em 2026-08-11).
 *
 * O motor é um ESCORE COMPOSTO DE FATOR: ele ORDENA empresas na seção
 * transversal do trimestre. Ele não prevê direção de preço e não estima
 * probabilidade. Por isso três campos do motor anterior NÃO saem daqui:
 *
 * - `signal` (COMPRA/VENDA/NEUTRO): linguagem de recomendação sobre uma
 *   saída que é ordenação. Quem carrega a informação é `quantile`.
 * - `confidence`: constante (1) para todo o ranking — não informa nada.
 * - `prob`: mantido no banco e no domínio por compatibilidade com as linhas
 *   do motor de classificação anterior, mas NÃO é probabilidade: guarda o
 *   percentil transversal. Sai daqui com o nome honesto, `percentil`.
 *
 * A renomeação vive nesta fronteira de propósito: domínio, repositório,
 * adapters e coluna do banco seguem com os nomes herdados, e o histórico de
 * auditoria continua legível. Ver
 * docs/superpowers/specs/2026-08-11-ranking-fundamentalista-design.md.
 */
export interface DirectionalPredictionPublicDTO {
  readonly ticker: string;
  readonly cdCvm: string;
  /** Percentil transversal do trimestre (0–1). Não é probabilidade. */
  readonly percentil: number;
  /** Escore bruto do fator, centrado em 0: positivo = acima da mediana das pares. */
  readonly score?: number | null;
  /** Quintil no período: 1 = fundo, 5 = topo. Não é recomendação de compra. */
  readonly quantile?: number | null;
  readonly knowledgeDate: string;
  readonly topFeatures: readonly { readonly feature: string; readonly importance: number }[];
  readonly modelVersion: string;
  readonly universeDigest: string;
  readonly generatedAt: string;
}

export function toDirectionalPredictionPublicDTO(p: DirectionalPrediction): DirectionalPredictionPublicDTO {
  return {
    ticker: p.ticker,
    cdCvm: p.cdCvm,
    percentil: p.prob,
    score: p.score,
    quantile: p.quantile,
    knowledgeDate: p.knowledgeDate,
    topFeatures: p.topFeatures,
    modelVersion: p.modelVersion,
    universeDigest: p.universeDigest,
    generatedAt: p.generatedAt,
  };
}
