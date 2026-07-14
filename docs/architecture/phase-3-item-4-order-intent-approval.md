# Fase 3 / Item 4 — Aprovação humana + `idempotency key` (gate de execução)

Status: **especificação para implementação aditiva e não destrutiva** do
Item 3. Sem execução financeira, sem `execute_order`, sem exposição de
segredos. Codificação a cargo do **Claude Code (modelo Sonnet 5)** no
Windows; revisão e testes pelo Guardião_Hermes em WSL + Windows.

> INSTRUÇÃO DE CODIFICAÇÃO: usar o modelo **Sonnet 5** no Claude Code
> (Windows). O repositório em Windows é
> `C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_`.
> Antes de iniciar: `git checkout main && git pull origin main`
> (a spec já está no main). Não alterar itens anteriores (Fase 2, Item 1, 2, 3).

## Problema

O Item 3 entregou o motor `RiskPolicy` determinístico: recebe o
`TradeProposal` (saída do `AgentRun` do Item 2) e decide `APPROVED`/`REJECTED`,
persistindo cada avaliação em um ledger `RiskDecision` (append-only,
auditável). Mas ainda **não existe o elo entre decisão de risco aprovada e
intenção de execução**: não há aprovação humana explícita, nem proteção contra
duplicação de intenção por reenvio.

O dossiê (seção 6, Fase 3) exige: "Execução real exige **aprovação humana +
idempotency key**". O fluxo canônico do dossiê é
`TradeProposal → RiskDecision → HumanApprovalReceipt → KillSwitchSnapshot → OrderIntent → ExecutionResult`.

Para um runtime profissional, o Item 4 introduz:

1. **`HumanApprovalReceipt`**: registro imutável de quem aprovou, quando, e
   vinculado ao `RiskDecision` aprovado. Só pode ser criado se o
   `RiskDecision` for `APPROVED` e o kill switch estiver habilitado.
2. **`OrderIntent`**: criado **somente após** `HumanApprovalReceipt` + `idempotency key`.
   Aponta para o `RiskDecision` aprovado; **não executa** — `ExecutionBroker`
   continua desabilitado (igual Fase 1). É apenas a *intenção* auditável.
3. **Idempotency key**: fornecida pelo chamador, persistida e única; reenvios
   com a mesma chave retornam a `OrderIntent` já existente (não duplicam).
4. **Kill switch `WR_TRADING_ENABLED`**: gate de criação — `OrderIntent` só é
   criado se `tradingEnabled === true`.

Aprovação humana + idempotency key são o **gate de execução**: nada além
disso toca ordens reais neste item.

## Objetivo

Adicionar o elo de aprovação humana e idempotência entre o `RiskDecision`
(aprovado pelo Item 3) e a `OrderIntent` (intenção auditável, não executada).
Sem ponte para `ExecutionBroker`/ordens reais.

## Princípios fixos

- **Sem LLM**: todo o fluxo é determinístico; `OrderIntent` nunca é gerado
  por LLM, apenas materializado a partir de `RiskDecision` aprovado + aprovação
  humana.
- **Kill switch é gate de criação**: `WR_TRADING_ENABLED !== 'true'` →
  `OrderIntent` não é criado (`REJECTED`/409 conforme seção 4).
- **Aprovação humana é obrigatória**: `OrderIntent` exige `HumanApprovalReceipt`
  válido vinculado ao `decisionId`.
- **Idempotency key**: fornecida pelo chamador; persistida com unicidade;
  retry com mesma chave é idempotente (retorna a intent existente, status 200,
  sem recriar).
- **Sem lookahead**: `knowledgeTime <= decisionTime` quando houver eixo de tempo.
- **Sem float canônico em verdades**: ids/contagens exatos; `quantity` é
  entrada do chamador (número validado por Zod), não verdade canônica.
- **Identidade canônica**: `intentId` e `approvalId` gerados no servidor.
- **Nenhuma escrita em legado**, nenhuma alteração de `MLPredictionsTab`,
  `tradingAgentsService`, rotas de agentes existentes ou `python/agents`.
- **Sem banco real, MT5, rede ou trading**: `ExecutionBroker` permanece
  desabilitado; `OrderIntent` é apenas intenção persistida.
- **`docs/CODEX_HANDOFF.md` não tocado**.

## 1. Contratos de entrada (reutilizados)

`RiskDecision` (Item 3, `src/domain/v1/models/risk-policy`):

