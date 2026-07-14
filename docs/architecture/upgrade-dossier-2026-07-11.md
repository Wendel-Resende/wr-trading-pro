# Dossiê Técnico — WR Trading Pro Upgrade Profissional

> Auditoria consolidada em 2026-07-11 por três frentes independentes (arquitetura, segurança, dados/pesquisa).
> Método: estática, somente leitura, sem execução de ordens ou alteração de arquivos.

---

## 1. Achados Críticos (ação imediata)

### CR-1 — Superfície operacional sem autenticação real
- **Arquivos:** `src/app/login/page.tsx:30-38`, `src/app/page.tsx:60-64,171-173`
- **Problema:** Login grava apenas objeto em `localStorage`. Nenhum middleware de sessão existe. Todas as 21 rotas de API aceitam requisições sem autenticação.
- **Risco:** Qualquer processo local ou página maliciosa pode criar/alterar ordens, consultar logs, executar agentes e operar MT5.

### CR-2 — Serviços Python expostos em 0.0.0.0 com CORS irrestrito
- **Arquivos:** `python/spread_api.py:33-34,685-687`, `python/volatility_api.py:23-24,275-277`
- **Problema:** `CORS(app)` sem allowlist + `host='0.0.0.0'` expõe serviços na LAN. Qualquer origem pode invocar APIs que acessam sessão MT5.

### CR-3 — WebSocket MT5 sem autenticação nem isolamento de sessão
- **Arquivos:** `python/mt5_bridge.py:55-155,116-155,189-194,1017-1271`
- **Problema:** Sem validação de `Origin`, token ou vínculo sessão-conta. Estado MT5 é global e compartilhado entre clientes — um cliente faz login, todos operam a mesma conta. Cross-Site WebSocket Hijacking é possível.

### CR-4 — Senha MT5 exposta em logs
- **Arquivos:** `python/mt5_bridge.py:114` (loga `msg_data` completo do LOGIN incluindo senha), `src/services/mt5Service.ts:269` (`console.log('Enviando mensagem:', jsonMessage)` serializa LOGIN com senha)
- **Problema:** Payload de autenticação completo registrado em logs. As linhas 171-174 do bridge mascaram a senha (`'***' if password`), mas o vazamento real está na linha 114 que loga `msg_data` inteiro. No frontend, `mt5Service.ts:269` registra toda mensagem WebSocket enviada.
- **Correção confirmada pelo Fable 5:** Vazamento correto identificado; citação de linha ajustada de 171-174 para 114.

### CR-5 — Tipo de ordem desconhecido vira compra a mercado (fail-open)
- **Arquivos:** `python/mt5_bridge.py:1072-1082`
- **Problema:** `mapping.get(order_type, mt5.ORDER_TYPE_BUY)` — typo, campo ausente ou payload malicioso produz uma compra real.

### CR-6 — Mock sintético pode parecer decisão real
- **Arquivos:** `src/app/api/agents/route.ts:47-81,156-165,190-203,398-400`
- **Problema:** Falhas de parsing ou indisponibilidade do LLM retornam `getMockSuggestion()` que produz BUY/SELL com quantidade 100. Não há campo de proveniência que impeça execução.

### CR-7 — LLM gera comando executável diretamente
- **Arquivos:** `agents/workers.py:135-188,171-180`
- **Problema:** Pipeline termina em `execution_order` gerado por LLM. Não há barreira entre recomendação e intenção de execução. Texto probabilístico vira comando sem validação determinística de risco.

### CR-8 — Não existe modelo CVM point-in-time
- **Arquivos:** `prisma/schema.prisma:167-227`
- **Problema:** Fundamentos são snapshots mutáveis sem período, data de disponibilidade, escopo CON/IND, moeda, escala ou fonte. Retificações CVM não podem ser preservadas. Backtest futuro não consegue fazer as-of join auditável.

### CR-9 — Backtest entra no mesmo fechamento que gerou o sinal (lookahead)
- **Arquivos:** `src/services/backtesting.ts:41-67`
- **Problema:** Modelo recebe candles até `i` incluindo `close[i]` e abre ao próprio `close[i]`. Isso é execução temporalmente impossível. Padrão seguro: sinal em `t`, execução em `open[t+1]`.

