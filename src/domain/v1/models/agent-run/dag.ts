/**
 * Fase 3 / Item 2 — DAG semântico do `AgentRun`: tipos de nó, validação
 * estrutural (ciclo/órfão/OUTPUT único) e ordenação topológica
 * determinística. Puro domínio: nenhuma dependência de Prisma/Zod/HTTP.
 */

export type AgentRunNodeType = 'INPUT' | 'AGENT' | 'EVIDENCE' | 'SYNTHESIS' | 'OUTPUT';

export interface AgentRunNode {
  readonly id: string;
  readonly type: AgentRunNodeType;
  readonly role?: string;
  readonly reads?: readonly string[];
  readonly provides?: readonly string[];
}

export interface AgentRunDag {
  readonly nodes: readonly AgentRunNode[];
  readonly edges: readonly (readonly [string, string])[];
}

/** Falha de validação estrutural do DAG (ciclo, nó órfão, sem OUTPUT único, referência inexistente). */
export class InvalidAgentRunDagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAgentRunDagError';
  }
}

function nodeIdFromRef(ref: string): string {
  const dotIndex = ref.indexOf('.');
  return dotIndex === -1 ? ref : ref.slice(0, dotIndex);
}

/**
 * Valida a estrutura do DAG e retorna os nós em ordem topológica
 * determinística (Kahn, desempate pela ordem original de declaração).
 * Lança `InvalidAgentRunDagError` para qualquer violação estrutural.
 */
export function validateAndSortDag(dag: AgentRunDag): readonly AgentRunNode[] {
  if (dag.nodes.length === 0) {
    throw new InvalidAgentRunDagError('DAG inválido: nodes não pode ser vazio');
  }

  const seenIds = new Set<string>();
  for (const node of dag.nodes) {
    if (seenIds.has(node.id)) {
      throw new InvalidAgentRunDagError(`DAG inválido: id de nó duplicado: ${node.id}`);
    }
    seenIds.add(node.id);
  }

  const outputNodes = dag.nodes.filter((node) => node.type === 'OUTPUT');
  if (outputNodes.length !== 1) {
    throw new InvalidAgentRunDagError(
      `DAG inválido: é exigido exatamente um nó OUTPUT (encontrados: ${outputNodes.length})`,
    );
  }

  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of dag.nodes) {
    adjacency.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const [from, to] of dag.edges) {
    if (from === to) {
      throw new InvalidAgentRunDagError(`DAG inválido: auto-loop não permitido: ${from}`);
    }
    if (!seenIds.has(from) || !seenIds.has(to)) {
      throw new InvalidAgentRunDagError(`DAG inválido: aresta referencia nó inexistente: ${from} -> ${to}`);
    }
    adjacency.get(from)!.push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  // `reads` referencia outro nó (`nodeId` ou `nodeId.field`); `provides`
  // apenas nomeia campos que o próprio nó produz, não é uma referência.
  for (const node of dag.nodes) {
    for (const ref of node.reads ?? []) {
      if (!seenIds.has(nodeIdFromRef(ref))) {
        throw new InvalidAgentRunDagError(`DAG inválido: referência a nó inexistente em reads: ${ref}`);
      }
    }
  }

  const byId = new Map(dag.nodes.map((node) => [node.id, node] as const));
  const queue: string[] = dag.nodes.filter((node) => (inDegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const sorted: AgentRunNode[] = [];
  const remainingInDegree = new Map(inDegree);

  while (queue.length > 0) {
    queue.sort((a, b) => dag.nodes.findIndex((n) => n.id === a) - dag.nodes.findIndex((n) => n.id === b));
    const currentId = queue.shift()!;
    sorted.push(byId.get(currentId)!);
    for (const next of adjacency.get(currentId) ?? []) {
      const remaining = (remainingInDegree.get(next) ?? 0) - 1;
      remainingInDegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  if (sorted.length !== dag.nodes.length) {
    throw new InvalidAgentRunDagError('DAG inválido: ciclo detectado (ordenação topológica incompleta)');
  }

  return Object.freeze(sorted);
}
