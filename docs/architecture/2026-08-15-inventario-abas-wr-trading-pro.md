# Inventário das abas — WR Trading Pro (baseline pré-X)

Registro do que cada aba faz HOJE, para servir de checklist de paridade
funcional ao construir a WR Trading PRO X — nada aqui deve ser perdido na
reescrita sem decisão consciente. Fonte: leitura direta do código em
2026-08-15 (`src/app/page.tsx:29-40` define a ordem/labels; cada aba mapeada
abaixo pelo componente real que ela renderiza).

## 1. Dashboard (`DashboardTab.tsx`)

Tela operacional principal.

- **Gráfico de candles** (`CandlestickChart`, lib `lightweight-charts`) com
  presets de símbolo (PETR4, VALE3, ITUB4, BBDC4, ABEV3, WEGE3) + campo livre,
  timeframes 1m–1D, indicadores MA7/MA21/MA50/RSI opcionais, toggle de volume.
- **Boleta de ordem** (`OrderForm`) — mercado/limite/stop, envia via
  `mt5Service.sendOrder` → `/api/mt5/mcp/order/*` (rotas WRITE reais).
- **Book de ofertas** (`OrderBook`) e **posições abertas** (`OpenPositions`,
  com botão Fechar).
- **Chat com IA** (`AIChat`) embutido na tela — assistente conversacional
  geral, distinto do Agente de Trading da aba Agentes.
- Recebe `accountInfo` e `tickData` via props do shell (`page.tsx`), então
  depende do estado de conexão MT5 global.

## 2. Ordens (`OrdersTab.tsx` → `MT5Orders`)

Aba fina — delega 100% para `MT5Orders`. Lista/gerencia ordens (o servidor
MCP real não tem tool isolada de "ordens abertas"; vem embutido no payload de
`get_trading_open_positions`, ver `mt5-mcp-tools.ts`).

## 3. Portfólio (`PortfolioTab.tsx` → `Portfolio`)

"Gestão de Portfólio" — visão consolidada de posições/composição da carteira
no MT5 conectado.

## 4. Ranking Fundamentalista (`RankingFundamentalistaTab.tsx`, id `"ml"`)

Renomeada de "Previsões ML" em 2026-08-11 porque o rótulo antigo prometia
previsão de mercado e nunca entregava. Hoje é explicitamente **PREDITIVO**:
escore composto de fator sobre fundamentos CVM, ordena empresas na seção
transversal do trimestre, horizonte de um trimestre — com walk-forward, IC,
t-stat e gate estatístico por trás (ver
`docs/superpowers/specs/2026-08-11-ranking-fundamentalista-design.md`). A UI
já deixa escrito: "Não é previsão de mercado nem recomendação de operação."

## 5. Saúde Financeira (`SaudeFinanceiraTab.tsx`)

Irmã da Ranking Fundamentalista, mas **DESCRITIVA**, não preditiva: quantos
trimestres (até 15 anos de histórico CVM) a empresa manteve alavancagem,
liquidez, cobertura de juros (ICJ), lucro e FCO em ordem. Sem gate, sem
modelo — é contagem sobre balanço já publicado. Inclui bloco próprio para os
10 bancos B3 com régua prudencial do BCB (Basileia, capital, inadimplência),
separado do escore da indústria porque a régua de dívida/liquidez normal
faria um banco saudável parecer doente. Ver
`docs/superpowers/specs/2026-08-12-ranking-saude-financeira-design.md`.

## 6. Spread B3 (`SpreadTab.tsx`)

A aba mais densa em sub-funcionalidades:

- **Boleta de spread** (`SpreadOrderForm`) — ordens de 2 pernas (permanece
  fail-closed desde 2026-08-02, não foi religada com o MCP nativo).
- **Painel de volatilidade** (`VolatilityPanel`) ao lado da boleta.
- **Resumo** (`SpreadSummary`), **ordens pendentes** (`SpreadPendingOrders`),
  **histórico** (`SpreadOrderHistory`), **notificações** (`SpreadNotification`,
  gerenciada automaticamente).
- Duas sub-abas internas: **Análise** (`SpreadAnalysis`) e **Buscador de
  pares** (`SpreadPairsFinder`) — período padrão de 30 dias, ganho mínimo
  configurável (default 0,10).

## 7. Opções (`OptionsTab.tsx`)

