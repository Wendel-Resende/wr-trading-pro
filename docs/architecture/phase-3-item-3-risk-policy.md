# Fase 3 / Item 3 — Motor de `RiskPolicy` determinístico

Status: **especificação para implementação aditiva e não destrutiva** do
Item 2. Sem execução financeira, sem `execute_order`, sem exposição de
segredos. Codificação a cargo do **Claude Code (modelo Sonnet 5)** no
Windows; revisão e testes pelo Guardião_Hermes em WSL + Windows.

> INSTRUÇÃO DE CODIFICAÇÃO: usar o modelo **Sonnet 5** no Claude Code
> (Windows). O repositório é clonado em WSL em `/root/wr-trading-pro-clone`;
> o Claude Code deve `git pull` antes de iniciar e `git push` após
> implementação + testes. Não alterar itens anteriores (Fase 2, Item 1, Item 2).

## Problema

O Item 2 entregou a execução determinística do DAG e produz, para `kind=PROPOSAL`,
um `TradeProposal` estruturado (`requiresHumanApproval: true`, sem campos de
execução). Mas ainda **não existe barreira de risco** entre a proposta e
qualquer intenção de execução futura. O dossiê (seção 6, Fase 3) exige:
"Agentes produzem pesquisa/propostas; **políticas determinísticas
aprovam/rejeitam**".

Para um runtime profissional, precisamos de um motor `RiskPolicy`:

1. **Determinístico e auditável**: regras fixas, sem LLM; cada decisão é
   registrada em um ledger (`RiskDecision`) com snapshot da política e do
   contexto.
2. **Kill switch global** `WR_TRADING_ENABLED`: se desligado, toda proposta é
   rejeitada (gate de segurança independente do LLM).
3. **Allowlist de instrumentos**: só instrumentos autorizados podem gerar
   intenção.
4. **Limites de posição/concentração**: a posição resultante não pode exceder
   teto de concentração da carteira.
5. **Notional máximo**: `referencePrice × proposedQuantity` não pode exceder
   teto.
6. **Máximo de propostas por run**: limita o número de propostas avaliadas
   por `AgentRun`.

Aprovação humana + `idempotency key` ficam no **Item 4** (fora do escopo aqui).

## Objetivo

Adicionar o motor `RiskPolicy` que recebe um `TradeProposal` (saída do
`AgentRun` do Item 2) mais um contexto de avaliação e decide `APPROVED` /
`REJECTED` com razões explícitas, persistindo cada decisão em um ledger de
auditoria. Sem ponte para `ExecutionBroker`/ordens reais.

## Princípios fixos

- **Sem LLM**: o motor é puro determinístico (função de `proposal + context + policy`).
- **Kill switch é gate global**: `WR_TRADING_ENABLED !== 'true'` → `REJECTED`.
- **Sem lookahead**: `knowledgeTime <= decisionTime`.
- **Sem float canônico em verdades**: ids/contagens exatos; `referencePrice`,
  `proposedQuantity`, `portfolioNav` são **entradas do chamador** (números
  validados por Zod), não verdades canônicas do sistema.
- **Identidade canônica**: `decisionId` gerado no servidor.
- **Aprovação humana fica no Item 4**: `RiskPolicy` só decide aprovar/rejeitar;
  não cria `OrderIntent`.
- **Nenhuma escrita em legado**, nenhuma alteração de `MLPredictionsTab`,
  `tradingAgentsService`, rotas de agentes existentes ou `python/agents`.
- **Sem banco real, MT5, rede ou trading**: o contexto de mercado/posição é
  fornecido explicitamente pelo chamador (no futuro virá do portfolio
  provider da Fase 1; aqui é input validado).
- **`docs/CODEX_HANDOFF.md` não tocado**.

## 1. Contrato de entrada — `TradeProposal` (do Item 2, reutilizado)