---

## 2. Achados Altos (bloqueiam evolução confiável)

| # | Área | Arquivo/linha | Achado |
|---|------|---------------|--------|
| A1 | Seg | `src/app/api/agents/route.ts:353-356,390-396` | Endpoint aceita `api_key` e `local_url` do cliente — SSRF e exposição de credencial |
| A2 | Seg | `src/services/llmService.ts:435-460` | Chaves LLM em `NEXT_PUBLIC_*` — incorporadas ao bundle do frontend |
| A3 | Seg | `src/app/api/agents/route.ts:226-238` | Subprocesso Python com `shell: true` desnecessariamente |
| A4 | Seg | `electron/main.ts:352-375,414-545` | Sem `will-navigate`, `setWindowOpenHandler` nem validação de emissor IPC |
| A5 | Seg | `python/mt5_bridge.py:1017-1271` | Envio de ordens sem controles de risco independentes (sem allowlist, limites, order_check, kill switch) |
| A6 | Seg | `python/mt5_bridge.py:1017-1271` | Sem idempotência — reenvios podem duplicar ordens |
| A7 | Seg | `src/app/api/spread-orders/route.ts:56-116` | Mass assignment — cliente pode criar ordem como `FILLED`, definir tickets e `isAutomated` |
| A8 | Arq | `agents/workers.py` vs `agents/pipeline_wrapper.py` | Duas implementações divergentes de "pipeline multiagente" |
| A9 | Arq | `src/app/api/agents/route.ts:210-299` | Orquestração síncrona bloqueante até 5 min; estado em memória de módulo |
| A10 | Arq | `src/app/api/agents/route.ts:153-165,275-350` | Contratos do agente não validados estruturalmente (JSON.parse + spread) |
| A11 | Arq | `src/services/*.ts` espalhado | B3/MT5/ProfitDLL sem porta de domínio comum — UI conhece tecnologia e porta de cada fonte |
| A12 | Arq | `electron/main.ts:66-68,431-450` | Dois bancos SQLite com duas estratégias de schema (Prisma vs SQL manual) |
| A13 | Arq | `electron/main.ts:83-87` | Caminho Python hardcoded em `C:\Users\rwres\anaconda3\...` |
| A14 | Dados | `schema.prisma:74-88,300-315` | Proveniência de mercado ausente — `MarketData` e `HistoricalCandle` sem sourceId, ambiente, lote, modo ou qualidade |
| A15 | Dados | `schema.prisma:74-88,300-315` | Duas tabelas de candles com contratos divergentes (relação vs symbol livre, BigInt vs Float) |
| A16 | Dados | `historicalDataService.ts:40-60` | Upsert destrói observabilidade de correções — valor anterior e hash não preservados |
| A17 | Dados | `historicalDataService.ts:23-34,63-70` | Falhas de atualização silenciosas; cache mede quantidade não atualidade |
| A18 | Dados | `backtesting.ts:42-50,89-92` | Stop/TP só no fechamento (ignora intrabar); Sharpe usa sqrt(252) fixo para qualquer timeframe |
| A19 | Dados | `backtesting.ts` | Custos e microestrutura não modelados (corretagem, emolumentos, spread, slippage, lote) |
| A20 | Dados | `mlModels.ts` | "ML" é sinal técnico sem treinamento supervisionado formal |
| A21 | Dados | `schema.prisma:60-72` | Previsões sem `modelVersion`, `asOf`, snapshot, evidências nem condições de invalidação |

---

## 3. Achados Médios e Baixos (dívida relevante)

