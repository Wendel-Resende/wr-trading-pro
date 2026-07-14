# Fase 6 — Consolidação

Status: **especificação para consolidação aditiva e não destrutiva**. Não introduz
novas features de trading; finaliza a governança do que já existe (opções B3,
spread, ordens) sob os mesmos padrões das Fases 2–5 (repository tipado, point-in-time,
ledger de auditoria, determinism). Sem execução financeira, sem `ExecutionBroker`.

Esta spec é a continuação direta das Fases 2 (dados point-in-time), 3 (RiskPolicy),
4 (aprovação + idempotency), 5 (backtest/ML) e do runtime de agentes. O objetivo é
**governar** as superfícies de opções/spread que hoje batem direto em MT5 ao vivo
(`mt5Service.send`) ou em API Python (`http://localhost:5000/api/spread`), e eliminar
duplicações, sem quebrar as rotas/UI atuais.

---

## 1. Objetivo

1. **Repository governado** para o que é persistido em opções/spread (posições salvas,
   ordens de spread), usando `PrismaClient` tipado — substituindo acesso manual/fora de padrão.
2. **Desacoplar análise de fonte de dados**: a análise de opções/spread deve receber
   barras via `MarketBar` point-in-time (Fase 2) ou adapter injetado, não via
   `mt5Service.send` acoplado nem fetch direto a API Python espalhado no código.
3. **Remover implementações duplicadas** (ex.: sobreposição entre `spreadService` e
   `spreadOrderService`; qualquer lógica de cálculo duplicada).
4. **Testes de contrato**: schemas Zod estáveis para entradas/saídas de opções/spread.
5. **Replay de mercado**: estrategos de opções/spread reproduzíveis deterministicamente
   sobre `MarketBar` point-in-time (reutiliza Fase 2), sem MT5 ao vivo.
6. **Trilha de auditoria (gate de release)**: ledger para ações de opções/spread
   (criar/cancelar), reutilizando o padrão `RiskDecision`/`OrderIntent`.

---

## 2. Princípios (NÃO NEGOCIÁVEIS)

1. **ADITIVO.** Não remova funcionalidade de `optionsService.ts`, `spreadService.ts`,
   `spreadOrderService.ts` nem das rotas `api/spread-orders`, `api/volatility`,
   `api/stock-alerts` etc. O novo código vive em `src/domain/v1/models/option-*`,
   `src/adapters/prisma/option-*`, `src/application/option-*` seguindo o padrão das
   Fases 3–5. Rotas/UI continuam funcionando.
2. **SEM EXECUÇÃO.** Nada nesta fase envia ordem real. `ExecutionBroker` continua
   desabilitado (Fases 1–5). Se houver cancelamento de ordem de spread, ele segue o
   fluxo já existente (`/api/spread-orders` + `WR_TRADING_ENABLED`); o ledger apenas
   **registra** a intenção, não a executa.
3. **POINT-IN-TIME.** Replay e análise consomem `MarketBar`/`CvmFact` com
   `knowledgeTime <= t` (Fase 2). Nunca olhe o futuro (CR-9).
4. **SEM LLM DECIDINDO TRADE.** Mantido.
5. **NÃO TOQUE** `tradingAgentsService`, `MLPredictionsTab`, `src/app/api/agents/**`,
   nem `docs/CODEX_HANDOFF.md` (deixe exatamente como está, fora de qualquer commit).
6. **REUTILIZE** `read-models-v1`, `feature-value`, `dataset-snapshot` (Fase 2) e os
   ports/repositories das Fases 3–5 como base de padrão.
7. **NÃO ALTERE** o padrão Next.js servidor + Electron, nem `output: 'export'`.

---

## 3. Modelos de domínio (aditivos — Prisma, CREATE TABLE/INDEX)

Criar conforme fizer sentido persistir (o Claude deve mapear o que hoje é estado
volátil vs. o que deve ser persistido/auditado):

```prisma
model OptionPosition {
  id            String   @id @default(cuid())
  instrumentId  String
  kind          String   // CALL | PUT
  strike        Int      // em centavos (ScaledDecimal reutilizado se preferir)
  expiration    DateTime
  side          String   // LONG | SHORT
  quantity      Int
  source        String   // 'MT5' | 'MANUAL' | 'REPLAY'
  knowledgeTime DateTime
  createdAt     DateTime @default(now())
  @@index([instrumentId, expiration])
}

model SpreadOrderAudit {
  auditId    String   @id @default(cuid())
  orderId    String
  action     String   // CREATE | CANCEL
  requestedBy String
  payloadJson String
  policyVersion String
  decisionTime DateTime
  knowledgeTime DateTime
  createdAt  DateTime @default(now())
  @@index([orderId])
  @@index([action, createdAt])
}
```

