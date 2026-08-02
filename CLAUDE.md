# WR Trade Pro — CLAUDE.md

## Segundo cérebro (vault Obsidian)

O conhecimento do projeto vive no vault Obsidian `C:\Users\rwres\hermes-knowledge` (mantido pelo Guardião_Hermes e pelo usuário):

- **No início de cada sessão de trabalho neste projeto**, ler `index.md` e `concepts/wr-trading-pro-professional-upgrade.md` do vault para contexto de estado/decisões — junto com `docs/CODEX_HANDOFF.md` deste repo.
- **Ao tomar/registrar decisões relevantes** (arquitetura, segurança, roadmap), atualizar a página correspondente do vault e adicionar entrada no `log.md`, seguindo as convenções de `SCHEMA.md` (frontmatter, `updated`, wikilinks, index).
- Divisão de papéis: o vault é a fonte de verdade de decisões e conhecimento; `docs/CODEX_HANDOFF.md` é o handoff operacional entre sessões; o histórico técnico fica no git.
- Em conflito entre vault e código/git, o git vence para fatos técnicos — anotar a divergência no vault com data (política de update do `SCHEMA.md`).

## Stack

- **Frontend:** Next.js 15.1.3 (App Router), React 19, TypeScript 5, Tailwind CSS 3.4
- **UI:** Recharts, lightweight-charts, Lucide React, CVA
- **Backend:** Prisma 6 + SQLite, API Routes (Next.js)
- **Desktop:** Electron 35 + electron-builder 26
- **Python Services:** conda env `IA_Day_Trading` (Python 3.x via Anaconda)
- **ML:** TypeScript puro — MA Crossover, Linear Regression, backtesting engine
- **State:** React Query, React Context, Zustand (não confirmado)

## Arquitetura

### Frontend
```
src/
├── app/                  # Next.js App Router (pages, API routes)
├── components/tabs/      # 8 tabs: Dashboard, Orders, Portfolio, Spread, Monitoring, MLPredictions, MLModels, Admin
├── components/ui/        # Toast, componentes reutilizáveis
├── contexts/             # ToastContext
├── services/            # mt5Service, historicalDataService, stockMonitoringService
├── lib/                 # Prisma client, utilitários
└── types/               # TypeScript types (mt5, admin, profit, stock-reports)
```

### API Routes
```
src/app/api/
├── historical-candles/   # GET candles do SQLite, POST para salvar candles do cliente
├── stock-monitoring/    # CRUD posições, sync-prices, summary
├── stock-alerts/         # CRUD alertas
├── stock-reports/        # CRUD relatórios
├── volatility/          # API de volatilidade
└── spread-orders/        # Ordens de spread
```

### Python Services
```
python/
├── spread_api.py        # Flask :5000 — API de spreads
├── volatility_api.py    # Flask :5555 — API de volatilidade
├── profitdll_bridge.py  # Bridge Profit DLL (ainda não ativo)
└── ml_api.py           # Flask :5560 — motor ML (backfill D1, TimesFM, LightGBM)
```

### MT5 — MCP nativo (não é mais ponte Python)

Desde 2026-08-02 o MT5 não usa mais ponte Python/WebSocket (`mt5_bridge.py`
foi removido) — o terminal MT5 (Windows, build 6060+) expõe um servidor MCP
próprio via Streamable HTTP quando "Ativar servidor interno" está ligado em
Tools > Options > MCP. A WR consome isso **somente para leitura**, server-side:

```
src/lib/server/mt5-mcp-config.ts   # endpoint/API key/allowlist (fail-closed sem MT5_MCP_API_KEY)
src/lib/server/mt5-mcp-client.ts   # client MCP (client.request() de baixo nível — ver nota abaixo)
src/lib/server/mt5-mcp-tools.ts    # mapeamento capability → tool name real + normalização de payload
src/app/api/mt5/mcp/**             # rotas Next read-only (status, positions, orders, rates, tick, symbols...)
```

