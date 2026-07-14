# Fase 3 / Item 2 — DAG explícito, nós/saídas e orçamento/cancelamento reais

Status: **especificação para evolução aditiva e não destrutiva** do Item 1.
Sem execução financeira, sem `execute_order`, sem exposição de segredos.

## Problema

O Item 1 entregou o ciclo de vida do `AgentRun` (persistência,
`202 + runId`, cancelamento e máquina de estados), mas o "processamento"
é simulado e o DAG é apenas uma estrutura de nós/arestas sem
semântica de execução.

Para um runtime profissional de agentes, precisamos:

1. **DAG semântico**: nós tipados (`INPUT`, `AGENT`, `EVIDENCE`,
   `SYNTHESIS`, `OUTPUT`), com entradas/saídas declaradas e arestas
   direcionadas; ciclo e nós órfãos são rejeitados.
2. **Execução determinística do DAG** (sem LLM real): cada nó é
   resolvido em ordem topológica; o `AGENT` é simulado com contrato
   fixo, mas o encadeamento e o acúmulo de saídas são reais.
3. **Orçamento real**: `maxSteps`, `maxCost`, `timeoutMs` são
   aplicados; estouro de passos/custo/timeout leva a `FAILED` com
   `errorJson` explícito.
4. **Cancelamento real**: `cancel` interrompe um `RUNNING` e
   persiste `CANCELLED` (já coberto pelo Item 1, mas re-testado
   sob execução real do DAG).
5. **Saída estruturada**: `outputJson` carrega o contrato
   (`ResearchFinding`/`TradeProposal`) montado a partir das saídas dos nós.

## Objetivo

Evoluir o `AgentRun` do Item 1 para um runtime de DAG com orçamento e
cancelamento reais, mantendo:

- `POST /api/v1/agent-runs` → `202 + runId`;
- `GET /api/v1/agent-runs/:id`;
- `POST /api/v1/agent-runs/:id/cancel`;
- nenhuma ponte para `ExecutionBroker`/ordens reais;
- LLM nunca executa: agente produz contrato, não ordem.

## Princípios fixos

- **Sem lookahead**: `knowledgeTime <= decisionTime`.
- **Sem float canônico**: contagens/ids exatos.
- **Identidade canônica**: `runId` no servidor.
- **Aprovação humana obrigatória** antes de `OrderIntent`.
- **LLM não executa**: `PROPOSAL` nunca gera `OrderIntent`.
- **Sem banco real, MT5, rede ou trading**.
- **`docs/CODEX_HANDOFF.md` não tocado**.
- **Sem alteração de `tradingAgentsService`, `MLPredictionsTab` ou `src/app/api/agents/**`**.

## 1. Modelo `AgentRun` (evolução do Item 1)

Mantém todos os campos do Item 1. Adições:

- `dag` (`String`) passa a conter **DAG semântico**:
  ```json
  {
    "nodes": [
      { "id": "in1", "type": "INPUT", "provides": ["ticker"] },
      { "id": "ag1", "type": "AGENT", "role": "valuation",
        "reads": ["in1.ticker"], "provides": ["thesisDraft"] },
      { "id": "ev1", "type": "EVIDENCE", "reads": ["ag1.thesisDraft"],
        "provides": ["evidenceList"] },
      { "id": "sy1", "type": "SYNTHESIS", "reads": ["ag1.thesisDraft", "ev1.evidenceList"],
        "provides": ["finding"] },
      { "id": "out1", "type": "OUTPUT", "reads": ["sy1.finding"] }
    ],
    "edges": [["in1","ag1"],["ag1","ev1"],["ag1","sy1"],["ev1","sy1"],["sy1","out1"]]
  }
  ```
- `budgetJson` (`String`) continua `{ maxSteps?, maxCost?, timeoutMs? }`;
  agora é **aplicado** durante a execução.
- `nodeStatesJson` (`String?`): mapa `nodeId -> { status, output? }`
  persistido a cada transição (observabilidade do DAG).
- `stepsUsed` (`Int`): contador de nós executados (para `maxSteps`).
- `costUsed` (`Int`): custo estimado acumulado (para `maxCost`).