Scan de opções B3 — religado em 2026-08-12 via proxy para o `spread_api`
Python (`POST /api/options/scan`), porque o servidor MCP do MT5 não expõe
`symbol_info` (sem bid/ask/vencimento por opção não dá para escanear). Mostra:

- **Análise de volatilidade** (`VolatilityCard`) — vol. diária/anual,
  tendência semanal, movimento esperado 1d/5d/20d.
- Sinais de **Covered Call** e **Cash Secured Put** com score e ranking
  top 3/top 5, alertas.
- Mesmo dado que o agente de IA usa via `market.scan_options` — UI e agente
  enxergam exatamente a mesma fonte desde a religação.

## 8. Fundamentos CVM (`CvmFundamentalsTab.tsx`)

138 empresas B3, séries trimestrais 2011–2025, fonte **derivada** (pipeline
externo "do lab", não point-in-time — ver aviso de proveniência fixo no topo
da aba). Contém:

- Ficha fundamentalista por empresa: DRE/BPA/BPP/DFC, 31 indicadores com
  tooltip, decomposição DuPont/ROIC, valuation ampliada, valuation por
  múltiplos com preço-justo implícito, estrutura patrimonial.
- Indicadores marcados "derivado no WR" (DuPont, valuation, LPA/VPA) são
  recalculados neste projeto combinando `knowledgeDate` (CVM, estimado por
  prazo legal) com fechamento de mercado MT5/Yahoo — point-in-time real,
  diferente do resto do pipeline.
- Ranking setorial por indicador, seletor "as of" por data.
- Sub-aba **Dividendos & Carteira** — score de qualidade, carteira 12,
  sustentabilidade Monte Carlo (consome CSVs de `data/cvm/exports/`).

## 9. Monitoramento (`MonitoringTab.tsx`)

Watchlist operacional dos ativos que o usuário está acompanhando de perto:

- Tabela de monitoramento (`StockMonitoringTable`) com filtro por status
  (COMPRA/VENDA/NEUTRO/ATENÇÃO) e painel de detalhe por ativo
  (`StockDetailPanel`).
- Assina ticks MT5 de cada símbolo monitorado (sem isso `sync-prices` nunca
  roda para eles) — sujeito ao mesmo gap de "tick aproximado dos últimos 5
  min" documentado no MCP nativo.
- Sub-abas: **Alertas** (`StockAlertsPanel`), **Relatórios**
  (`StockReportsPanel`).
- **Resumo de portfólio** (`PortfolioSummary`) e **calendário de dividendos**
  por ativo (`DividendMapCalendar`).

## 10. Agentes (`AgentTab.tsx`)

Duas sub-visões:

- **Sugestão Rápida** (`AgentPanel`) — campo de ticker livre, assina tick MT5
  do ativo, roda análise via `/api/agents` (`action: suggest-operation`) com
  provider configurável (Mock, OpenAI, DeepSeek, OpenRouter, Anthropic,
  Ollama/local, LM Studio). Devolve `OperationSuggestion` (ação, entry,
  stop, take profit, quantidade, risk score, confiança, racional) —
  ferramenta de exploração/prototipagem, não passa pelos guard-rails de
  execução real.
- **Runs Governados** (`AgentRunsPanel`) — o trilho `trade.propose/approve`
  de verdade, com allowlist, limite de notional, concentração máxima, rate
  limit e aprovação humana de 6 dígitos antes de qualquer ordem real via MT5
  MCP (kill switch `WR_TRADING_ENABLED`).

## 11. Admin (`AdminTab.tsx`)

Painel operacional do próprio app, não de mercado:

- Status dos serviços auxiliares (`spread_api`, `volatility_api`, "MT5 MCP
  Nativo") com latência.
- Card dedicado MT5 — conectar/desconectar, e gestão de **perfis de conexão**
  (múltiplas contas/corretoras, ativação, API key cifrada em repouso).
- Status/controle do MCP Piloto e do ML Engine (iniciados sob demanda, ao
  contrário de `spread_api`/`volatility_api` que sobem automático com o
  Electron).

---

## O que isso implica para a WR X

Nenhuma aba está "morta" hoje — mesmo as que passaram por apagões (Opções em
2026-08-02→2026-08-12, ver seção correspondente no `CLAUDE.md`) foram
religadas antes desta rodada de planejamento. A lista acima é o piso de
paridade: qualquer redesenho da X deveria justificar explicitamente se uma
funcionalidade some, é fundida com outra, ou muda de lugar — não deixar cair
por reescrita silenciosa.
