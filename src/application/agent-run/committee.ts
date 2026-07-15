/**
 * Registro de papéis do Comitê de Agentes (spec 2026-07-15).
 *
 * Os prompts vivem aqui, versionados no git — nunca no input do run
 * (cliente não injeta prompt de sistema; estrutura montada pelo runtime).
 * O runtime (`service.ts`) consulta o registro pelo `role` do nó AGENT;
 * papel desconhecido cai no comportamento genérico, retrocompatível.
 */
import type { AgentRunKind } from '../../domain/v1/models/agent-run';
import { buildRoleContext } from '../../lib/agent-data-context';

export interface CommitteeRole {
  readonly key: string;
  readonly title: string;
  readonly systemPrompt: (ticker: string, dataContext: string) => string;
  readonly buildContext: (ticker: string) => string;
}

const COMMON_RULES =
  'Responda em português, de forma objetiva e fundamentada. ' +
  'Use exclusivamente os dados fornecidos — não invente números; se um dado não estiver disponível, diga isso. ' +
  'Você não executa ordens e não tem autoridade de execução.';

function makeRole(key: string, title: string, mission: string): CommitteeRole {
  return Object.freeze({
    key,
    title,
    systemPrompt: (ticker: string, dataContext: string) =>
      `Você é o agente "${title}" do comitê de investimento da WR Trading Pro (B3/Brasil), deliberando sobre ${ticker}. ` +
      `${mission} ${COMMON_RULES}\n\n` +
      `DADOS DA PLATAFORMA (contexto real, base factual da sua análise):\n${dataContext}`,
    buildContext: (ticker: string) => buildRoleContext(key, ticker),
  });
}

const ROLES: readonly CommitteeRole[] = Object.freeze([
  makeRole(
    'fundamentalista-cvm',
    'Analista Fundamentalista CVM',
    'Avalie lucro, ROE, margens, endividamento e a recorrência dos resultados com base nos fundamentos CVM. ' +
      'Opine somente sobre fundamentos — não fale de dividendos nem de preço.',
  ),
  makeRole(
    'dividendos',
    'Analista de Dividendos',
    'Avalie a recorrência, o payout, a cobertura de caixa e a sustentabilidade dos proventos (dividendos + JCP). ' +
      'Aponte se a política de proventos é compatível com o lucro e o caixa.',
  ),
  makeRole(
    'risco',
    'Analista de Risco',
    'Delimite os riscos: endividamento, volatilidade de margens, concentração setorial e o que pode dar errado. ' +
      'Não recomende compra ou venda — apenas delimite o risco e as condições que o agravariam.',
  ),
  makeRole(
    'cetico',
    'Cético',
    'Você recebeu os pareceres dos colegas em "Saídas de nós anteriores". ' +
      'Ataque os pontos fracos de cada parecer, aponte dados que contradizem as teses e armadilhas como yield trap ou lucro não recorrente. ' +
      'Não repita a análise deles — rebata o que não se sustenta.',
  ),
]);

const BY_KEY = new Map(ROLES.map((r) => [r.key, r] as const));

/** Papel de comitê para um `role` de nó AGENT; `undefined` mantém o caminho genérico. */
export function getCommitteeRole(role: string | undefined): CommitteeRole | undefined {
  if (!role) return undefined;
  return BY_KEY.get(role);
}

/** `role` do nó SYNTHESIS que ativa a síntese como Gestor do comitê. */
export const GESTOR_ROLE_KEY = 'gestor';

/** Prompt de síntese do Gestor — mesmo schema hint de contrato do caminho genérico. */
export function buildGestorSystemPrompt(kind: AgentRunKind, schemaHint: string): string {
  return (
    'Você é o Gestor do comitê de investimento da WR Trading Pro (B3/Brasil). ' +
    'Recebeu os pareceres do Fundamentalista CVM, do Analista de Dividendos, do Analista de Risco e a réplica do Cético. ' +
    'Pondere os pareceres, dê peso real às objeções do Cético e explicite onde os analistas divergem. ' +
    (kind === 'PROPOSAL'
      ? 'Sua decisão é uma proposta que sempre exige aprovação humana e nunca executa ordens. '
      : '') +
    `Responda APENAS com um objeto JSON no formato: ${schemaHint}. Sem texto fora do JSON.`
  );
}