Índices: manter os do Item 1; adicionar `@@index([status, updatedAt])`.

## 2. Validação do DAG

Regras obrigatórias (Zod `.strict()` no adapter):

- `nodes` não vazio;
- `id` único por nó;
- `type` ∈ `{INPUT, AGENT, EVIDENCE, SYNTHESIS, OUTPUT}`;
- `edges` direcionadas, sem auto-loop (`a != b`);
- **sem ciclo** (detecção por DFS/ordenação topológica);
- **sem nó órfão**: toda aresta referencia nós existentes;
- exatamente um `OUTPUT` (o nó que alimenta a saída do `AgentRun`);
- `reads`/`provides` referenciam `nodeId` ou `nodeId.field` existentes
  no grafo (validação leve; não bloqueia se faltar campo, mas
  garante ausência de `nodeId` inexistente).

Falha em qualquer regra → `ReadModelError('INVALID_DAG', ...)` com 400.

## 3. Execução determinística (sem LLM real)

`AgentRunService.advance(runId)` (já existe no Item 1) agora:

1. valida o DAG (seção 2);
2. transiciona `QUEUED -> RUNNING`;
3. executa nós em ordem topológica:
   - `INPUT`: ecoa o `input` fornecido;
   - `AGENT`: produz contrato fixo (mesmo do Item 1), mas **acumula**
     em `nodeStatesJson`;
   - `EVIDENCE`: anexa evidência simulada derivada das saídas lidas;
   - `SYNTHESIS`: combina saídas lidas no contrato final;
   - `OUTPUT`: materializa `outputJson` a partir do nó `SYNTHESIS`/saída;
4. aplica orçamento:
   - `stepsUsed` incrementa por nó; se `stepsUsed > maxSteps` → `FAILED`;
   - `costUsed += custoPorNo`; se `costUsed > maxCost` → `FAILED`;
   - `timeoutMs`: a execução é envolvida em um relógio; estouro → `FAILED`;
5. transiciona `RUNNING -> SUCCEEDED` com `outputJson` montado;
   ou `RUNNING -> FAILED` com `errorJson` explícito.

`cancel(runId)` (Item 1) é re-testado sob execução real: `QUEUED`/`RUNNING`
aceito; terminais rejeitados com 409.

## 4. Contratos de saída

Idênticos ao Item 1 (`ResearchFinding`/`TradeProposal`), montados a partir
das saídas dos nós `SYNTHESIS`/`OUTPUT`. `PROPOSAL` continua com
`requiresHumanApproval: true` e **nenhum** campo de execução.

## 5. APIs

Inalteradas em formato (Item 1):

- `POST /api/v1/agent-runs`: corpo agora exige `dag` semântico;
- `GET /api/v1/agent-runs/:id`: reflete `nodeStatesJson`, `stepsUsed`, `costUsed`;
- `POST /api/v1/agent-runs/:id/cancel`: igual ao Item 1.

`requestedBy` continua vindo do middleware, não do corpo.

## 6. Camadas (evolução aditiva)

Seguir o padrão Item 4/5/6/3.1:

- `src/domain/v1/models/agent-run/agent-run.ts` (expandir `AgentRun`, `AgentRunDag`)
- `src/domain/v1/models/agent-run/dag.ts` (tipos de nó, validação, topo-sort)
- `src/domain/v1/ports/agent-run-repository.ts` (adicionar `updateNodeStates`, `incrementSteps`, `incrementCost` ou equivalente; manter `transitionTo`)
- `src/adapters/prisma/agent-run/**` (migração de schema + repository)
- `src/application/agent-run/service.ts` (execução do DAG + orçamento)
- `src/app/api/v1/agent-runs/**` (mesmos arquivos do Item 1)
- `scripts/agent-run/**` (expandir testes)

Regras:
- serviço não chama LLM, não executa ordens, não toca `tradingAgentsService`;
- todo erro inesperado é sanitizado em `500` genérico.

## 7. Migração Prisma

