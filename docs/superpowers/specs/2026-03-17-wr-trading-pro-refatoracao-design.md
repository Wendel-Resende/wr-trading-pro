# WR Trading Pro — Refatoração Profissional
**Data:** 2026-03-17
**Abordagem:** Híbrido Progressivo (limpeza cirúrgica + refatoração incremental por módulo)
**Usuário:** Single-user agora, arquitetura preparada para multi-user futuro
**Mercado:** B3 (Bolsa brasileira) via MetaTrader 5 (atual) + Profit DLL (futuro)

---

## Contexto

A plataforma WR Trading Pro é um sistema de trading profissional em Next.js/TypeScript com backend Python. Possui 8 funcionalidades: Dashboard, Ordens, Portfólio, Previsões ML, Modelos ML, Spread B3, Monitoramento e Admin.

**Problemas atuais:**
- `page.tsx` com 1238 linhas gerencia todas as 8 abas — dados somem ao trocar de aba
- Spread orders persistidas só em `localStorage` — perdem ao reiniciar
- Preços do Monitoramento não atualizam via MT5 — atualização manual
- Dashboard sem candles reais — `chartData` nunca é preenchido
- Previsões ML sem dados reais — recebe `data=[]`
- Scripts Python desorganizados na raiz junto com o projeto Next.js
- Uso de `alert()` em vez de notificações elegantes

---

## Sub-projeto 1 — Fundação

### 1.1 Reorganização de Scripts Python

**Mover para `python/`** (scripts ativos que servem o Next.js):
- `mt5_bridge.py` — WebSocket bridge MT5 → Next.js (porta 8766)
- `spread_api.py` — API REST de análise de spread (porta 5000)
- `volatility_api.py` — API REST de volatilidade (porta 5555)
- `profitdll_bridge.py` — bridge Profit DLL (futuro)
- `spread_requirements.txt` → renomear para `requirements.txt` dentro de `python/`

**Mover para `scripts/utils/`** (análises one-off, não deletar ainda):
- `analyze_orders.py`, `analyze_monitoramento.py`, `detailed_analysis.py`
- `import_spreadsheet_data.py`, `analyze_planilha.py`
- `analisa_planilha_calculos.py`, `analisa_monitoramento_completo.py`

**Mover para `scripts/tests/`** (testes manuais):
- `run_api_test.py`, `test_spread_api.py`, `test_current_prices.py`, `test_asset_creation.py`

**Mover para `archive/projeto_spread_legacy/`**:
- Todo o conteúdo de `Projeto_spread/` (protótipo Streamlit antigo)

**Mover para `docs/`**:
- Todos os arquivos `.md` da raiz (`MT5_BRIDGE_README.md`, `SPREAD_ANALYSIS_README.md`, etc.)

**Manter onde está:**
- `ProfitDLL/` — referência para integração futura

**Deletar no futuro** (após tudo validado): `scripts/utils/`, `scripts/tests/`, `archive/`

### 1.2 Arquitetura de Navegação

**Problema:** Tudo em `page.tsx` — ao trocar de aba o React re-renderiza e perde estado.

**Solução: Kept-alive + Lazy Loading**

```
src/app/page.tsx (~150 linhas)
  └── Shell: header fixo + barra de abas + mount/unmount das abas
      ├── <DashboardTab />      lazy, kept-alive após 1ª montagem
      ├── <OrdersTab />         lazy, kept-alive
      ├── <PortfolioTab />      lazy, kept-alive
      ├── <SpreadTab />         lazy, kept-alive
      ├── <MonitoringTab />     lazy, kept-alive
      ├── <MLPredictionsTab />  lazy, kept-alive
      ├── <MLModelsTab />       lazy, kept-alive
      └── <AdminTab />          lazy, kept-alive

src/components/tabs/
  ├── DashboardTab.tsx
  ├── OrdersTab.tsx
  ├── PortfolioTab.tsx
  ├── SpreadTab.tsx
  ├── MonitoringTab.tsx
  ├── MLPredictionsTab.tsx
  ├── MLModelsTab.tsx
  └── AdminTab.tsx
```