```ts
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

## 2. Contexto de avaliação — `RiskEvaluationContext`

Fornecido pelo chamador (validado por Zod `.strict()`). Não persiste como
tabela própria; é serializado no `RiskDecision` para auditoria.

```ts
interface RiskEvaluationContext {
  readonly referencePrice: number;        // preço de referência p/ notional (point-in-time)
  readonly proposedQuantity: number;      // quantidade proposta (lotes)
  readonly currentPositionQty: number;    // posição atual do instrumento (0 se sem)
  readonly portfolioNav: number;          // NAV total da carteira (p/ concentração)
  readonly limits: {
    readonly maxNotional: number;                       // teto de notional (R$)
    readonly maxPositionConcentrationPct: number;       // 0..100 (% NAV)
    readonly maxProposalsPerRun: number;                // inteiro >= 1
    readonly instrumentAllowlist: readonly string[];    // instrumentIds autorizados
  };
}
```

## 3. Saída — `RiskDecision`

```ts
type RiskDecisionOutcome = 'APPROVED' | 'REJECTED';

interface RiskDecision {
  readonly decisionId: string;            // cuid, gerado no servidor
  readonly runId: string;                 // referencia o AgentRun de origem
  readonly requestedBy: string;           // identidade da sessão (middleware)
  readonly instrumentId: string;
  readonly direction: 'BUY' | 'SELL' | 'HOLD';
  readonly outcome: RiskDecisionOutcome;
  readonly reasons: readonly string[];    // códigos de regra: KILL_SWITCH_DISABLED,
                                          // INSTRUMENT_NOT_ALLOWED, NO_ACTIONABLE_DIRECTION,
                                          // MAX_PROPOSALS_PER_RUN, NOTIONAL_EXCEEDS_MAX,
                                          // CONCENTRATION_EXCEEDS_MAX, OK
  readonly policyVersion: string;         // constante 'risk-policy/v1'
  readonly proposalJson: string;          // snapshot da proposta avaliada
  readonly contextJson: string;           // snapshot do contexto aplicado
  readonly policySnapshotJson: string?;   // snapshot das regras/limites aplicados
  readonly decisionTime: string;
  readonly knowledgeTime: string;
  readonly evaluatedAt: string;
}
```

## 4. Regras do motor (determinísticas, ordem fixa)

`RiskPolicyService.evaluate(proposal, context, config)` onde
`config = { tradingEnabled: boolean; policyVersion: string }`:

1. **KILL_SWITCH**: se `config.tradingEnabled === false` →
   `REJECTED` + `['KILL_SWITCH_DISABLED']`. Gate global.
2. **NO_ACTIONABLE_DIRECTION**: se `direction === 'HOLD'` →
   `APPROVED` + `['NO_ACTIONABLE_DIRECTION']` (HOLD não gera ordem; não
   exige aprovação humana, mas também não cria intenção).
3. **INSTRUMENT_ALLOWLIST**: se `instrumentId` não está em
   `context.limits.instrumentAllowlist` → `REJECTED` +
   `['INSTRUMENT_NOT_ALLOWED']`.
4. **MAX_PROPOSALS_PER_RUN**: se o número de `RiskDecision` já persistidos
   para este `runId` (com `outcome` qualquer) ≥
   `context.limits.maxProposalsPerRun` → `REJECTED` +
   `['MAX_PROPOSALS_PER_RUN']`.
5. **NOTIONAL_EXCEEDS_MAX**: se
   `referencePrice * proposedQuantity > maxNotional` →
   `REJECTED` + `['NOTIONAL_EXCEEDS_MAX']`.
6. **CONCENTRATION_EXCEEDS_MAX**: seja
   `postQty = currentPositionQty + proposedQuantity` (para BUY; para SELL
   usa `max(currentPositionQty - proposedQuantity, 0)`),
   `concentrationPct = (postQty * referencePrice / portfolioNav) * 100`;
   se `concentrationPct > maxPositionConcentrationPct` →
   `REJECTED` + `['CONCENTRATION_EXCEEDS_MAX']`.
7. **OK**: nenhuma regra acima disparou → `APPROVED` + `['OK']`.

Regras adicionais (validação de entrada, pré-regras):
- `maxProposalsPerRun` deve ser inteiro ≥ 1; `instrumentAllowlist` não vazia;
  `maxNotional > 0`; `maxPositionConcentrationPct` em (0, 100].
- `referencePrice`, `proposedQuantity`, `portfolioNav` devem ser finitos e ≥ 0
  (`proposedQuantity` ≥ 0; `referencePrice`, `portfolioNav` > 0 quando
  aplicável). Falha de validação → `400` (corpo inválido), não decisão.

Ordem de avaliação das regras é fixa (1→7); a primeira rejeição encerra e
registra apenas o código da regra que falhou (sem vazar outras). `APPROVED`
só ocorre se nenhuma regra 1–6 disparar.

## 5. `config` e kill switch

- O núcleo `RiskPolicyService` **não** lê `process.env` direto (testabilidade).
  `config.tradingEnabled` é injetado pelo adapter a partir de
  `process.env.WR_TRADING_ENABLED === 'true'`.
- Nos testes, injeta `tradingEnabled = false` para exercitar a regra 1.
- `policyVersion` é a constante `'risk-policy/v1'` (imutável neste item).

## 6. Camadas (evolução aditiva)

Seguir o padrão Item 1/2:

- `src/domain/v1/models/risk-policy/risk-policy.ts`
  (`RiskDecision`, `RiskEvaluationContext`, `RiskPolicyConfig`, códigos de
  regra, `evaluatePolicy` puro).
- `src/domain/v1/ports/risk-policy-repository.ts`
  (`saveDecision`, `countByRunId`, `findByDecisionId`, `findByRunId`
  ordenado por `evaluatedAt`).
- `src/adapters/prisma/risk-policy/**` (migration + repository).
- `src/application/risk-policy/service.ts`
  (`RiskPolicyService.evaluate` orquestra validação → `evaluatePolicy` →
  persistência do ledger).
- `src/app/api/v1/risk-policy/evaluate/route.ts`
  (`POST`, Zod `.strict()`, `requestedBy` do middleware).
- `src/app/api/v1/risk-policy/decisions/[id]/route.ts` (`GET` point-in-time).
- `src/app/api/v1/risk-policy/decisions/route.ts`
  (`GET ?runId=` determinístico por `evaluatedAt`).
- `scripts/risk-policy/**` (expandir harness com SQLite temporário).

Regras:
- serviço não chama LLM, não executa ordens, não toca `tradingAgentsService`;
- todo erro inesperado é sanitizado em `500` genérico;
- `RiskDecision.runId` é referência string (sem FK rígida) para não acoplar
  migrations de itens anteriores.

## 7. Migração Prisma

**Aditiva** — novo modelo `RiskDecision`:

```prisma
model RiskDecision {
  decisionId        String   @id @default(cuid())
  runId             String
  requestedBy       String
  instrumentId      String
  direction         String // BUY | SELL | HOLD
  outcome           String // APPROVED | REJECTED
  reasonsJson       String // JSON: string[]
  policyVersion     String
  proposalJson      String
  contextJson       String
  policySnapshotJson String?
  decisionTime      DateTime
  knowledgeTime     DateTime
  evaluatedAt       DateTime @default(now())

  @@index([runId, evaluatedAt])
  @@index([outcome, evaluatedAt])
  @@index([instrumentId, evaluatedAt])
}
```

- nova migration `prisma/migrations/*add_risk_decision_ledger/migration.sql`;
- **não** remove nenhuma coluna/tabela de itens anteriores;
- testada contra SQLite temporário no harness.

## 8. APIs

### 8.1 `POST /api/v1/risk-policy/evaluate`

Corpo (Zod `.strict()`):

```ts
{
  readonly runId: string;
  readonly proposal: TradeProposal;            // contrato do Item 2
  readonly context: RiskEvaluationContext;     // seção 2
  readonly decisionTime: string;               // ISO-8601 com offset
}
```

Resposta `200 OK`:

```ts
{
  success: true,
  data: {
    decisionId: string;
    runId: string;
    outcome: 'APPROVED' | 'REJECTED';
    reasons: readonly string[];
    policyVersion: string;
  }
}
```

- `knowledgeTime` derivado no servidor (agora) e validado contra
  `decisionTime` (`knowledgeTime <= decisionTime`);
- `requestedBy` vem do middleware de autenticação (não do corpo);
- corpo inválido (Zod) → `400` com `ReadModelError('INVALID_BODY', ...)`;
- `APPROVED` **não** cria `OrderIntent` (Item 4 cuidará disso).

### 8.2 `GET /api/v1/risk-policy/decisions/:id`

Estado do `RiskDecision` (sem vazar stack/SQL). `404` se inexistente.

### 8.3 `GET /api/v1/risk-policy/decisions?runId=`

Listagem determinística (ordena por `evaluatedAt` asc) das decisões de um
`runId`. `400` se `runId` ausente.

## 9. Testes obrigatórios

Harness `scripts/risk-policy/` com SQLite temporário.

Cobertura mínima:

1. migration aditiva (modelo `RiskDecision`) sem `DROP`/`ALTER` destrutivo;
2. `POST /risk-policy/evaluate` com `tradingEnabled=false` → `REJECTED`
   `KILL_SWITCH_DISABLED`;
3. instrument fora da allowlist → `REJECTED` `INSTRUMENT_NOT_ALLOWED`;
4. `direction=HOLD` → `APPROVED` `NO_ACTIONABLE_DIRECTION` (sem execução);
5. excede `maxProposalsPerRun` → `REJECTED` `MAX_PROPOSALS_PER_RUN`;
6. `referencePrice * proposedQuantity > maxNotional` → `REJECTED`
   `NOTIONAL_EXCEEDS_MAX`;
7. concentração pós-trade > teto → `REJECTED` `CONCENTRATION_EXCEEDS_MAX`;
8. todas as regras ok → `APPROVED` `['OK']`;
9. `RiskDecision` persistido (ledger) com `policyVersion`, `proposalJson`,
   `contextJson`, `reasons`;
10. `GET /decisions/:id` reflete o ledger; `GET ?runId=` determinístico;
11. erro interno sanitizado (`500` genérico);
12. Zod `.strict()` rejeita campo extra (`400`);
13. `knowledgeTime <= decisionTime` mantido;
14. regressões: `test:agent-run`, `test:reconciliation`, `test:dataset-feature`,
    `test:cvm-facts`, `test:market-bar`, `test:reference-data`, `smoke:auth`,
    `prisma validate`, `tsc --noEmit`, build Next.js em WSL.

## 10. Escopo permitido

- `prisma/schema.prisma` (modelo `RiskDecision` aditivo);
- nova migration `prisma/migrations/*add_risk_decision_ledger/`;
- `src/domain/v1/models/risk-policy/**`;
- `src/domain/v1/ports/risk-policy-repository.ts`;
- `src/adapters/prisma/risk-policy/**`;
- `src/application/risk-policy/**`;
- `src/app/api/v1/risk-policy/**`;
- `scripts/risk-policy/**`;
- `package.json`: manter `test:risk-policy`;
- `docs/architecture/phase-3-item-3-risk-policy.md`.

## 11. Escopo proibido

- `docs/CODEX_HANDOFF.md`;
- alterar `tradingAgentsService`, `MLPredictionsTab`, `src/app/api/agents/**`;
- conectar a `ExecutionBroker`/ordens reais;
- qualquer endpoint de escrita financeira;
- `Float`/`Decimal` em verdades (ids/contagens exatos);
- banco real, MT5, rede ou trading;
- remover colunas/tabelas de itens anteriores (Fase 2, Item 1, Item 2).

## 12. Decisões de arquitetura

1. `RiskPolicy` é puro/determinístico, sem LLM; apenas função de entradas.
2. Kill switch `WR_TRADING_ENABLED` é gate global — se desligado, toda
   proposta é `REJECTED`. Núcleo não lê env direto (injetado p/ teste).
3. Ledger de auditoria: toda avaliação persiste `RiskDecision` com snapshot
   da política e do contexto.
4. `HOLD` não gera ordem; tratado como `APPROVED` `NO_ACTIONABLE_DIRECTION`.
5. **Aprovação humana + `idempotency key` são Item 4** (fora do escopo).
6. Legado de agentes permanece 100% operacional.
7. Trilha de auditoria: `decisionId`, `runId`, `reasons`, `policyVersion`,
   `proposalJson`, `contextJson`, `evaluatedAt` persistidos.

## Critério de aceitação do Item 3 (Fase 3)

1. `POST /risk-policy/evaluate` decide `APPROVED`/`REJECTED` com razões;
2. kill switch desligado → `REJECTED` `KILL_SWITCH_DISABLED`;
3. allowlist, máx propostas por run, notional e concentração aplicados;
4. `HOLD` tratado como não-acionável (`APPROVED` sem execução);
5. todo `RiskDecision` persistido em ledger auditável;
6. nenhum legado alterado;
7. builds/regressões aprovados em WSL e Windows.