| # | Área | Arquivo/linha | Achado |
|---|------|---------------|--------|
| M1 | Seg | `electron/main.ts:357-362` | Sandbox do renderer desabilitado (`sandbox: false`) |
| M2 | Seg | `electron/preload.ts:7-9` | IPC aceita objetos e limites não validados |
| M3 | Seg | `src/app/api/agents/route.ts:226-229` | Arquivo temporário previsível sem criação exclusiva |
| M4 | Seg | `src/app/api/logs/route.ts:127-268` | Consulta e exportação irrestrita de logs sem limites |
| M5 | Seg | `python/mt5_bridge.py`, `electron/main.ts:162-180` | Logs excessivos de ordens — payload completo, tickets, conta, margem |
| M6 | Seg | `python/profitdll_bridge.py:72-140` | Login ProfitDLL simulado aceita qualquer credencial e marca como válida |
| M7 | Arq | `schema.prisma:30-108,141-165` | Schema usa Float para valores monetários e String para enums |
| M8 | Arq | `electron/main.ts:66-68` | Estado dentro do diretório do projeto (OneDrive) em vez de `userData` |
| M9 | Arq | `electron/main.ts:154-160,337-340` | Readiness declarado sem evidência — "assume ready" após timeout |
| M10 | Arq | `package.json:8-20` | Sem suíte de testes automatizados; zero arquivos `*.test.*` |
| M11 | Dados | `src/app/api/historical-candles/route.ts:20-39` | API permite injetar candles sem identidade de fonte nem validação |
| M12 | Dados | Sem `ResearchRun` persistido | Backtest não é reproduzível — sem dataset snapshot, split, seed, código, benchmark |
| B1 | Seg | `electron/main.ts:40-66,83-87` | Caminhos sensíveis hardcoded; `get-user-data-path` expõe projeto ao renderer |

---

## 4. Resumo quantitativo

| Severidade | Quantidade |
|------------|-----------|
| Crítica | 9 |
| Alta | 21 |
| Média | 12 |
| Baixa | 1 |
| **Total** | **43** |

---

## 5. Arquitetura-alvo

Monólito modular local — não começar por microserviços.

```text
React / Next.js UI
      │
      ▼
Local Application API (autenticada, RBAC)
 ├─ Identity & Capabilities
 ├─ Portfolio / Monitoring
 ├─ Research & Fundamentals
 ├─ Agent Runs / Audit Ledger
 └─ Order Intent / Approval
      │
      ├──────── Domain ports ────────┐
      ▼                              ▼
Data & Market Gateway             Agent Runtime/Worker
 ├─ CVM Adapter                   ├─ Research agents
 ├─ B3 Catalog/Calendar Adapter   ├─ Deterministic validators
 ├─ MT5 Market Adapter            ├─ Risk-policy engine
 └─ ProfitDLL Adapter             └─ Provenance/run ledger
      │
      ▼
SQLite repositories
 ├─ operational.db
 ├─ raw regulatory artifacts
 └─ derived/cache tables

MCP Server (read-only, fase posterior)
 └─ thin façade over application/domain services
    nunca acesso direto ao Prisma, DLL ou terminal
```

Princípios:
- LLM produz opinião/pesquisa, nunca comando executável.
- Fluxo canônico: `ResearchFinding → TradeProposal → RiskPolicy → OrderIntent → human approval → ExecutionAdapter`.
- Dados: `raw imutável → validação → normalização versionada → fatos → métricas derivadas`.
- Point-in-time: `knowledgeTime <= decisionTime` sempre.
- MCP começa read-only, sem `execute_order`.

---

## 6. Roadmap de execução

### Fase 0 — Contenção operacional (primeiro incremento)
Prioridade: eliminar riscos críticos sem quebrar funcionalidade atual.

**Ordem revisada após revisão independente do Fable 5:**

