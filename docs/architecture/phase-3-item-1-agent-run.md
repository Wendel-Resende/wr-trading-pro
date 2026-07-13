# Fase 3 / Item 1 — `AgentRun` assíncrono persistente

Status: **especificação para implementação aditiva e não destrutiva**.
Sem execução financeira, sem `execute_order`, sem exposição de segredos.

## Problema

A Fase 1 já estabeleceu o fluxo canônico
`TradeProposal → RiskDecision → HumanApprovalReceipt → KillSwitchSnapshot → OrderIntent → ExecutionResult`
e um `ExecutionBroker` desabilitado. A Fase 2 entregou dados point-in-time.

Agora precisamos de um **runtime profissional de agentes** que:
- aceite pedidos de análise/pesquisa de forma assíncrona;
- persista o ciclo de vida da corrida (`AgentRun`);
- exponha DAG explícito, orçamento e cancelamento;
- produza contratos estruturados (pesquisa/proposta), nunca comando executável;
- exija aprovação humana antes de qualquer intenção de execução;
- mantenha trilha de auditoria reproduzível.

## Objetivo

Adicionar a fundação do runtime de agentes:
- modelo `AgentRun` persistente;
- port `AgentRunRepository` e `AgentRunService`;
- endpoint `POST /api/v1/agent-runs` que retorna `202 + runId`;
- endpoint `GET /api/v1/agent-runs/:id` para consulta point-in-time;
- cancelamento `POST /api/v1/agent-runs/:id/cancel`;
- sem nenhuma ponte para `ExecutionBroker`/ordens reais.

## Princípios fixos

- **Sem lookahead**: `knowledgeTime <= decisionTime` quando houver eixo de tempo.
- **Sem float canônico**: contagens/ids exatos; sem `Decimal`/`Float` em verdades.
- **Identidade canônica**: `runId` gerado no servidor, não pelo cliente.
- **Aprovação humana obrigatória** antes de `OrderIntent`.
- **LLM não executa**: agente produz `ResearchFinding`/`TradeProposal`, nunca ordem.
- **Nenhuma escrita em legado**, nenhuma alteração de `MLPredictionsTab`,
  `tradingAgentsService`, rotas de agentes existentes ou `python/agents`.
- **Sem banco real, MT5, rede ou trading**.
- **`docs/CODEX_HANDOFF.md` não tocado**.

## 1. Modelo `AgentRun`

Campos sugeridos:

- `runId`: `String @id @default(cuid())`
- `requestedBy`: `String` (identidade da sessão autenticada; derivado do middleware)
- `kind`: `enum AgentRunKind { RESEARCH | PROPOSAL }`
- `status`: `enum AgentRunStatus { QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED }`
- `dag`: `String` (JSON do DAG explícito: nós, arestas, entradas/saídas)
- `inputJson`: `String` (payload de entrada serializado, validado por Zod)
- `budgetJson`: `String` (orçamento: passos máximos, custo LLM estimado, timeout)
- `outputJson`: `String?` (contrato estruturado de saída; ausente até SUCCEEDED)
- `errorJson`: `String?`
- `decisionTime`: `DateTime` (fornecido pelo chamador; eixo externo)
- `knowledgeTime`: `DateTime` (derivado/servidor; `knowledgeTime <= decisionTime`)
- `createdAt`: `DateTime @default(now())`
- `updatedAt`: `DateTime @updatedAt`
- `finishedAt`: `DateTime?`

Regras:
- transições de estado são determinísticas e validadas (`QUEUED → RUNNING → SUCCEEDED | FAILED | CANCELLED`);
- `CANCELLED` só é aceito de `QUEUED`/`RUNNING`;
- `outputJson` só é definido em `SUCCEEDED`;
- `errorJson` só em `FAILED`.

Índices:
- `@@index([status, createdAt])`
- `@@index([requestedBy, createdAt])`
- `@@index([decisionTime, knowledgeTime])`

## 2. Contratos de saída (sem execução)

`outputJson` deve conter um dos contratos:

```ts
type ResearchFinding = {
  readonly kind: 'RESEARCH';
  readonly thesis: string;
  readonly evidence: readonly { source: string; reference: string; asOf: string }[];
  readonly risks: readonly string[];
  readonly confidence: number; // 0..1, validado
  readonly decisionTime: string;
  readonly invalidation: string;
};

type TradeProposal = {
  readonly kind: 'PROPOSAL';
  readonly instrumentId: string;
  readonly direction: 'BUY' | 'SELL' | 'HOLD';
  readonly rationale: string;
  readonly risks: readonly string[];
  readonly confidence: number;
  readonly decisionTime: string;
  readonly requiresHumanApproval: true;
};
```

Nunca: `executionOrder`, `OrderIntent`, `ticket`, `side: string` solto, ou qualquer campo que o `ExecutionBroker` consuma diretamente.

## 3. APIs

### 3.1 `POST /api/v1/agent-runs`