```ts
interface RiskDecision {
  readonly decisionId: string;       // id canônico do ledger de risco
  readonly runId: string;
  readonly requestedBy: string;
  readonly instrumentId: string;
  readonly direction: 'BUY' | 'SELL' | 'HOLD';
  readonly outcome: 'APPROVED' | 'REJECTED';
  readonly reasons: readonly RiskDecisionReasonCode[];
  readonly policyVersion: string;
  readonly proposalJson: string;
  readonly contextJson: string;
  readonly policySnapshotJson: string | null;
  readonly decisionTime: string;
  readonly knowledgeTime: string;
  readonly evaluatedAt: string;
}
```

O Item 4 consome um `RiskDecision` cujo `outcome === 'APPROVED'`. Um
`RiskDecision` `REJECTED` (ou `HOLD` classificado como `APPROVED`
`NO_ACTIONABLE_DIRECTION`) **não gera `OrderIntent`** — `HOLD` não é ação
executável (ver regra R4).

## 2. Modelos de domínio (Item 4)

### 2.1 `HumanApprovalReceipt`

```ts
interface HumanApprovalReceipt {
  readonly approvalId: string;        // cuid, gerado no servidor
  readonly decisionId: string;        // RiskDecision aprovado vinculado
  readonly approvedBy: string;        // identidade da sessão (middleware)
  readonly approvedAt: string;        // ISO-8601
  readonly policyVersion: string;    // copiado do RiskDecision
  readonly decisionOutcome: 'APPROVED';
  readonly createdAt: string;
}
```

### 2.2 `OrderIntent`

```ts
type OrderIntentStatus = 'CREATED' | 'CANCELLED';

interface OrderIntent {
  readonly intentId: string;          // cuid, gerado no servidor
  readonly decisionId: string;        // RiskDecision de origem
  readonly approvalId: string;        // HumanApprovalReceipt vinculado
  readonly idempotencyKey: string;    // fornecido pelo chamador; único
  readonly requestedBy: string;       // quem requisitou a intenção (middleware)
  readonly approvedBy: string;        // quem aprovou
  readonly instrumentId: string;
  readonly direction: 'BUY' | 'SELL'; // só ações executáveis (não HOLD)
  readonly quantity: number;          // entrada do chamador (>= 1)
  readonly status: OrderIntentStatus;
  readonly policyVersion: string;
  readonly decisionTime: string;     // herdado do RiskDecision
  readonly knowledgeTime: string;     // herdado do RiskDecision
  readonly createdAt: string;
  readonly cancelledAt: string | null;
}
```

## 3. Camadas (evolução aditiva)

Seguir o padrão Item 1/2/3:

- `src/domain/v1/models/order-intent/order-intent.ts`
  (`HumanApprovalReceipt`, `OrderIntent`, `OrderIntentStatus`,
  `createOrderIntent` puro, `resolveApprovalFromDecision` puro).
- `src/domain/v1/ports/order-intent-repository.ts`
  (`saveApproval`, `saveIntent`, `findIntentByKey`,
  `findIntentById`, `findIntentsByDecisionId`, `cancelIntent`).
- `src/adapters/prisma/order-intent/**` (migration + repository + Zod schemas).
- `src/application/order-intent/service.ts`
  (orquestra: validar RiskDecision → aprovar → criar intent idempotente →
  persistir; kill switch injetado).
- `src/app/api/v1/order-intents/route.ts` (`POST`, `GET ?decisionId=`).
- `src/app/api/v1/order-intents/[id]/route.ts` (`GET`, `POST /cancel`).
- `scripts/order-intent/**` (harness SQLite temporário).

Regras:
- serviço não chama LLM, não executa ordens, não toca `tradingAgentsService`;
- `ExecutionBroker` **não** é referenciado; `OrderIntent` é apenas intenção;
- todo erro inesperado é sanitizado em `500` genérico;
- `decisionId`/`approvalId` são referências string (sem FK rígida do Prisma)
  para não acoplar migrations de itens anteriores.

## 4. Regras do serviço (determinísticas, ordem fixa)

`OrderIntentService.create(input, config)` onde
`config = { tradingEnabled: boolean; policyVersion: string }`
(`config.tradingEnabled` injetado do adapter a partir de
`process.env.WR_TRADING_ENABLED === 'true'`, igual Item 3):

**R1 — KILL_SWITCH**: se `config.tradingEnabled === false` →
`409 CONFLICT` com `ReadModelError('TRADING_DISABLED', ...)`. Gate de criação.

**R2 — DECISION_REQUIRED**: `input.decisionId` deve existir (consulta o
`RiskDecision` via `RiskPolicyRepository` ou port injetado). Se não existir →
`404 RISK_DECISION_NOT_FOUND`.

**R3 — DECISION_NOT_APPROVED**: se `RiskDecision.outcome !== 'APPROVED'` →
`409 DECISION_NOT_APPROVED`. (Inclui `REJECTED` e `HOLD`/`NO_ACTIONABLE_DIRECTION`.)