| Ordem | Item | Arquivo(s) | Esforço | Risco eliminado |
|-------|------|-----------|---------|-----------------|
| 1 | Fail-closed no tipo de ordem | `mt5_bridge.py:1081` | 1 linha | CR-5 (compra acidental) |
| 2 | Redator central de segredos em logs | `mt5_bridge.py:114`, `mt5Service.ts:269` | Função pura | CR-4 (senha em logs) |
| 3 | Bind `127.0.0.1` + CORS allowlist em TODOS os serviços | `spread_api.py`, `volatility_api.py`, `dashboard_opcoes.py:466`, `package.json:9,11`, `electron/main.ts` | Config | CR-2 (exposição LAN) |
| 4 | Validação de Origin no WebSocket MT5 | `mt5_bridge.py` handshake | Pequeno | CR-3 parcial (CSWSH) |
| 5 | Kill switch `WR_TRADING_ENABLED` (default false) + `mt5.order_check()` | `mt5_bridge.py` antes de `order_send` | ~10 linhas | Janela de ordens sem controle |
| 6 | `getMockSuggestion()` → `NO_DECISION` + `mode=degraded` | `agents/route.ts:47-81,156-165,190-203` | Médio | CR-6 (mock vira decisão) |
| 7 | Chaves LLM no backend + remover `api_key`/`local_url` do body (juntos) | `llmService.ts`, `agents/route.ts`, criar proxy server-side | Médio | A1+A2 (SSRF + chaves no bundle) |
| 8 | Zod no `spread-orders` POST (mass assignment) | `spread-orders/route.ts` | Pequeno | A7 (estado controlado pelo cliente) |
| 9 | Sessão HttpOnly + middleware de autenticação | Criar `src/middleware.ts`, cobrir 21 rotas | Grande | CR-1 (sem autenticação) |
| 10 | Token efêmero no WebSocket derivado da sessão | `mt5_bridge.py` | Médio | CR-3 completo (token por sessão) |
| 11 | `sandbox: true` + `will-navigate` + `setWindowOpenHandler` | `electron/main.ts` | Médio | M1+A4 (Electron hardening) |

**Resolvido — item 10 original (mover estado para userData):**
Decisão do usuário: manter regra do CLAUDE.md e excluir `data/` do sync do OneDrive. Nada será movido. Ação: criar arquivo `..onesyncignore` ou instrução documentada para excluir `data/` da sincronização do OneDrive.

**Risco novo — credenciais em texto claro no banco:**
`AIProvider.apiKey` e `DataSource.config` persistem segredos sem cifragem em `dev.db`, que está sob OneDrive. Remediação via `safeStorage` do Electron ou keyring do SO na Fase 1.

**Roteiro de testes mínimo (Fase 0):**
- Script de smoke manual documentado: login MT5, tick, ordem demo, spread, volatilidade
- Testes unitários para o redator de logs (item 2) e mapeamento fail-closed (item 1) — funções puras
- `npm run build` + `npm run electron:compile` após cada item que tocar TS/Electron

### Fase 1 — Contratos e portas de domínio
- Introduzir interfaces: `InstrumentCatalog`, `MarketDataProvider`, `HistoricalBarsProvider`, `PortfolioProvider`, `ExecutionBroker`
- Schemas Zod/Pydantic versionados para sinais, propostas, ordens
- Separar `TradeProposal`, `RiskDecision`, `OrderIntent`, `ExecutionResult`
- Adaptar MT5 atual sem reescrever a UI

### Fase 2 — Dados CVM/B3 com proveniência
Migração aditiva (não remover tabelas atuais):

1. `Issuer`, `Instrument`, `IngestionRun` — fundação
2. `CvmFiling`, `CvmFact`, `ShareCapitalFact` — DFP/ITR/FRE com hashes e versões
3. `MarketBar` — mercado versionado com fonte e revisão
4. Views/read models alimentam UI atual sem torná-la canônica
5. `DatasetSnapshot` + `FeatureValue` com `knowledgeTime`
6. Cortar fundo legado somente após reconciliação e testes de paridade

**Estado em 2026-07-13:** itens 1-6 concluídos e publicados como commits separados; paridade será decidida humana com base em APIs `/api/v1/reconciliation/*`, sem corte automático.

### Fase 3 — Runtime de agentes
- `AgentRun` assíncrono persistente: `POST /runs → 202 + runId`
- DAG explícito, schemas de entrada/saída, orçamento e cancelamento
- Agentes produzem pesquisa/propostas; políticas determinísticas aprovam/rejeitam
- Execução real exige aprovação humana + idempotency key

**CHECKPOINT — Fase 3 COMPLETA (4/4 itens) em 2026-07-14**

