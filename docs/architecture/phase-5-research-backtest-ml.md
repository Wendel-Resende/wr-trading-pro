# Fase 5 — Pesquisa, backtest e ML

Status: **especificação para implementação aditiva e não destrutiva**. Sem
execução financeira, sem `ExecutionBroker`. Cria a camada de pesquisa/backtest
persistida e um modelo de ML real, corrigindo os achados do dossiê: CR-9
(lookahead), A18 (Stop/TP só no fechamento, Sharpe sqrt(252) fixo), A19
(custos/microestrutura ausentes), A20 ("ML" que é só sinal técnico sem
treinamento).

Esta spec é a continuação da Fase 2 (dados CVM/B3 com proveniência point-in-time
e `MarketBar` versionado) e da Fase 4 (MCP read-only sobre esses dados). O
backtest e o ML consomem **apenas** dados point-in-time via read-models da Fase
2 — nunca olham o futuro.

---

## 1. Objetivo

Persistir e governar o ciclo de pesquisa quantitativa:

1. **ResearchRun** — uma execução de pesquisa/experimento (dataset, janela,
   hiperparâmetros) com proveniência completa.
2. **ModelVersion** — uma versão de modelo (ML ou regra) com `modelVersion`,
   `asOf`, snapshot de hiperparâmetros, evidências e condições de invalidação.
3. **Signal** — um sinal gerado por um `ModelVersion` em um `Instrument` em um
   instante, com proveniência e `knowledgeTime`.
4. **BacktestRun** — execução de backtest determinística, com walk-forward,
   custos reais (corretagem, emolumentos, spread, slippage, lote), embargo/purge
   e métricas corretas (Sharpe por período, não sqrt(252) fixo).

Restrição absoluta: **sinal em `t`, execução em `t+1`** (CR-9). Nenhum backtest
pode abrir no próprio `close[t]` que gerou o sinal.

---

## 2. Princípios (NÃO NEGOCIÁVEIS)

1. **POINT-IN-TIME OBRIGATÓRIO.** Toda leitura de mercado/fundamento usa o
   read-model da Fase 2 (`MarketBar`, `CvmFact`, `DatasetSnapshot`,
   `FeatureValue`) com `knowledgeTime <= barra/sinal`. Proibido ler candle ou
   fato com `time/knowledgeTime > t`.
2. **SEM LOOKAHEAD (CR-9).** Sinal computado em `close[t]` (ou `open[t+1]`
   conforme a regra do modelo) → entrada simulada em `open[t+1]`. Assertiva de
   teste garante `entryTime > signalTime`.
3. **ADITIVO.** Não remova nem altere `src/services/backtesting.ts` legado nem
   `src/services/mlModels.ts` legado nesta fase (podem ser usados como
   referência/baseline, mas o novo código vive em `src/domain/v1/...`,
   `src/application/...`, `src/adapters/...` seguindo o padrão das Fases 3/4).
   Não quebre rotas/UI existentes.
4. **SEM EXECUÇÃO.** Nada nesta fase envia ordem. O `ExecutionBroker` continua
   desabilitado (Fases 1–4). Backtest é simulação pura.
5. **SEM LLM DECIDINDO TRADE.** O LLM (quando usado em ResearchRun para
   descrever hipótese) é registrado como *proveniência textual*, nunca como
   gerador de ordem. O motor de backtest é determinístico.
6. **NÃO TOQUE** `tradingAgentsService`, `MLPredictionsTab`,
   `src/app/api/agents/**`, nem `docs/CODEX_HANDOFF.md` (deixe exatamente como
   está, fora de qualquer commit).
7. **REUTILIZE** as camadas de dados da Fase 2 (`read-models-v1`,
   `feature-value`, `dataset-snapshot`) como fonte point-in-time.

---

## 3. Modelos de domínio (aditivos — Prisma)

Criar em `prisma/schema.prisma` (migração aditiva, CREATE TABLE/INDEX apenas):

