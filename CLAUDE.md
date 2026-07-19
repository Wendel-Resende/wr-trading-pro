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
├── mt5_bridge.py        # WebSocket :8766 — bridge MT5 ↔ frontend
├── spread_api.py        # Flask :5000 — API de spreads
├── volatility_api.py    # Flask :5555 — API de volatilidade
├── profitdll_bridge.py  # Bridge Profit DLL (ainda não ativo)
└── ml_api.py           # Flask :5560 — motor ML (backfill D1, TimesFM, LightGBM)
```

### Desktop (Electron)
```
electron/
├── main.ts             # Main process: inicia Next.js + 3 serviços Python
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

### Modo desenvolvimento (5 terminais)
```bash
# Terminal 1
python python/mt5_bridge.py

# Terminal 2
python python/spread_api.py

# Terminal 3
python python/volatility_api.py

# Terminal 4
python python/ml_api.py

# Terminal 5
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
3. **Electron auto-start:** `electron/main.ts` faz spawn dos 3 serviços Python automaticamente
4. **SQLite cache:** candles histórico salvo no Prisma/SQLite via `historicalDataService.syncCandles()` / `upsertCandles()`
5. **Static export:** projeto NÃO usa `output: 'export'` — mantém Next.js como servidor (API routes funcionam)
6. **Dados locais:** persistência runtime fica dentro de `data/` no repositório; o banco de opções oficial é `data/options/options_data.db`

## Bugs Corrigidos (não apagar)

- `mt5_bridge.py`: reenvia `STATE:CONNECTED` para clientes que reconectam
- `mt5Service`: `lastConfig` salvo para reconexões automáticas
- `mt5Service`: `GET_CHART_DATA` envia com wrapper `data: {}`
- `mt5Service`: `CHART_DATA` lê `message.data.candles`
- `mt5Service`: erros específicos com `NON_FATAL_ERROR_CODES` não mudam estado global
- `mt5Service`: `console.error` → `console.warn` para erros não-fatais (evita overlay Next.js)
- `sync-prices/route.ts`: `stringifyBigInt` em responses
- `SpreadTab`: símbolos convertidos para maiúsculo automaticamente

## Histórico de Superpowers (SP)

- **SP1:** Fundação — Git, scripts organizados, Toast, page.tsx em 8 tabs
- **SP2:** Core Fixes — mt5Service.getChartData(), candles reais, SQLite, debounce
- **SP3:** ML Pipeline — HistoricalCandle, API candles, mlModels, backtesting
- **SP4:** UX & Admin — buildMarketContext(), AdminTab real, debounce 200ms

## Pending / A Fazer

1. Integrar Profit DLL quando chave de ativação da Nelogica estiver disponível
2. Resolver build NSIS (falha com symbolic links no Windows — requer admin ou target diferente)
3. Commit das mudanças pendentes (11 arquivos modificados)