**Kept-alive:** Implementado via CSS wrapper simples em `page.tsx` — sem biblioteca externa. Cada aba monta uma vez. Ao trocar de aba, a anterior fica `display: none` — não desmonta, não perde estado, não perde conexão MT5.

**Lazy loading:** Cada aba só carrega quando clicada pela primeira vez (`React.lazy` + `Suspense`). Reduz consumo de RAM inicial.

### 1.3 Sistema de Toast (substituir alert())

Implementar componente `<ToastProvider>` global com notificações elegantes:
- Sucesso (verde), erro (vermelho), aviso (amarelo), info (azul)
- Aparece no canto inferior direito, auto-fecha em 4s
- Substituir todos os `alert()` e `confirm()` da aplicação
- `SpreadNotification.tsx` existente será refatorado para usar o `ToastProvider` e removido como componente separado

### 1.4 Header Fixo Global

O header com status MT5, saldo, equity, margem e resultado do dia fica visível em **todas as abas**. Dados da conta atualizam em tempo real via eventos MT5.

---

## Sub-projeto 2 — Core Fixes

### 2.1 Dashboard — Candles Reais

**Problema:** `chartData` inicializado como `[]`, nunca preenchido.

**Solução:**
1. Ao conectar MT5, buscar candles históricos do símbolo selecionado via `mt5_bridge.py`
2. A cada tick recebido, atualizar o último candle ou criar novo candle
3. Ao mudar símbolo ou timeframe, buscar novos candles
4. Indicadores técnicos (MA7, MA21, RSI, MACD) calculados sobre os dados reais

### 2.2 Spread B3 — Persistência no Banco

**Problema:** `SpreadOrderService` lê/escreve `localStorage` diretamente, ignorando a API.

**Solução:**
1. O modelo `SpreadOrder` no Prisma e a rota `/api/spread-orders` já existem e funcionam
2. Reescrever `spreadOrderService.ts` para chamar a API REST em vez de `localStorage`
3. Ao iniciar o serviço, carregar ordens pendentes via `GET /api/spread-orders`
4. Criar/atualizar ordens via `POST/PUT /api/spread-orders`
5. Remover toda dependência de `localStorage` no `SpreadOrderService`

### 2.3 Spread B3 — Monitoramento em Tempo Real

**Problema:** Spread não recalcula ao receber ticks, ordem fica "congelada".

**Solução:**
1. A cada tick do MT5 para os símbolos do spread, recalcular spread atual
2. Comparar com target e stop configurados
3. Atualizar status da ordem automaticamente (`AGUARDANDO → EXECUTADA / CANCELADA`)
4. Disparar notificação toast quando spread atinge o alvo

### 2.4 Monitoramento — Pipeline de Preços

**Problema:** Preços não atualizam automaticamente, status COMPRA/VENDA não recalcula.

**Solução:**
1. Ao carregar Monitoramento, subscrever ticks MT5 para cada símbolo monitorado
2. Pipeline: `tick MT5 → atualizar preço em memória → debounce 5s → salvar no banco → recalcular status`
3. Salvar no banco apenas no debounce (não em cada tick) para evitar sobrecarga no SQLite
4. Status recalcula com base nos fundamentos cadastrados vs preço atual
5. Indicador visual: preço próximo do ponto de entrada ideal

### 2.5 Boleta — Envio Real de Ordens

**Problema:** `OrderForm` não envia ordens reais ao MT5.

**Solução:**
1. Integrar `OrderForm` com `mt5Service.sendOrder()`
2. Feedback visual de confirmação/rejeição da ordem
3. Atualizar lista de ordens abertas após execução

---

## Sub-projeto 3 — ML Pipeline

### 3.1 Dados Históricos do MT5

- Buscar OHLCV histórico via `mt5_bridge.py` para qualquer símbolo/timeframe
- Armazenar no banco SQLite para reutilização (evitar chamadas repetidas)
- Interface para selecionar símbolo, timeframe e período de treinamento