| Item | Título | Commit | Resumo da entrega |
|------|--------|--------|-------------------|
| 1 | `AgentRun` assíncrono persistente | `71292a3` | `POST /api/v1/agent-runs → 202 + runId`; modelo `AgentRun` + ledger; sem bloqueio síncrono |
| 2 | DAG semântico + orçamento/cancelamento | `fe48f0c` | DAG explícito, schemas de entrada/saída, orçamento real e cancelamento real |
| 3 | Motor RiskPolicy determinístico | `f721a8b` | `RiskDecision` (APPROVED/REJECTED) + ledger; regras: kill switch, allowlist, máx propostas/run, notional, concentração; HOLD não-acionável |
| 4 | Aprovação humana + idempotency key | `c3d5782` | `HumanApprovalReceipt` + `OrderIntent` (intenção auditável CREATED/CANCELLED); idempotency `@unique` com replay sem duplicar; reutiliza `RiskPolicyRepository` |

**Fluxo de trabalho (validado nesta fase):**
1. Guardião escreve spec aditiva em `docs/architecture/phase-3-item-N-*.md` e faz push.
2. Claude Code (Windows, Sonnet 5) implementa em worktree isolado, sem commit.
3. Guardião revisa o diff e roda validação independente em WSL+Windows (prisma validate, tsc --noEmit, build Next.js, test:risk-policy, test:agent-run, test:reconciliation, smoke:auth, e o novo test:* do item).
4. Guardião publica (commit + push) apenas após validação verde.

**Validação acumulada (Guardião, fonte primária):**
- `test:risk-policy` ✅ 14 itens · `test:agent-run` ✅ · `test:reconciliation` ✅ · `smoke:auth` ✅ 62 PASS, 0 FAIL
- `test:order-intent` ✅ 14 itens (Item 4) · `prisma validate` ✅ · `tsc --noEmit` ✅ · `build` Next.js ✅

**Correções do Guardião na revisão (fora do relatório do Claude):**
- Item 3: import `_requested-by` quebrado (→ `../../agent-runs/_requested-by`) + `tsconfig.json` ausente do harness (criado). Sem elas, tsc e test:risk-policy falhavam.
- Item 4: nenhuma correção necessária — entregue limpo.

**Incidente Item 4:** o Claude Code (Sonnet 5) travou (`state: blocked`) por queda de API ("Connection closed mid-response") após escrever os arquivos, antes de rodar os testes. O Guardião assumiu: consertou o gitdir do worktree, copiou os arquivos para o `main` e concluiu a validação/teste independente.

**Nota de legado (pré-existente, não do Item 4):** `prisma/migrations/` está no `.gitignore` do repositório. As migrations (incluindo as do Item 3 e Item 4) existem no disco local mas NÃO vão ao git. Em clone novo, os harness de teste dependem das migrations presentes no disco; o `test:reconciliation` exige as migrations locais `init_stock_monitoring` e `add_historical_candle`. Decisão pendente de humano: versionar ou não as migrations.

**Próximo:** Fase 4 — MCP read-only.

### Fase 4 — MCP read-only
- Servidor MCP local sobre serviços de aplicação
- Tools: `cvm.get_facts`, `b3.get_instrument`, `market.get_bars`, `portfolio.snapshot`
- Sem `execute_order` no primeiro ciclo

**CHECKPOINT — Fase 4 CONCLUÍDA em 2026-07-14**

| Item | Título | Commit | Resumo da entrega |
|------|--------|--------|-------------------|
| F4 | Servidor MCP read-only | `b7b44b8` | Servidor MCP local (stdio) sobre services de aplicação (Fases 2/3). 8 tools: `cvm.get_facts`, `b3.get_instrument`, `market.get_bars`, `agent_run.get`, `risk_decision.get`, `order_intent.get`, `reconciliation.report`, `dataset.feature_values` |

**Características garantidas por construção:**
- SEM LLM no servidor; apenas repassa chamadas de tool para services de leitura.
- NENHUMA tool escreve: `save*`/`create*`/`update*`/`cancel*`/`execute*` proibidos — provado por spy em `test:mcp` R-LO-1.
- Transporte `stdio` no primeiro ciclo; `http` fora de escopo (quando vier, exige `WR_MCP_HTTP_TOKEN` + bind 127.0.0.1, fail-closed sem token — `config.ts`).
- Reutiliza `compose.ts` de `agent-run`, `risk-policy`, `order-intent`, `reconciliation`, `feature-value`, `read-models-v1`. `@modelcontextprotocol/sdk` + `zod` adicionados como dependências.
- Desvio aceitável: `portfolio.snapshot` NÃO implementada (não existe application service de leitura para `PortfolioProvider`; proibido inventar consulta Prisma fora dos adapters).