> O Claude pode ajustar nomes/campos conforme o que já existe (ex.: se já houver
> tabela de spread orders no schema, reutilize-a e adicione apenas o audit ledger).
> Regra: migração **aditiva** (CREATE TABLE/INDEX), nunca DROP/ALTER destrutivo.

---

## 4. Camadas (padrão das Fases 3–5)

```
src/domain/v1/models/option-position/   OptionPosition tipo + regras puras
src/domain/v1/models/spread-order/      SpreadOrder tipo (reutiliza padrão OrderIntent se houver)
src/domain/v1/ports/option-repository.ts
src/adapters/prisma/option-position/    repository + mapping + Zod schemas
src/application/option-position/         service.ts compose.ts index.ts
src/app/api/v1/option-positions/         POST (criar registro), GET :id, GET ?instrumentId=
scripts/option-position/                harness SQLite temp (padrão Fases 3–5)
package.json  + "test:option-position"
```

- Rotas validam body com **Zod `.strict()`** → 400 `INVALID_BODY` (reutilize
  `ReadModelError`/`jsonError`).
- `requestedBy` do middleware de sessão (padrão `resolveRequestedBy`).
- Nenhuma rota escreve ordem no MT5; cria apenas registro auditável/ledger.

---

## 5. Desacoplamento de fonte de dados (replay)

- Extrair a lógica de cálculo de `optionsService.ts`/`spreadService.ts` para funções
  **puras** que recebem barras/opções como entrada (em vez de chamar `mt5Service.send`
  ou fetch à API Python diretamente). O adapter de MT5/API Python vira uma fringe
  injetada, não acoplamento espalhado.
- Adicionar **replay determinístico**: dado um `instrumentId` + janela + `knowledgeTime`,
  a análise roda sobre `MarketBar` point-in-time, reproduzível (mesma entrada → mesma saída).
- Harness `scripts/option-position/` (ou `scripts/spread-replay/`) exercita o replay
  com fixtures de `MarketBar` (reutiliza seeds da Fase 2).

---

## 6. Remoção de duplicações

- O Claude deve **mapear e relatar** sobreposições (ex.: `spreadService` calcula via
  API Python; `spreadOrderService` gerencia ordens — há sobreposição de tipos/cont ratos?).
  Consolidar tipos duplicados em `src/types/options.ts`/`spread.ts` quando fizer sentido,
  preservando a API pública (rotas/componentes).
- Não apagar código sem relatório prévio ao Guardião.

---

## 7. Testes de contrato + regressões

`npm run test:option-position` (harness SQLite temp) cobre:
- Criação com Zod `.strict()` (campo extra → 400 INVALID_BODY).
- Replay determinístico (mesma entrada → mesma saída; point-in-time respeitado).
- Ledger de auditoria registra CREATE/CANCEL (append-only).
- Regras puras de opção (strike/expiration/side) validadas.

**Regressões obrigatórias:** `prisma validate`, `tsc --noEmit`, `build` Next.js, e os
`test:*` existentes (risk-policy, agent-run, reconciliation, dataset-feature, cvm-facts,
market-bar, reference-data, smoke:auth, order-intent, mcp, research-run, model-version,
signal, backtest-run, read-models-v1). Nenhuma regressão permitida.

---

## 8. Fora de escopo (decisão explícita)

- Execução real de ordens de opções/spread.
- Reescrita da UI de opções/spread (componentes `Spread*`, `OptionsTab`, `VolatilityPanel`).
- Substituição do `mt5Service` ou da API Python (apenas desacoplamento da lógica de cálculo).
- Alteração de `tradingAgentsService`, `MLPredictionsTab`, `src/app/api/agents/**`.
- Exposição das novas rotas no MCP da Fase 4 (ciclo posterior, se decidido).

---

## 9. Fluxo de release (padrão do projeto)

1. Guardião escreve esta spec e faz push.
2. Claude Code (Windows, Sonnet 5) implementa em worktree isolado, **sem commit**.
3. Guardião revisa o diff e roda validação independente (WSL+Windows):
   `prisma validate`, `tsc --noEmit`, `build`, `test:option-position` e as regressões da seção 7.
4. Guardião publica (commit + push) apenas após validação verde.

Se houver desvio da spec, o Claude reporta; o Guardião decide antes de publicar.