- Config: `MT5_MCP_ENDPOINT` (default `http://127.0.0.1:22346/mcp`) + `MT5_MCP_API_KEY` no `.env`.
- **Envio/alteração/cancelamento/fechamento de ordem foi HABILITADO em 2026-08-02** (decisão explícita do
  usuário — a WR é para o usuário E para um agente de IA executarem operações, não só consumir dados):
  - **UI manual:** `OrderForm.tsx` (mercado/limite/stop) e `OpenPositions.tsx` (botão Fechar) chamam
    `mt5Service.sendOrder/closePosition`, que batem em `/api/mt5/mcp/order/{market,pending,modify-sltp,
    delete,close,close-by}` (novas rotas WRITE, único lugar sob `/api/mt5/mcp/**` que não é read-only).
    Cada rota chama `assertTradingEligible()` (AutoTrading do terminal) antes de qualquer tool de trade.
  - **Fluxo governado do agente de IA** (`trade.propose/approve`, usado pelo Hermes): `Mt5DemoBroker`
    (`src/mcp/pilot/execution/mt5-demo-broker.ts`) agora chama `trade_send_market_order` de verdade —
    preserva TODOS os guard-rails existentes (allowlist `WR_MCP_TRADE_ALLOWLIST`, limite de notional
    `WR_MCP_TRADE_MAX_NOTIONAL`, rate limit `WR_MCP_TRADE_MAX_PROPOSALS_PER_HOUR`, código de confirmação de
    6 dígitos). **Kill switch `WR_TRADING_ENABLED=true`** no `.env` (também ligado em 2026-08-02) — sem ele,
    `approve` para em `BLOCKED_KILL_SWITCH` e nunca chama o broker.
  - Tools reais usadas (build 6090, verificadas por sonda): `trade_send_market_order`,
    `trade_send_pending_order`, `trade_modify_sl_tp`, `trade_delete_order`, `trade_close_single_position`,
    `trade_close_by_position`.
  - **Fora desta rodada:** `SpreadOrderForm.tsx`/`spreadOrderService.ts` (ordens de spread, 2 pernas)
    continuam fail-closed — superfície maior, não abordada ainda.
  - `eligibleForExecution` em `src/app/api/agents/route.ts` (4 ocorrências) continua hardcoded `false` —
    é um flag de reporte nas respostas do agente, não usado pelo gate real de `trade.propose`; não foi
    alterado nesta mudança.
- Aba **Admin** tem card dedicado "MT5 (MCP Nativo)" com botão Conectar/Desconectar (fluxo: logar na WR →
  Admin → conectar com o terminal MT5 já aberto na máquina).
- **Nomes de tool do servidor real (build 6090, verificados por sonda) NÃO são os nomes-convenção óbvios**
  — ver `TOOL_NAME_CANDIDATES` em `mt5-mcp-tools.ts` antes de assumir qualquer nome de tool novo.
- Gaps confirmados nesta versão do servidor: sem tool de "ordens abertas" isolada (vem junto no payload
  de `get_trading_open_positions`), sem "tick ao vivo" (aproximado com `get_chart_ticks_history` dos
  últimos 5 min — fica vazio fora do pregão), sem `symbol_info`/`market_book` dedicados.
- `client.request()` é usado em vez de `client.callTool()` do SDK: o servidor real declara `outputSchema`
  que não bate com o que várias tools devolvem (inclusive o pré-flight obrigatório `get_workspace_info`),
  e a validação estrita do SDK quebrava toda chamada. `client.request()` faz a mesma chamada JSON-RPC sem
  essa camada extra.

### Desktop (Electron)
```
electron/
├── main.ts             # Main process: inicia Next.js + serviços Python (spread_api, volatility_api); MCP Pilot e ML Engine sob demanda
├── preload.ts           # Preload script
└── dist/                # JavaScript compilado
```

### Dados locais do projeto
```
data/
└── options/
    └── options_data.db  # gerado em runtime; ignorado pelo Git
```

Regra arquitetural: dados locais do WR Trading Pro devem ficar dentro de `wr_trade_pro_`. Não usar `AppData`/`Roaming` como fonte de verdade do app.

## Como Rodar

### Modo desenvolvimento (4 terminais)
```bash
# Terminal 1
python python/spread_api.py

# Terminal 2
python python/volatility_api.py

# Terminal 3
python python/ml_api.py

# Terminal 4
npm run dev
```

### Executável Electron (auto-start dos serviços)
```bash
# Executável em (criar com):
npm run electron:package

# Ou usar o executável já buildado:
dist_electron/win-unpacked/WR Trade Pro.exe
# ou
release/build/win-unpacked/WR Trade Pro.exe
```

## Convenções

- **Python:** conda env `IA_Day_Trading` — todos scripts rodam aqui
- **Erros MT5:** não mudam estado de conexão global (usan `shouldChangeState` com `NON_FATAL_ERROR_CODES`)
- **Toast:** usar sistema de toast global, nunca `alert()`
- **Debounce:** 200ms em page.tsx para updates de tick
- **Candles ML:** busca via mt5Service client-side (server não tem WebSocket)
- **Next.js 15:** params são `Promise<{ id: string }>` — usar `await params`
- **Prisma:** gerar com `npm run postinstall` (ou `npx prisma generate`)

## Decisões Arquiteturais