```prisma
model ResearchRun {
  runId        String   @id @default(cuid())
  name         String
  hypothesis   String   // texto livre / proveniência (pode vir de LLM, mas NÃO decide trade)
  datasetId    String
  windowStart  DateTime
  windowEnd    DateTime
  paramsJson   String   // hiperparâmetros (snapshot)
  createdBy    String
  createdAt    DateTime @default(now())
  modelVersionId String?
  @@index([datasetId, createdAt])
  @@index([createdBy, createdAt])
}

model ModelVersion {
  modelVersion String   @id @default(cuid())
  kind         String   // 'ML' | 'RULE'
  label        String
  asOf          DateTime
  hyperparametersJson String
  trainingEvidenceJson  String   // métricas de fit/validation/test
  invalidatedAt DateTime?
  invalidationReason String?
  createdAt     DateTime @default(now())
  @@index([kind, asOf])
}

model Signal {
  signalId     String   @id @default(cuid())
  modelVersionId String
  instrumentId String
  barTime      DateTime // instante do sinal (ex.: close[t])
  direction    String   // BUY | SELL | HOLD
  score        Float?
  knowledgeTime DateTime // point-in-time: dados usados até aqui
  createdAt    DateTime @default(now())
  @@index([modelVersionId, barTime])
  @@index([instrumentId, barTime])
}

model BacktestRun {
  backtestId   String   @id @default(cuid())
  researchRunId String
  modelVersionId String
  instrumentId String
  entryRule    String   // 'open_next_bar' (único permitido: t+1)
  costsJson    String   // corretagem, emolumentos, spreadBps, slippageBps, lote
  windowStart  DateTime
  windowEnd    DateTime
  metricsJson  String   // Sharpe por período, retorno, drawdown, n_trades, etc.
  embargoDays  Int      // purge/embargo entre treino e teste
  createdAt    DateTime @default(now())
  @@index([researchRunId])
  @@index([modelVersionId, instrumentId])
}
```

> `Float` é permitido aqui para scores/métricas de ML (ao contrário das verdades
> monetárias das Fases 1–3, que proibiram Float/Decimal). Métricas financeiras
> agregadas (retorno, drawdown) podem usar `ScaledDecimal` reutilizando o
> `scaled-decimal.ts` da Fase 2 se o Claude preferir; a decisão é do implementador,
> desde que determinística e auditável.

---

## 4. Camadas (padrão das Fases 3/4)

```
src/domain/v1/models/
  research-run/      ResearchRun tipo + regras puras (ex.: validar janela, sem futuro)
  model-version/     ModelVersion tipo + regras (invalidação)
  signal/            Signal tipo + regra point-in-time (knowledgeTime <= barTime)
  backtest-run/      BacktestRun tipo + motor determinístico (sinal t, entry t+1, custos)
src/domain/v1/ports/
  research-repository.ts, model-version-repository.ts, signal-repository.ts, backtest-repository.ts
src/adapters/prisma/
  research-run/, model-version/, signal/, backtest-run/  (repository + mapping + Zod schemas)
src/application/
  research-run/  service.ts compose.ts index.ts
  model-version/ service.ts compose.ts index.ts
  signal/       service.ts compose.ts index.ts
  backtest-run/ service.ts compose.ts index.ts  (orquestra o motor determinístico)
src/app/api/v1/
  research-runs/        POST (criar), GET :id, GET ?datasetId=
  model-versions/       POST, GET :id, GET ?kind=
  signals/              POST (gerar a partir de ModelVersion + dados point-in-time), GET :id, GET ?instrumentId=
  backtests/            POST (rodar backtest determinístico), GET :id, GET ?modelVersionId=
scripts/
  research-run/, model-version/, signal/, backtest-run/  (harness SQLite temp, padrão Fases 3/4)
package.json  + "test:research-run", "test:model-version", "test:signal", "test:backtest-run"
```

- Toda rota valida body com **Zod `.strict()`**; erro → 400 `INVALID_BODY`
  (reutilize `ReadModelError`/`jsonError`).
- `requestedBy`/criador vem do middleware de sessão (padrão `resolveRequestedBy`).
- Nenhuma rota escreve ordem; backtest é simulação.

---

## 5. Motor de backtest (determinístico — corrige A18/A19/CR-9)

Regras obrigatórias no `backtest-run` domain/model:

- **R-BT-1 (sem lookahead, CR-9):** sinal em `bar[t]` → entrada em `open[t+1]`.
  Assertiva de teste: `entryBar.time > signal.barTime`.
- **R-BT-2 (intrabar):** Stop/TP avaliados **intrabar** (high/low do período),
  não só no fechamento (corrige A18).