**R4 — HOLD_NOT_ACTIONABLE**: mesmo que o `RiskDecision` venha como `APPROVED`
`NO_ACTIONABLE_DIRECTION` (direction `HOLD`), ele **não gera** `OrderIntent`
→ `409 DECISION_NOT_ACTIONABLE` (HOLD não é ordem). `OrderIntent.direction`
só aceita `BUY`/`SELL`.

**R5 — IDEMPOTENCY**: `input.idempotencyKey` é obrigatório (Zod). Se já existe
`OrderIntent` com essa chave → retorna a intent existente (status `CREATED` ou
`CANCELLED`) com `200` e `replayed: true`, **sem recriar**. Unicidade
garantida no repositório (índice único em `idempotencyKey`).

**R6 — APPROVAL**: cria `HumanApprovalReceipt` vinculado ao `decisionId`
(`approvedBy` = `input.approvedBy` do middleware), `approvalId` server-side.

**R7 — INTENT_CREATED**: cria `OrderIntent` com `intentId` server-side,
`status: 'CREATED'`, copiando `instrumentId`, `direction`, `quantity`,
`policyVersion`, `decisionTime`, `knowledgeTime` do `RiskDecision`/entrada.
Retorna `201 Created` com `replayed: false`.

**Cancelamento** (`POST /order-intents/:id/cancel`):
- `CANCELLED` só de `CREATED`; `CANCELLED` já cancelado ou inexistente → `409`
  (`INTENT_NOT_CANCELABLE` / `ORDER_INTENT_NOT_FOUND`).
- persiste `cancelledAt`; não toca execução.

## 5. `config` e kill switch

- Núcleo não lê `process.env`; `config.tradingEnabled` injetado pelo adapter
  (`resolveOrderIntentConfigFromEnv`), igual Item 3.
- Em testes, injeta `tradingEnabled = false` para exercitar R1.

## 6. Migração Prisma

**Aditiva** — novos modelos `HumanApprovalReceipt` e `OrderIntent`:

```prisma
model HumanApprovalReceipt {
  approvalId     String   @id @default(cuid())
  decisionId     String
  approvedBy     String
  approvedAt     DateTime
  policyVersion  String
  decisionOutcome String // APPROVED
  createdAt      DateTime @default(now())

  @@index([decisionId])
  @@index([approvedBy, createdAt])
}

model OrderIntent {
  intentId        String   @id @default(cuid())
  decisionId      String
  approvalId      String
  idempotencyKey  String   @unique
  requestedBy     String
  approvedBy      String
  instrumentId    String
  direction       String // BUY | SELL
  quantity        Int
  status          String // CREATED | CANCELLED
  policyVersion   String
  decisionTime    DateTime
  knowledgeTime   DateTime
  createdAt       DateTime @default(now())
  cancelledAt     DateTime?

  @@index([decisionId])
  @@index([approvalId])
  @@index([requestedBy, createdAt])
  @@index([status, createdAt])
}
```

- nova migration `prisma/migrations/*add_order_intent_approval/migration.sql`;
- **não** remove nenhuma coluna/tabela de itens anteriores;
- testada contra SQLite temporário no harness.

## 7. APIs

### 7.1 `POST /api/v1/order-intents`

Corpo (Zod `.strict()`):

```ts
{
  readonly decisionId: string;
  readonly idempotencyKey: string;     // obrigatório
  readonly quantity: number;           // >= 1 (apenas para BUY/SELL)
  readonly decisionTime: string;       // ISO-8601 com offset (herdado/validado)
}
```

Respostas:
- `201 Created` (nova intent):
  ```ts
  { success: true, replayed: false,
    data: { intentId, decisionId, approvalId, status, direction, quantity, idempotencyKey } }
  ```
- `200 OK` (replay idempotente — mesma `idempotencyKey`):
  ```ts
  { success: true, replayed: true,
    data: { intentId, decisionId, approvalId, status, direction, quantity, idempotencyKey } }
  ```
- `409` para R1 (`TRADING_DISABLED`), R3 (`DECISION_NOT_APPROVED`),
  R4 (`DECISION_NOT_ACTIONABLE`).
- `404` para R2 (`RISK_DECISION_NOT_FOUND`).
- `400` corpo inválido (Zod) → `INVALID_BODY`.

Regras:
- `approvedBy` e `requestedBy` vêm do middleware (não do corpo);
- `direction` é derivado do `RiskDecision` (não do corpo) — o corpo não pode
  alterar a direção aprovada;
- `knowledgeTime` herdado do `RiskDecision` (`knowledgeTime <= decisionTime`).

### 7.2 `GET /api/v1/order-intents/:id`

Estado da `OrderIntent` (sanitizado). `404` se inexistente.