**Aditiva**:
- nova migration `prisma/migrations/*add_agent_run_dag_foundation/migration.sql`
- `ALTER TABLE "AgentRun" ADD COLUMN "nodeStatesJson" TEXT;` etc., **OU**
  recriação aditiva conforme padrão do projeto (SQLite/Prisma aceita
  `ALTER TABLE ... ADD COLUMN` em migration; froma explicitamente que é
  aditiva e testada contra SQLite temporário).
- manter índices do Item 1; adicionar `@@index([status, updatedAt])`.

Não remova nenhuma coluna nem tabela do Item 1.

## 8. Testes obrigatórios

Harness `scripts/agent-run/` (expandir o existente) com SQLite temporário.

Cobertura mínima (acrescentar à do Item 1):

1. migration aditiva (ALTER ADD COLUMN permitido neste item; sem DROP);
2. `POST /agent-runs` com DAG semântico retorna `202 + runId`;
3. DAG com **ciclo** é rejeitado (400 INVALID_DAG);
4. DAG com **nó órfão**/aresta inválida é rejeitado (400);
5. DAG sem `OUTPUT` é rejeitado (400);
6. execução topológica: `nodeStatesJson` reflete ordem; `stepsUsed` correto;
7. orçamento: `maxSteps` estourado → `FAILED` com `errorJson`;
8. orçamento: `maxCost` estourado → `FAILED` com `errorJson`;
9. `timeoutMs` estourado → `FAILED` com `errorJson`;
10. `cancel` de `RUNNING` → `CANCELLED` (persiste);
11. `cancel` de terminal → 409;
12. saída `PROPOSAL` com `requiresHumanApproval: true` e sem campos de execução;
13. erro interno sanitizado;
14. `knowledgeTime <= decisionTime` mantido;
15. regressões: `test:reconciliation`, `test:dataset-feature`, `test:cvm-facts`,
    `test:market-bar`, `test:reference-data`, `smoke:auth`,
    `prisma validate`, `tsc --noEmit`, build Next.js em WSL.

## 9. Escopo permitido

- `prisma/schema.prisma` (aditivo em `AgentRun`)
- nova migration `prisma/migrations/*add_agent_run_dag_foundation/`
- `src/domain/v1/models/agent-run/**`
- `src/domain/v1/ports/agent-run-repository.ts`
- `src/adapters/prisma/agent-run/**`
- `src/application/agent-run/**`
- `src/app/api/v1/agent-runs/**`
- `scripts/agent-run/**`
- `package.json`: manter `test:agent-run`
- `docs/architecture/phase-3-item-2-agent-run-dag.md`

## 10. Escopo proibido

- `docs/CODEX_HANDOFF.md`;
- alterar `tradingAgentsService`, `MLPredictionsTab`, `src/app/api/agents/**`;
- conectar a `ExecutionBroker`/ordens reais;
- qualquer endpoint de escrita financeira;
- `Float`/`Decimal` em verdades;
- banco real, MT5, rede ou trading;
- remover colunas/tabelas do Item 1.

## 11. Decisões de arquitetura

1. `runId` no servidor; cliente não define identidade.
2. Sem lookahead: `knowledgeTime <= decisionTime`.
3. LLM produz opinião/proposta; aprovação humana é gate.
4. Execução do DAG é determinística e simulada (sem LLM real),
   mas o encadeamento, o orçamento e o cancelamento são reais.
5. Legado de agentes permanece 100% operacional.
6. Trilha de auditoria: `nodeStatesJson`, `stepsUsed`, `costUsed` e
   `status` persistidos a cada transição.

## Critério de aceitação do Item 2 (Fase 3)

1. `POST /agent-runs` aceita DAG semântico e retorna `202 + runId`;
2. DAG inválido (ciclo/órfão/sem OUTPUT) é rejeitado com 400;
3. execução topológica real com `nodeStatesJson`/`stepsUsed`/`costUsed`;
4. orçamento (`maxSteps`/`maxCost`/`timeoutMs`) leva a `FAILED` explícito;
5. cancelamento respeita regra de estado;
6. `PROPOSAL` nunca gera ordem ou campo de execução;
7. nenhum legado alterado;
8. builds/regressões aprovados em WSL e Windows.