**Correção de infraestrutura (mesmo commit train):** as 4 migrations `20260112022825_init_stock_monitoring`, `20260317224647_add_historical_candle`, `20260714020000_add_risk_decision_ledger` (Item 3) e `20260714030000_add_order_intent_approval` (Item 4) estavam no disco mas NÃO no git (`prisma/migrations/` estava no `.gitignore`). Isso quebrava `test:risk-policy`, `test:order-intent` e `test:reconciliation` em clone limpo. Corrigido em `b3e7c91`: removido `prisma/migrations/` do `.gitignore` e versionadas as 4 migrations (todas CREATE TABLE/INDEX puras, aditivas). Agora todos os harness passam em qualquer clone.

**Validação acumulada (Guardião, fonte primária):**
- `test:mcp` ✅ R-LO-1..8 · `prisma validate` ✅ · `tsc --noEmit` ✅ · `build` Next.js ✅
- `test:risk-policy` ✅ · `test:agent-run` ✅ · `test:order-intent` ✅ · `test:reconciliation` ✅ · `test:dataset-feature` ✅ · `test:cvm-facts` ✅ · `test:market-bar` ✅ · `test:reference-data` ✅ · `smoke:auth` ✅ 62 PASS
- Todos os harness de Fase 3 e Fase 4 verdes; repositório consistente em clone limpo.

**Próximo:** Fase 5 — Pesquisa, backtest e ML.

### Fase 5 — Pesquisa, backtest e ML
- `ResearchRun`, `ModelVersion`, `Signal`, `BacktestRun` persistidos
- Walk-forward, custos, embargo/purge
- Sinal em `t`, execução em `t+1`
- TODO modelo ML real com fit/validation/test

**CHECKPOINT — Fase 5 CONCLUÍDA em 2026-07-14**

| Item | Título | Commit | Resumo da entrega |
|------|--------|--------|-------------------|
| F5 | Research/backtest/ML point-in-time | `a1c9f0c` | `ResearchRun`, `ModelVersion` (ML/RULE + evidências), `Signal` (point-in-time), `BacktestRun` (walk-forward, custos, embargo). Motor determinístico corrige CR-9/A18/A19/A20. Rotas `/api/v1/{research-runs,model-versions,signals,backtests}`. 4 novos `test:*` (SQLite temp) |

**Características (corrigem achados do dossiê):**
- **CR-9 (sem lookahead):** sinal em `t` → entrada `open[t+1]` (R-BT-1, assertiva `entryTime > signalTime`).
- **A18:** Stop/TP intrabar (R-BT-2); Sharpe usa `sqrt(periodos_por_ano)` do timeframe, não `sqrt(252)` fixo (R-BT-4).
- **A19:** custos reais — corretagem, emolumentos, spread (bps), slippage (bps), lote (R-BT-3).
- **A20:** `ModelVersion.kind='ML'` exige `trainingEvidenceJson` real (R-RM).
- **Embargo/purge:** `embargoDays` separa treino/teste (R-BT-5).
- Point-in-time obrigatório: consome só read-models da Fase 2 (`MarketBar`, `CvmFact`, `FeatureValue`) com `knowledgeTime <= t`.
- Sem execução (ExecutionBroker desabilitado); `backtesting.ts`/`mlModels.ts` legados preservados (não alterados).

**Correção de teste (commit `a25c889`):** `test:read-models-v1` Test 16 varria TODAS as rotas `/api/v1` e exigia ausência de POST, quebrando desde a Fase 3 (`agent-runs/route.ts` tem POST legítimo). Restringido a `reference`/`fundamentals`/`market-bars` (GET-only). Não altera código de produção.

**Validação acumulada (Guardião, fonte primária):**
- Fase 5: `test:research-run` ✅ · `test:model-version` ✅ · `test:signal` ✅ · `test:backtest-run` (R-BT-1..7) ✅
- `test:read-models-v1` ✅ (Test 16 e 17 verdes após correção)
- Regressões: `test:risk-policy` ✅ · `test:agent-run` ✅ · `test:order-intent` ✅ · `test:reconciliation` ✅ · `test:dataset-feature` ✅ · `test:cvm-facts` ✅ · `test:market-bar` ✅ · `test:reference-data` ✅ · `test:mcp` ✅ · `smoke:auth` ✅ 62 PASS
- `prisma validate` ✅ · `tsc --noEmit` ✅ · `build` Next.js ✅ · repositório 100% verde em clone limpo.