- **R-BT-3 (custos reais, A19):** aplica corretagem fixa + emolumentos (%),
  spread (bps) e slippage (bps) por trade; tamanho por lote. Sem custo = teste
  falha.
- **R-BT-4 (Sharpe por período):** Sharpe usa `sqrt(periodos_por_ano)` do
  timeframe real, **não** `sqrt(252)` fixo (corrige A18). `periodos_por_ano`
  derivado do timeframe (ex.: diário=252, 1h=252*6.5, etc.).
- **R-BT-5 (embargo/purge):** `embargoDays` separa janela de treino e teste;
  dados de teste com `knowledgeTime` dentro do embargo após o fim do treino são
  descartados (purge). Assertiva de teste garante que nenhuma barra de teste
  viola o embargo.
- **R-BT-6 (determinismo):** mesma entrada → mesma saída (sem random, sem
  relógio). Seed fixa se houver componente estocástico (não deve haver).
- **R-BT-7 (point-in-time):** o motor só enxerga `MarketBar`/`FeatureValue` com
  `knowledgeTime <= entryBar.time`. Assertiva de teste.

---

## 6. Modelo de ML real (corrige A20)

- `ModelVersion.kind = 'ML'` representa um modelo com **fit/validation/test**
  documentados em `trainingEvidenceJson` (acurácia, Sharpe, etc. reais do fit,
  não inventados).
- O "ML" legado (`src/services/mlModels.ts`) é apenas sinal técnico sem
  treinamento — NÃO é substituído, mas o novo `ModelVersion` + `Signal` oferece
  caminho auditável. Se o Claude quiser treinar de fato (ex.: via Python no
  Conda `IA_Day_Trading`), deve fazê-lo em script isolado em `scripts/` ou
  `python/`, persistindo apenas `ModelVersion` + métricas — nunca acoplado à UI.
- Proibido `ModelVersion` sem `trainingEvidenceJson` válido quando `kind='ML'`.

---

## 7. Segurança / kill switch

- `WR_TRADING_ENABLED` não afeta pesquisa/backtest (é simulação, não ordem). Mas
  o backtest NÃO deve oferecer primitiva que contorne o gate de ordens das
  Fases 1–4. Nenhuma rota desta fase cria `OrderIntent` ou chama `ExecutionBroker`.

---

## 8. Testes (harness por domínio, padrão Fases 3/4)

Cada `npm run test:*` usa SQLite temporário e cobre:

**research-run / model-version / signal (R-RM-1..N):**
- criação com Zod `.strict()` (campo extra → 400 INVALID_BODY).
- `Signal.knowledgeTime <= barTime` (point-in-time) — assertiva.
- `ModelVersion` `kind='ML'` exige `trainingEvidenceJson` (sem → rejeitado).
- `ModelVersion` invalidação (`invalidatedAt`) registrada e consultável.

**backtest-run (R-BT-1..7):** todos os itens da seção 5, com fixtures de
`MarketBar` point-in-time e um `ModelVersion` de exemplo.

**Regressões obrigatórias:** `prisma validate`, `tsc --noEmit`, `build` Next.js,
e os `test:*` existentes (risk-policy, agent-run, reconciliation,
dataset-feature, cvm-facts, market-bar, reference-data, smoke:auth,
order-intent, mcp). Nenhuma regressão permitida. O legado `backtesting.ts`/
`mlModels.ts` continua compilando (não foi alterado).

---

## 9. Fora de escopo (decisão explícita)

- Execução real de ordens.
- Substituição/remoção do `backtesting.ts`/`mlModels.ts` legado.
- Alteração de `tradingAgentsService`, `MLPredictionsTab`, `src/app/api/agents/**`.
- Exposição das novas rotas no MCP da Fase 4 (fica para ciclo posterior, se
  decidido).

---

## 10. Fluxo de release (padrão do projeto)

1. Guardião escreve esta spec e faz push.
2. Claude Code (Windows, Sonnet 5) implementa em worktree isolado, **sem commit**.
3. Guardião revisa o diff e roda validação independente (WSL+Windows):
   `prisma validate`, `tsc --noEmit`, `build`, `test:research-run`,
   `test:model-version`, `test:signal`, `test:backtest-run` e as regressões da
   seção 8.
4. Guardião publica (commit + push) apenas após validação verde.

Se houver desvio da spec, o Claude reporta; o Guardião decide antes de publicar.
