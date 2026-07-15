# Comitê de Agentes — Design (2026-07-15)

Status: aprovado pelo usuário em 2026-07-15.
Referências: vault `comite-investimento-multiagente-b3`, runtime AgentRun v1 (Fase 3),
`docs/CODEX_HANDOFF.md` (sessão 2026-07-14/15).

## Objetivo

Adicionar um modo "Comitê" ao runtime governado de agentes: 4 papéis de análise
(Fundamentalista CVM, Dividendos, Risco, Cético) deliberando sobre **1 ticker
B3 por run**, com o Cético rebatendo os demais e a síntese atuando como
Gestor. Sem mudança de contrato, schema ou API — o comitê é um DAG + prompts
por papel sobre o motor existente.

## Decisões de escopo (com o usuário)

1. **Composição v1:** 4 papéis + síntese-gestor (~5 chamadas LLM/run).
   Papéis de preço/MT5, otimista e afins ficam para depois.
2. **Debate:** Fundamentalista, Dividendos e Risco em paralelo; o Cético roda
   depois lendo os 3 pareceres (`reads`) e rebatendo. Sem segunda rodada.
3. **Contrato:** `ResearchFinding`/`TradeProposal` intactos. Pareceres
   individuais vivem nos `nodeStates` (já persistidos); a UI ganha uma visão
   de comitê legível.
4. **Alvo:** um ticker por run (obrigatório no modo comitê). Revisão da
   carteira inteira fica fora da v1.

Abordagem escolhida: **registro de papéis server-side** (prompts versionados
no git; runtime continua genérico). Rejeitadas: prompts no input do run
(cliente injetaria prompt arbitrário; contra o princípio "estrutura montada
pelo runtime") e orquestrador separado (quebraria a trilha de auditoria de
1 run = 1 deliberação).

## 1. Registro de papéis — `src/application/agent-run/committee.ts` (novo)

Camada de aplicação. Cada papel define:

```ts
interface CommitteeRole {
  key: string;          // valor do `role` no nó do DAG
  title: string;        // nome legível para UI e material da síntese
  systemPrompt: (ticker: string, dataContext: string) => string;
  buildContext: (ticker: string) => string; // fatia de dados do papel
}
```

`buildContext` delega para `buildRoleContext(roleKey, ticker)` do
`agent-data-context.ts` (seção 2) — o registro define prompts e titulação;
a construção de dados fica onde já vivem os acessos ao banco/exports.

Chaves: `fundamentalista-cvm`, `dividendos`, `risco`, `cetico` (nós AGENT) e
`gestor` (nó SYNTHESIS). Export: `getCommitteeRole(role: string):
CommitteeRole | undefined`.

Integração no `service.ts`:

- `executeAgentNodeLive`: se `getCommitteeRole(node.role)` existe, usa o
  prompt e a fatia de contexto do papel; senão, **comportamento genérico
  atual inalterado** (retrocompatível com `analista-pesquisa`/`analista-proposta`).
- `synthesizeOutputLive`: passa a receber o nó SYNTHESIS; com
  `role: 'gestor'`, usa o prompt de síntese do gestor; senão, o atual.
  O JSON schema hint do contrato não muda.

Essência dos prompts (calibrável na implementação):

- **Fundamentalista CVM** — lucro, ROE, margens, endividamento, recorrência;
  opina somente sobre fundamentos.
- **Dividendos** — recorrência, payout, cobertura de caixa, sustentabilidade
  dos proventos.
- **Risco** — endividamento, volatilidade de margens, concentração setorial,
  o que pode dar errado; delimita, não recomenda.
- **Cético** — recebe os 3 pareceres via `reads`; instruído a atacar pontos
  fracos, apontar dados que contradizem as teses e armadilhas (yield trap,
  lucro não recorrente). Não repete análise; rebate.
- **Gestor** — pondera os 4 pareceres, explicita divergências (incluindo a
  réplica do cético) e monta o contrato final.

## 2. Fatias de contexto por papel — `agent-data-context.ts`

Nova função `buildRoleContext(roleKey: string, ticker: string): string` ao
lado das existentes:

- `fundamentalista-cvm`: contexto atual do ticker + evolução dos últimos
  8 trimestres (receita, lucro, margem, ROE) — série hoje não injetada.