### 7.3 `POST /api/v1/order-intents/:id/cancel`

Cancelamento (R8). `200` com `status: 'CANCELLED'`; `409` se não cancelável.

### 7.4 `GET /api/v1/order-intents?decisionId=`

Listagem determinística (ordena por `createdAt` asc) das intents de um
`decisionId`. `400` se `decisionId` ausente.

## 8. Testes obrigatórios

Harness `scripts/order-intent/` com SQLite temporário.

Cobertura mínima:

1. migration aditiva (modelos `HumanApprovalReceipt` + `OrderIntent`) sem
   `DROP`/`ALTER` destrutivo;
2. kill switch desligado → `409 TRADING_DISABLED` (R1);
3. `decisionId` inexistente → `404 RISK_DECISION_NOT_FOUND` (R2);
4. `RiskDecision` `REJECTED` → `409 DECISION_NOT_APPROVED` (R3);
5. `RiskDecision` `HOLD`/`NO_ACTIONABLE_DIRECTION` → `409 DECISION_NOT_ACTIONABLE` (R4);
6. criação com `APPROVED` BUY/SELL → `201` + `HumanApprovalReceipt` + `OrderIntent`;
7. **idempotency**: mesmo `idempotencyKey` reenviado → `200 replayed:true`,
   **não** cria segunda intent (contagem = 1) (R5);
8. `direction` é herdado do `RiskDecision`, não do corpo (corpo não influencia);
9. `knowledgeTime <= decisionTime` herdado do `RiskDecision`;
10. `GET /order-intents/:id` reflete o estado; `GET ?decisionId=` determinístico;
11. cancelamento de `CREATED` → `CANCELLED`; re-cancelar → `409`;
12. erro interno sanitizado (`500` genérico);
13. Zod `.strict()` rejeita campo extra (`400 INVALID_BODY`);
14. regressões: `test:risk-policy`, `test:agent-run`, `test:reconciliation`,
    `test:dataset-feature`, `test:cvm-facts`, `test:market-bar`,
    `test:reference-data`, `smoke:auth`, `prisma validate`, `tsc --noEmit`,
    build Next.js em WSL+Windows.

## 9. Escopo permitido

- `prisma/schema.prisma` (modelos `HumanApprovalReceipt` + `OrderIntent` aditivos);
- nova migration `prisma/migrations/*add_order_intent_approval/`;
- `src/domain/v1/models/order-intent/**`;
- `src/domain/v1/ports/order-intent-repository.ts`;
- `src/adapters/prisma/order-intent/**`;
- `src/application/order-intent/**`;
- `src/app/api/v1/order-intents/**`;
- `scripts/order-intent/**`;
- `package.json`: manter `test:order-intent`;
- `docs/architecture/phase-3-item-4-order-intent-approval.md`.

## 10. Escopo proibido

- `docs/CODEX_HANDOFF.md`;
- alterar `tradingAgentsService`, `MLPredictionsTab`, `src/app/api/agents/**`;
- conectar a `ExecutionBroker`/ordens reais; qualquer função de envio de ordem;
- qualquer endpoint de escrita financeira além da intenção auditável;
- `Float`/`Decimal` em verdades (ids/contagens exatos);
- banco real, MT5, rede ou trading;
- remover colunas/tabelas de itens anteriores (Fase 2, Item 1, 2, 3).

## 11. Decisões de arquitetura

1. `OrderIntent` é **intenção auditável**, nunca ordem executada.
2. Kill switch `WR_TRADING_ENABLED` é gate de criação (R1).
3. Aprovação humana é obrigatória e imutável (`HumanApprovalReceipt`).
4. Idempotency key garante que reenvios não duplicam intents (R5).
5. `direction`/`instrumentId`/`quantity` derivam do `RiskDecision` aprovado;
   o corpo não pode alterá-los (integridade da aprovação).
6. `HOLD` não gera intent (não é ação executável).
7. Legado de agentes permanece 100% operacional.
8. Trilha de auditoria: `approvalId`, `intentId`, `idempotencyKey`,
   `decisionId`, `policyVersion`, `createdAt` persistidos.

## Critério de aceitação do Item 4 (Fase 3)

1. `POST /order-intents` cria `HumanApprovalReceipt` + `OrderIntent` a partir
   de `RiskDecision` `APPROVED` (BUY/SELL);
2. kill switch desligado → `409 TRADING_DISABLED`;
3. `RiskDecision` `REJECTED` ou `HOLD` → rejeitado (`409`);
4. `idempotency key` torna reenvios idempotentes (sem duplicar);
5. cancelamento respeita regra de estado;
6. `OrderIntent` nunca executa ordem real;
7. nenhum legado alterado;
8. builds/regressões aprovados em WSL e Windows.