1. **ML client-side:** tabs ML (`MLPredictionsTab`, `MLModelsTab`) buscam candles via `mt5Service` client-side, não via API routes server-side
2. **Profit DLL:** integrado como types e stub de serviço, aguardando chave de ativação da Nelogica
3. **Electron auto-start:** `electron/main.ts` faz spawn automático de `spread_api`/`volatility_api`; MCP Pilot e ML Engine são iniciados sob demanda pela aba Admin
4. **SQLite cache:** candles histórico salvo no Prisma/SQLite via `historicalDataService.syncCandles()` / `upsertCandles()`
5. **Static export:** projeto NÃO usa `output: 'export'` — mantém Next.js como servidor (API routes funcionam)
6. **Dados locais:** persistência runtime fica dentro de `data/` no repositório; o banco de opções oficial é `data/options/options_data.db`
7. **MT5 via MCP nativo, não ponte Python:** leituras (conta/posições/ordens/candles/tick/símbolos/book)
   passam pelo servidor MCP embutido do terminal MT5, consumido server-side em `src/lib/server/mt5-mcp-*`
   e exposto via `/api/mt5/mcp/**`. Trading (envio/alteração/cancelamento de ordem) é fail-closed por
   decisão de governança — ver seção "MT5 — MCP nativo" acima

## Bugs Corrigidos (não apagar)

- `mt5_bridge.py`: reenvia `STATE:CONNECTED` para clientes que reconectam *(bridge removida em 2026-08-02, ver seção MT5 MCP nativo)*
- `mt5Service`: `lastConfig` salvo para reconexões automáticas
- `mt5Service`: `GET_CHART_DATA` envia com wrapper `data: {}`
- `mt5Service`: `CHART_DATA` lê `message.data.candles`
- `mt5Service`: erros específicos com `NON_FATAL_ERROR_CODES` não mudam estado global
- `mt5Service`: `console.error` → `console.warn` para erros não-fatais (evita overlay Next.js)
- `sync-prices/route.ts`: `stringifyBigInt` em responses
- `SpreadTab`: símbolos convertidos para maiúsculo automaticamente
- **MT5 MCP nativo (2026-08-02):** nomes de tool corrigidos (eram convenção chutada, não os nomes reais do
  servidor); `client.callTool()` → `client.request()` (o servidor declara `outputSchema` que não bate com o
  retorno real, quebrando a validação estrita do SDK até no pré-flight `get_workspace_info`); `getAccountInfo`
  achata `{account, terminal}`; `getRates` traduz `timeframe/count` → `period/datetime_from/datetime_to` e
  converte `time` de `"YYYY.MM.DD HH:MM:SS"` (MT5) para epoch, que `new Date()` do browser não parseia;
  `ensureSymbolInMarketWatch` adiciona símbolos ausentes do Market Watch antes de candles/tick (só
  visibilidade, nunca abre posição) — sem isso `get_chart_history` falhava com "symbol not found" para
  PETR4/VALE3/BBDC4 (watchlist padrão do app)

## Histórico de Superpowers (SP)

- **SP1:** Fundação — Git, scripts organizados, Toast, page.tsx em 8 tabs
- **SP2:** Core Fixes — mt5Service.getChartData(), candles reais, SQLite, debounce
- **SP3:** ML Pipeline — HistoricalCandle, API candles, mlModels, backtesting
- **SP4:** UX & Admin — buildMarketContext(), AdminTab real, debounce 200ms

## Pending / A Fazer

1. Integrar Profit DLL quando chave de ativação da Nelogica estiver disponível
2. Resolver build NSIS (falha com symbolic links no Windows — requer admin ou target diferente)
3. Electron sem trava de instância única (`app.requestSingleInstanceLock()` nunca implementado em
   `electron/main.ts`) — abrir o atalho várias vezes empilha processos disputando a porta 3001 sem
   nenhum mostrar janela
4. Porta 3001 fixa (`PORT` em `electron/main.ts`) pode colidir com um `next-server` do Guardião_Hermes
   rodando no WSL (já aconteceu — `wslrelay.exe` espelha a porta do WSL pro Windows). Considerar porta
   configurável ou coordenar com o Guardião
5. Capabilities do MT5 MCP nativo ainda não testadas contra o servidor real: `history` (deals),
   `symbol_info`, `market_book`/DOM — candidatos de tool só por suposição
6. ~~Decisão em aberto: habilitar trading via MCP nativo~~ **HABILITADO em 2026-08-02** — UI manual e
   fluxo do agente de IA (`trade.propose/approve`, `WR_TRADING_ENABLED=true`) ambos enviam ordem real
7. `SpreadOrderForm.tsx`/`spreadOrderService.ts` (ordens de spread, 2 pernas) continuam fail-closed —
   não incluído na religação de 2026-08-02, superfície maior e separada