**Próximo:** Fase 6 — Consolidação.

### Fase 6 — Consolidação
- Migrar SQL de opções para repository governado
- Remover implementações duplicadas
- Testes de contrato, replay de mercado, fixtures CVM
- Trilha de auditoria como gate de release

**CHECKPOINT — Fase 6 CONCLUÍDA em 2026-07-14**

| Item | Título | Commit | Resumo da entrega |
|------|--------|--------|-------------------|
| F6 | Consolidação (repository, replay, auditoria) | `cf837d1` | `OptionPosition` + `SpreadOrderAudit` (ledger append-only) no Prisma governado; `option-math.ts` (funções puras extraídas de `optionsService.ts`, mesma API pública, zero remoção); replay determinístico point-in-time sobre `MarketBar` (Fase 2, CR-9); rotas `/api/v1/option-positions` (POST/GET, Zod `.strict()`); `test:option-position` SQLite temp |

**Características:**
- Repository governado (Prisma tipado, CREATE TABLE/INDEX aditivos) substituindo acesso manual — `OptionPosition` e `SpreadOrderAudit` no schema, sem alterar modelos legados (inclusive `SpreadOrder`).
- Desacoplamento de cálculo: funções puras (`parseStrike`, `determineType`, `getDTE`, `anualizar`, `calcExerciseProb`, `mean`, `std`) extraídas para `option-math.ts` e re-exportadas com os mesmos nomes em `optionsService.ts` — **mesma API pública, comportamento preservado**.
- Replay determinístico point-in-time (mesma entrada → mesma saída, sem lookahead CR-9).
- Duplicações de I/O (`mt5Service`/`spreadService`/`spreadOrderService`) mapeadas e relatadas, não removidas (100% aditivo/funcional).
- `docs/CODEX_HANDOFF.md` intocado; `tradingAgentsService`/`MLPredictionsTab`/`api/agents` intocados.

**Validação acumulada (Guardião, fonte primária):**
- `test:option-position` ✅ · `prisma validate` ✅ · `tsc --noEmit` ✅ · `build` Next.js ✅ (novas rotas `/api/v1/option-positions`)
- `test:read-models-v1` ✅ (Test 16 e 17 verdes após commit da Fase 6)
- Regressões: `test:risk-policy`/`agent-run`/`order-intent`/`reconciliation`/`dataset-feature`/`cvm-facts`/`market-bar`/`reference-data`/`mcp`/`research-run`/`model-version`/`signal`/`backtest-run`/`smoke:auth` ✅ 62 PASS
- Repositório 100% verde em clone limpo.

**Roadmap concluído:** Fases 3/4/5/6 ✅. Todas as 6 fases da arquitetura-alvo (seção 5) completas.

---

## 7. Gates mínimos de aceitação

- Toda linha CVM rastreável até arquivo, protocolo, hash e ingestão
- Retificações preservadas, não sobrescritas
- Consulta "as known on date T" reproduzível
- Nenhuma feature com `knowledgeTime > decisionTime`
- Candle identifica fonte, revisão e estado final
- Backtest executa após o evento que produziu o sinal
- Custos e periodicidade das métricas explicitados
- Todo resultado ML liga dataset, features, código, seed e modelo
- Mock/cache/degradado sempre visíveis na API e na UI
- Nenhuma ordem real sem aprovação humana + idempotency key + kill switch

---

## 8. Esquema CVM proposto (resumo)

