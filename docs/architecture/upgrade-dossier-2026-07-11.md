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
- **Arquivos:** `python/mt5_bridge.py:111-115,171-174`, `src/services/mt5Service.ts:265-270`
- **Problema:** Frontend serializa e registra toda mensagem; `LOGIN.data.password` entra no `console.log`. Bridge também registra `msg_data` completo incluindo senha, login, servidor e path.

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

1. Bind Python em `127.0.0.1` + CORS allowlist estrita
2. Token efêmero por sessão no WebSocket MT5 + validação de Origin
3. Redator central de senha/token/api_key em todos os logs
4. Rejeitar `ORDER_TYPE_BUY` como default — fail-closed
5. Remover `NEXT_PUBLIC_*_API_KEY` — chaves só no backend
6. Remover `local_url` e `api_key` do body do endpoint de agentes
7. `getMockSuggestion()` → `NO_DECISION` + flag `mode=degraded`
8. Sessão HttpOnly + middleware de autenticação nas APIs
9. `sandbox: true` no Electron + `will-navigate` + `setWindowOpenHandler`
10. Mover estado para `app.getPath('userData')`

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

### Fase 3 — Runtime de agentes
- `AgentRun` assíncrono persistente: `POST /runs → 202 + runId`
- DAG explícito, schemas de entrada/saída, orçamento e cancelamento
- Agentes produzem pesquisa/propostas; políticas determinísticas aprovam/rejeitam
- Execução real exige aprovação humana + idempotency key

### Fase 4 — MCP read-only
- Servidor MCP local sobre serviços de aplicação
- Tools: `cvm.get_facts`, `b3.get_instrument`, `market.get_bars`, `portfolio.snapshot`
- Sem `execute_order` no primeiro ciclo

### Fase 5 — Pesquisa, backtest e ML
- `ResearchRun`, `ModelVersion`, `Signal`, `BacktestRun` persistidos
- Walk-forward, custos, embargo/purge
- Sinal em `t`, execução em `t+1`
- TODO modelo ML real com fit/validation/test

### Fase 6 — Consolidação
- Migrar SQL de opções para repository governado
- Remover implementações duplicadas
- Testes de contrato, replay de mercado, fixtures CVM
- Trilha de auditoria como gate de release

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
  issuerId    String?
  symbol      String   @unique
  exchange    String
  assetClass  String
  shareClass  String?  // ON, PN, UNIT, FUTURE
  currency    String
  lotSize     Int?
  validFrom   DateTime?
  validTo     DateTime?
}

model IngestionRun {
  id               String   @id @default(cuid())
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
  issuerId        String
  ingestionRunId  String
  documentType    String   // DFP, ITR, FRE
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

  @@unique([issuerId, documentType, cvmProtocol])
}

model CvmFact {
  id              String   @id @default(cuid())
  filingId        String
  issuerId        String
  statementType   String   // BPA, BPP, DRE, DFC_MD, DFC_MI, DVA, DRA
  scope           String   // CONSOLIDATED, INDIVIDUAL
  accountCode     String
  accountLabel    String
  periodStart     DateTime?
  periodEnd       DateTime
  valueDecimal    Decimal
  currency        String
  scale           String   // UNIT, THOUSAND, MILLION
  durationType    String   // INSTANT, DURATION
  validFrom       DateTime // = publishedAt
  validTo         DateTime?
  qualityFlagsJson String?

  @@unique([filingId, statementType, scope, accountCode, periodStart, periodEnd])
}
```

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