### 3.2 Modelos Base

**Modelos iniciais (com dados MT5):**
- Média Móvel com sinal de cruzamento (baseline simples)
- Regressão Linear para tendência de curto prazo
- Interface para ver métricas: acurácia, MAE, retorno simulado

**Preparado para Profit DLL:**
- Arquitetura de serviço modular — trocar fonte de dados sem mudar o modelo
- Modelos mais avançados (LSTM, Random Forest) quando Profit DLL estiver integrada

### 3.3 Backtesting

- Testar modelo sobre dados históricos
- Métricas: win rate, drawdown máximo, retorno total
- Comparar múltiplos modelos na aba Modelos ML

---

## Sub-projeto 4 — UX & Admin

### 4.1 AI Chat com Contexto de Mercado

- Injetar contexto via system prompt em `llmService.ts` antes de cada requisição
- Contexto incluído: preço atual do símbolo selecionado, posições abertas, resultado do dia, saldo
- O projeto suporta múltiplos providers (OpenAI, Deepseek, Ollama, Groq) — contexto funciona em todos
- Respostas mais relevantes para decisões de trading na B3

### 4.2 Admin com Métricas Reais

- Status dos serviços Python (mt5_bridge, spread_api, volatility_api)
- Métricas de performance: uptime, latência das APIs
- Log de erros em tempo real
- Substituir dados mockados por métricas reais

### 4.3 Performance

- Virtualização de listas longas (histórico de ordens, monitoramento com muitas ações)
- Debounce em atualizações de tick para evitar re-renders excessivos
- Code splitting: cada aba carrega só o que precisa

---

## Arquitetura Final

```
wr_trade_pro_/
├── src/                          ← Next.js principal
│   ├── app/
│   │   ├── page.tsx              ← shell (~150 linhas)
│   │   ├── layout.tsx            ← ToastProvider, MT5Provider
│   │   └── api/                  ← API routes
│   ├── components/
│   │   ├── tabs/                 ← 8 componentes de aba
│   │   ├── ui/                   ← componentes reutilizáveis
│   │   └── [outros componentes]
│   └── services/                 ← serviços (mt5, spread, etc.)
├── prisma/                       ← schema + banco SQLite
├── python/                       ← scripts Python ativos
│   ├── mt5_bridge.py
│   ├── spread_api.py
│   ├── volatility_api.py
│   ├── profitdll_bridge.py
│   └── requirements.txt
├── scripts/
│   ├── utils/                    ← análises one-off (deletar depois)
│   └── tests/                    ← testes manuais (deletar depois)
├── archive/
│   └── projeto_spread_legacy/    ← protótipo antigo (deletar depois)
├── ProfitDLL/                    ← referência DLL
└── docs/
    └── superpowers/specs/        ← este documento
```

---

## Ordem de Execução

**SP1 → SP2 → SP3 e SP4 em paralelo**

- SP1 (Fundação) é pré-requisito para tudo: tabs devem existir como componentes separados antes de corrigir seu conteúdo
- SP2 (Core Fixes) depende de SP1: cada fix vai dentro do componente de aba correto
- SP3 (ML) depende de SP2.1 (dados históricos MT5 disponíveis)
- SP4 (UX & Admin) pode ser feito em paralelo com SP3

---

## Critérios de Sucesso

- [ ] Trocar de aba não perde dados nem conexão MT5
- [ ] Ordens de spread persistem após reiniciar a plataforma
- [ ] Preços no Monitoramento atualizam automaticamente via MT5
- [ ] Dashboard exibe candles reais com indicadores funcionando
- [ ] Boleta envia ordens reais ao MT5
- [ ] Previsões ML exibe dados reais do MT5 (não placeholder)
- [ ] Modelos ML operacional com backtesting básico
- [ ] Zero `alert()` — notificações toast em todo o sistema
- [ ] Raiz do projeto limpa — só configs e pastas organizadas
- [ ] `page.tsx` reduzido de 1238 para ~150 linhas
- [ ] Scripts Python organizados em `python/` com porta documentada por serviço