```prisma
model Issuer {
  id          String   @id @default(cuid())
  cvmCode     String   @unique
  cnpj        String?
  legalName   String
  sector      String?
  subsector   String?
  activeFrom  DateTime?
  activeTo    DateTime?
}

model Instrument {
  id          String   @id @default(cuid())
  issuer      Issuer?  @relation(fields: [issuerId], references: [id])
  issuerId    String?
  symbol      String   @unique
  exchange    String
  assetClass  String
  shareClass  String?
  currency    String
  lotSize     Int?
  validFrom   DateTime?
  validTo     DateTime?
}

model IngestionRun {
  id               String   @id @default(cuid())
  source           DataSource @relation(fields: [sourceId], references: [id])
  sourceId         String
  startedAt        DateTime
  completedAt      DateTime?
  status           String
  requestUri       String?
  payloadSha256    String?
  parserVersion    String?
  codeVersion      String?
  rowCount         Int?
  errorCount       Int?
  qualitySummaryJson String?
}

model CvmFiling {
  id              String   @id @default(cuid())
  issuer          Issuer   @relation(fields: [issuerId], references: [id])
  issuerId        String
  ingestionRun    IngestionRun @relation(fields: [ingestionRunId], references: [id])
  ingestionRunId  String
  documentType    String
  cvmProtocol     String
  referenceDate   DateTime
  fiscalYear      Int
  fiscalQuarter   Int?
  filedAt         DateTime
  publishedAt     DateTime
  versionNumber   Int      @default(1)
  isRestatement   Boolean  @default(false)
  supersedesFilingId String?
  sourceUrl       String?
  rawSha256       String?
  cvmFacts        CvmFact[]

  @@unique([issuerId, documentType, cvmProtocol])
  @@unique([issuerId, documentType, referenceDate, versionNumber])
}

model CvmFact {
  id              String   @id @default(cuid())
  filing          CvmFiling @relation(fields: [filingId], references: [id])
  filingId        String
  issuer          Issuer   @relation(fields: [issuerId], references: [id])
  issuerId        String
  statementType   String
  scope           String
  accountCode     String
  accountLabel    String
  periodStart     DateTime  // NÃO nullable — para INSTANT, periodStart = periodEnd
  periodEnd       DateTime
  valueRaw        BigInt    // BigInt (não Decimal) — SQLite armazena como INTEGER de 64 bits, exato
  scalePow        Int       // expoente decimal: valor real = valueRaw * 10^scalePow
  currency        String
  scale           String    // metadado de auditoria: UNIT, THOUSAND, MILLION (escala original do arquivo)
  durationType    String    // INSTANT, DURATION
  validFrom       DateTime  // = publishedAt (knowledgeTime)
  validTo         DateTime?
  qualityFlagsJson String?

  @@unique([filingId, statementType, scope, accountCode, periodStart, periodEnd])
  @@index([issuerId, accountCode, periodEnd, validFrom])
}
```

**Correções aplicadas após revisão do Fable 5:**
1. `Decimal` → `BigInt` + `scalePow`: SQLite não tem decimal nativo; `Decimal` vira REAL (float IEEE 754) e perde exatidão. `BigInt` é INTEGER de 64 bits, exato.
2. `periodStart` não nullable: no SQLite, `NULL ≠ NULL` em índices únicos, então fatos INSTANT (BPA/BPP) ficariam sem proteção contra duplicata. Convenção: `periodStart = periodEnd` para INSTANT.
3. `@relation` explícitas em todas as FKs para integridade referencial.
4. Índice `@@index([issuerId, accountCode, periodEnd, validFrom])` para as-of join sem full scan.
5. `@@unique` adicional em `CvmFiling` contra duplicação de versões por bug de ingestão.

Migração incremental:
1. Criar novas tabelas aditivamente (não remover as atuais)
2. Importar DFP/ITR/FRE com hashes e versões
3. Produzir views que alimentam a UI atual sem torná-la fonte canônica
4. Cortar fundo legado somente após reconciliação por ticker/período + testes de paridade

---

## 9. Decisões registradas

- SQX: somente históricos extensos WDO/WIN no WR Trading Pro
- Agente IA que pilota SQX: projeto separado
- GitHub: repositório privado, histórico antigo substituído
- Guardião_Hermes: arquitetura, especificação, segurança e revisão
- Fable 5 / Claude Code: implementação delimitada e testes
- Comunicação multiagente: Git + arquivos de arquitetura + CLI
- Princípios absorvidos, não código copiado
- Implementação limpa própria com contratos brasileiros e fontes oficiais CVM/B3