- `dividendos`: série trimestral de proventos (DFC, fonte validada) dos
  últimos ~5 anos + payout 12m + pertencimento à carteira 12 vigente.
- `risco`: Dívida/PL, margens dos últimos 8 trimestres (volatilidade),
  setor e peso do setor na carteira.
- `cetico`: contexto compacto do ticker (para checar números citados pelos
  colegas); o material principal dele são os pareceres via `reads`.

Limite de tamanho: cada fatia + prompt do papel ≤ ~2–3 mil tokens, para
caber no `num_ctx=8192` do Ollama local. **O resumo da carteira inteira sai
dos prompts dos papéis focados** (no comitê seria ruído/estouro de contexto);
o comportamento do caminho genérico (não-comitê) não muda.

## 3. DAG de comitê — template na UI

Montado no `AgentRunsPanel.tsx`, como o `buildDefaultDag` atual:

```
        ┌→ fund ──────┐
INPUT ──┼→ divs ──────┼→ cetico → evidence → synthesis(gestor) → OUTPUT
        └→ risco ─────┘     ↑
   (cetico lê fund/divs/risco via reads)
```

8 nós: `in` (INPUT) → `fund`/`divs`/`risco` (AGENT, paralelos) → `cetico`
(AGENT, `reads: ['fund.parecer','divs.parecer','risco.parecer']`) →
`evidence` (EVIDENCE, lê os 4 pareceres) → `synthesis` (SYNTHESIS,
`role: 'gestor'`) → `out` (OUTPUT, `reads: ['synthesis.finding']`).
Cada AGENT usa `provides: ['parecer']`. O DAG persistido documenta o debate
por construção.

Melhoria pontual: `collectAgentMaterial` rotula o material com o `role` do
nó (não só o `nodeId`), para o gestor saber quem disse o quê. Requer passar
o DAG (ou um mapa id→role) para a coleta.

## 4. Contrato, kind e validação

- Contrato final intacto; schemas strict e mapping não mudam.
- Comitê disponível para RESEARCH e PROPOSAL. Em PROPOSAL o resultado
  continua `requiresHumanApproval: true` e nunca gera OrderIntent.
- Ticker obrigatório **na UI** do modo comitê (vai em `input.ticker`);
  o runtime mantém a validação atual (regex de ticker como fallback).

## 5. UI — `AgentRunsPanel.tsx`

- **Criação:** seletor "Simples | Comitê". Modo comitê: campo ticker
  obrigatório + pergunta opcional; defaults de orçamento maiores
  (~5 chamadas LLM: timeout sugerido 300s local, maxCost ~30k tokens).
- **Detalhe:** seção "Pareceres do Comitê" quando o run tem papéis de
  comitê — parecer de cada papel como texto legível com título do papel e
  metadados LLM (provider/modelo/tokens); cético destacado como contraditor;
  contrato final apresentado como parecer do gestor. Chips do DAG mantidos.

## 6. Erros e orçamento

Nada novo no motor:

- Falha de LLM em um nó → fallback simulado **marcado** (`_llm.simulated`);
  um comitê com 2 de 4 papéis live continua legível e honesto (UI mostra SIM).
- Orçamento estourado → `FAILED` com `errorJson` explícito, como hoje.
- Sem porta LLM (testes) → caminho determinístico simulado integral.

## 7. Testes

- `test:agent-run` (determinístico, sem LLM): DAG de comitê valida e executa
  no caminho simulado; `reads` do cético resolvem; OUTPUT contratual.
- Unitários do registro: cada papel retorna prompt contendo sua fatia;
  papel desconhecido → `undefined` (caminho genérico preservado); prompt de
  gestor selecionado apenas quando o nó SYNTHESIS tem `role: 'gestor'`.
- E2E manual: comitê WEGE3 com Ollama local (e um run com DeepSeek) —
  4 pareceres live distintos, cético citando os colegas, contrato do gestor
  coerente com as divergências.

## Fora de escopo (v1)

- Analista de preço/MT5 (exige candles server-side), otimista, 7 papéis.
- Modo "revisar carteira 12" inteira.
- Segunda rodada de debate.
- Mudança de contrato (`committee` no output) — reavaliar se a visão de
  comitê da UI se mostrar insuficiente para auditoria externa.