Corpo (Zod `.strict()`):
```ts
{
  readonly kind: 'RESEARCH' | 'PROPOSAL';
  readonly dag: { nodes: string[]; edges: [string, string][] };
  readonly input: Record<string, unknown>;
  readonly budget?: { maxSteps?: number; maxCost?: number; timeoutMs?: number };
  readonly decisionTime: string; // ISO-8601 com offset
}
```

Resposta: `202 Accepted`
```ts
{ success: true, data: { runId: string; status: 'QUEUED'; poll: `/api/v1/agent-runs/${runId}` } }
```

- `knowledgeTime` é derivado no servidor (agora) e validado contra `decisionTime`;
- `requestedBy` vem do middleware de autenticação (não do corpo);
- `kind=PROPOSAL` marca `requiresHumanApproval: true` na saída futura, mas **não** cria `OrderIntent`.

### 3.2 `GET /api/v1/agent-runs/:id`

Resposta: estado atual do `AgentRun` (sem vazar `errorJson` bruto de driver; sanitizado).

### 3.3 `POST /api/v1/agent-runs/:id/cancel`

Apenas `QUEUED`/`RUNNING` podem ser cancelados. Retorna `200` com status `CANCELLED`.

## 4. Camadas

Seguir o padrão Item 4/5/6:

- `src/domain/v1/models/agent-run.ts`
- `src/domain/v1/ports/agent-run-repository.ts`
- `src/adapters/prisma/agent-run/**`
- `src/application/agent-run/**`
- `src/app/api/v1/agent-runs/route.ts`
- `src/app/api/v1/agent-runs/[id]/route.ts`
- `src/app/api/v1/agent-runs/[id]/cancel/route.ts`

Regras:
- serviço não chama LLM, não executa ordens, não toca `tradingAgentsService`;
- o "processamento" deste item é **simulado e determinístico** (substitui por no-op quetransiciona `QUEUED → RUNNING → SUCCEEDED` com contratofixo de exemplo), para permitir teste de ciclo de vida sem LLM real;
- todo erro inesperado é sanitizado em `500` genérico.

## 5. Testes obrigatórios

Harness `scripts/agent-run/` com SQLite temporário.

Cobertura mínima:

1. migration aditiva sem `ALTER`/`DROP`;
2. `POST /agent-runs` retorna `202 + runId` e status `QUEUED`;
3. `GET /agent-runs/:id` reflete transições `QUEUED → RUNNING → SUCCEEDED`;
4. `knowledgeTime` derivado não pode exceder `decisionTime`;
5. `cancel` de `QUEUED`/`RUNNING` resulta em `CANCELLED`;
6. `cancel` de `SUCCEEDED`/`FAILED`/`CANCELLED` é rejeitado (409);
7. saída `PROPOSAL` carrega `requiresHumanApproval: true` e **nenhum** campo de execução;
8. erro interno sanitizado (sem SQL/stack/Prisma);
9. paginação/ordenação determinística em listagem;
10. regressões: `test:reconciliation`, `test:dataset-feature`, `test:cvm-facts`,
    `test:market-bar`, `test:reference-data`, `smoke:auth`,
    `prisma validate`, `tsc --noEmit`, build Next.js em WSL.

## 6. Escopo permitido

- `prisma/schema.prisma` apenas com novo modelo `AgentRun`;
- nova migration `prisma/migrations/*add_agent_run_foundation/migration.sql`;
- `src/domain/v1/models/agent-run.ts`, `src/domain/v1/ports/agent-run-repository.ts`;
- `src/adapters/prisma/agent-run/**`;
- `src/application/agent-run/**`;
- `src/app/api/v1/agent-runs/**`;
- `scripts/agent-run/**`;
- `package.json`: `test:agent-run`;
- `docs/architecture/phase-3-item-1-agent-run.md`.

## 7. Escopo proibido

- `docs/CODEX_HANDOFF.md`;
- alterar `tradingAgentsService`, `MLPredictionsTab`, rotas `src/app/api/agents/**`;
- conectar a `ExecutionBroker`/ordens reais;
- qualquer endpoint de escrita financeira;
- `Float`/`Decimal` em verdades;
- banco real, MT5, rede ou trading.

## 8. Decisões de arquitetura

1. `runId` no servidor; cliente não define identidade.
2. Sem lookahead: `knowledgeTime <= decisionTime`.
3. LLM produz opinião/proposta; aprovação humana é gate.
4. Processamento deste item é simulado/determinístico (sem LLM real).
5. Legado de agentes permanece 100% operacional.
6. Trilha de auditoria: cada transição persistida com `status`, `updatedAt`, `knowledgeTime`.

## Critério de aceitação do Item 1 (Fase 3)

1. `POST /agent-runs` retorna `202 + runId`;
2. ciclo de vida completo testado (QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED);
3. `PROPOSAL` nunca gera ordem ou campo de execução;
4. cancelamento respeita regra de estado;
5. nenhum legado alterado;
6. builds/regressões aprovados em WSL e Windows.
