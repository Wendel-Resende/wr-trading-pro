# MCP Piloto — Design (2026-07-17)

Status: aprovado pelo usuário em 2026-07-17 (seções validadas uma a uma).
Referências: MCP read-only Fase 4 (`src/mcp/`), workflow governado Fase 1
(`TradeProposal → RiskDecision → HumanApprovalReceipt → OrderIntent →
ExecutionResult`), vault `strategyquant-x-mcp-integration` (padrão de consumo
MCP HTTP do Hermes no WSL), `docs/CODEX_HANDOFF.md` (sessões 2026-07-15/17).

## Objetivo

Transformar o MCP da plataforma de "janela de leitura" em **cockpit do
agente**: o Hermes Agent (Guardião, rodando no WSL) opera a WR Trading Pro
pelas mesmas portas de entrada que a UI usa — todas as ferramentas de todas
as abas (exceto Admin) com **acesso livre**, e **uma única ferramenta com
gate de aprovação humana: execução de ordem**, que na v1 executa somente em
conta DEMO.

## Decisões de escopo (com o usuário)

1. **Política de privilégio:** todas as ferramentas de análise, pesquisa,
   mercado, conta e monitoramento são de acesso livre para o agente. Só o
   grupo `trade.*` (ordem) exige aprovação do usuário.
2. **Aprovação via chat do Hermes:** `trade.approve` é ferramenta MCP; o
   usuário diz "aprovo" no chat e o agente chama a tool. Controle
   compensatório: `confirmationCode` de 6 dígitos por proposta (ver seção 4).
   O usuário escolheu esta variante ciente de que o gate depende do
   comportamento do agente; as travas duras ficam no risco/kill switch/DEMO.
3. **Execução v1: só conta DEMO.** A guarda é no bridge Python
   (`account_info().trade_mode`), independente do Node. Conta real é fase
   futura, com mudança consciente de código + env.
4. **Cobertura v1: a plataforma inteira, exceto Admin.** Aba Admin fica fora
   por decisão explícita (configuração/logs administrativos; sem valor para o
   piloto e com risco desnecessário).
5. **Rollout em 2 etapas:** primeiro com kill switch desligado (trilho para
   no intent aprovado); após validação de comportamento, liga
   `WR_TRADING_ENABLED` para a DEMO.

Abordagem escolhida: **C — MCP como proxy governado das APIs existentes.**
O servidor MCP standalone chama as rotas HTTP do Next e dos serviços Python
(mesmas portas de entrada da UI). Rejeitadas: (A) MCP "gordo" compondo
services via Prisma direto — duplicaria composição e criaria um segundo
caminho para as mesmas operações; (B) MCP dentro do Next — exigiria expor o
app inteiro fora do loopback.

## 1. Arquitetura

```
Hermes (WSL) ──HTTP+Bearer──▶ wr-mcp-pilot (Windows, :8790, Streamable HTTP)
                                   │
                     ┌─────────────┼──────────────────┐
                     ▼             ▼                  ▼
              Next :3001      spread_api :5000   volatility_api :5555
              (loopback,      (loopback)         (loopback)
               service token)                          │
                     │                                 └──▶ MT5 terminal
                     └──▶ Prisma / cvm_fundamentos.db       mt5_bridge :8766
```

- **Processo novo:** `wr-mcp-pilot` (Node/TS no repo, `npm run mcp:pilot`),
  SDK `@modelcontextprotocol/sdk` com `StreamableHTTPServerTransport` — o
  mesmo protocolo validado entre Hermes/WSL e o SQX.
- **Rede:** escuta em `WR_MCP_HTTP_HOST` (default `127.0.0.1`; para o WSL,
  configurar explicitamente o IP do vswitch, ex. `172.28.64.1`) e
  `WR_MCP_HTTP_PORT` (default `8790`). `WR_MCP_HTTP_TOKEN` (≥32 chars) é
  obrigatório — sem token o processo não sobe (fail-closed). Next e serviços
  Python permanecem loopback-only.
- **Autenticação máquina-a-máquina no Next:** o middleware aceita
  `Authorization: Bearer <WR_SERVICE_TOKEN>` como alternativa à sessão
  **somente para rotas `/api/*`** (páginas continuam exigindo sessão).
  Sem a env, o Bearer é recusado (fail-closed). O `wr-mcp-pilot` usa esse
  token nas chamadas ao Next.
- **Catálogo único:** as 8 tools read-only do MCP Fase 4 são registradas no
  mesmo servidor piloto — o Hermes conecta em um endpoint só.
- O MCP read-only stdio existente permanece intocado (retrocompatível).

## 2. Catálogo de ferramentas v1 (~30 tools)

| Grupo | Tools | Caminho | Privilégio |
|---|---|---|---|
| Leitura auditada (existentes) | `market.get_bars`, `cvm.get_facts`, `b3.get_instrument`, `agent_run.get`, `risk_decision.get`, `order_intent.get`, `reconciliation.report`, `dataset.feature_values` | services read (como hoje) | free |
| CVM rico | `cvm.list_companies`, `cvm.company_fundamentals`, `cvm.dividends_portfolio` | `/api/cvm/*` | free |
| Agentes/Comitê | `agent_run.submit` (template simples/comitê, ticker, pergunta, provedor/modelo), `agent_run.advance`, `agent_run.cancel`, `agent_run.list` | `/api/v1/agent-runs*` | free |
| Mercado vivo | `market.scan_options`, `market.find_spread_pairs`, `market.get_live_candles`, `market.get_volatility`, `market.get_order_book` | serviços Python (MT5) | free |
| Conta/Operação | `portfolio.get_positions`, `portfolio.get_account`, `orders.list_open`, `orders.history` | bridge :8766 | free |
| Monitoramento | `monitoring.list`, `monitoring.add`, `monitoring.remove`, `alerts.list`, `alerts.create`, `reports.get` | `/api/stock-*` | free |
| ML | `ml.run_prediction`, `ml.run_backtest` | motor TS server-side + candles do bridge | free |
| Ordem | `trade.propose`, `trade.approve`, `trade.reject`, `trade.status` | trilho governado (seção 3) | **gated** |

Notas de implementação:

- **Opções server-side:** o scan hoje roda no browser; expor o motor do
  `scanner_opcoes.py` por rota nova em um serviço Python existente (mesma
  lógica OTM/ranking, mesmo banco `data/options/options_data.db`).
- **Conta/ordens/candles/book via bridge:** o `wr-mcp-pilot` conecta ao
  bridge :8766 como cliente WebSocket autenticado — gera o token efêmero
  com o `WR_WS_TOKEN_SECRET` compartilhado (mesmo mecanismo do Next) e usa
  os handlers existentes (`GET_ACCOUNT_INFO`, `GET_POSITIONS`, etc.).
  Pré-condição: terminal MT5 aberto e logado; sem MT5, as tools retornam
  erro claro (`MT5_DISCONNECTED`) — nunca dado inventado/sintético.
- **ML server-side:** o motor de backtest/modelos é TypeScript puro; o
  `wr-mcp-pilot` busca candles via bridge e roda o motor no próprio processo.
- **Cada tool declara `privilege: 'free' | 'gated'` no registro** — nenhuma
  tool futura entra sem classificação consciente.

## 3. Trilho de ordem e execução DEMO

`trade.propose` nunca fala com o MT5. Fluxo completo:

1. `trade.propose(symbol, direction, volume, stopLoss?, takeProfit?, rationale)`
   → `TradeProposal` persistida → **motor de risco determinístico**
   (`RiskPolicy` existente) avalia na hora.
   - Reprovado → proposta morre com o motivo; Hermes recebe o veredito.
   - Aprovado pelo risco → status `PENDING_HUMAN` + `confirmationCode`
     (6 dígitos, gerado server-side, devolvido só na resposta do propose).
2. O Hermes apresenta a proposta + código ao usuário no chat. O usuário
   decide. `trade.approve(proposalId, confirmationCode)` →
   `HumanApprovalReceipt` gravado com canal `mcp:hermes` e timestamp.
   - Código errado → rejeita (sem revelar o correto); N tentativas erradas
     (3) expiram a proposta.
   - `trade.reject(proposalId)` registra rejeição explícita.
   - Proposta não aprovada **expira em 30 minutos**.
3. Aprovada → `OrderIntent` → **`Mt5DemoExecutionBroker` (novo)** → ordem
   enviada via bridge :8766 pelo caminho de ordem existente (Fase 0:
   `order_check()` + kill switch).
4. Travas independentes no bridge Python (valem mesmo se o Node for burlado):
   - (a) `WR_TRADING_ENABLED=true` obrigatório (kill switch mestre;
     default `false`);
   - (b) **guarda DEMO dura:** `account_info().trade_mode` ≠ DEMO → recusa
     com erro explícito.
5. `ExecutionResult` persistido (ticket, preço, horário). `trade.status(proposalId)`
   devolve o ciclo completo: proposta → risco → aprovação → intent → execução.

**Rate limit:** máx. 10 `trade.propose`/hora (configurável); excedente é
recusado com erro claro. Aplica-se só ao grupo `trade.*`.

## 4. Segurança

- **Fail-closed em toda a cadeia:** sem `WR_MCP_HTTP_TOKEN` → servidor não
  sobe; sem `WR_SERVICE_TOKEN` → Next recusa Bearer; bridge sem DEMO →
  recusa ordem; kill switch off → nenhuma execução, mesmo aprovada.
- **Exposição mínima e explícita:** default loopback; alcançar do WSL exige
  `WR_MCP_HTTP_HOST` deliberado. Documentar regra de firewall do Windows
  restringindo a porta ao vswitch do WSL.
- **Auditoria:** toda chamada de tool logada (nome, args resumidos,
  resultado, latência) com o redator de segredos existente. Propostas,
  decisões de risco, aprovações e execuções são linhas persistidas.
- **Sem segredos via MCP:** nenhuma tool expõe env, chaves, credenciais MT5
  ou configuração interna.
- **`confirmationCode`** protege contra aprovação acidental/impulsiva do
  modelo e cria rastro deliberado; as garantias duras contra ordem indevida
  são o motor de risco + kill switch + guarda DEMO (o usuário aceitou
  explicitamente que o gate de chat depende do comportamento do agente).

## 5. Testes e validação

- **`test:mcp` estendida (TDD):** catálogo completo com schemas; fluxo
  `propose→risk→approve→execute` com broker fake; código errado rejeita
  (3 erros expiram); proposta expirada rejeita; rate limit; Bearer
  ausente/errado → 401; tool `gated` não executa fora do fluxo; classificação
  `privilege` presente em toda tool.
- **Testes Python do bridge:** guarda DEMO (conta não-demo → recusa),
  kill switch off → recusa; caminho de ordem com `order_check`.
- **E2E real:** subir tudo, `hermes mcp add wr-trade-pro
  http://172.28.64.1:8790/mcp` (com token), e dirigir: list_tools → comitê →
  scan de opções → posições → propose → aprovação no chat → execução na
  XPMT5-DEMO → `trade.status` completo.
- **Rollout:** etapa 1 com kill switch off (trilho até intent aprovado);
  etapa 2, após validação de comportamento por alguns dias, liga a execução
  DEMO.

## Fora de escopo (v1)

- Aba Admin via MCP.
- Execução em conta real (fase futura, decisão consciente separada).
- Aprovação fora do chat do Hermes (UI/notificação — pode ser v1.1).
- Transporte stdio para o piloto (o read-only stdio existente permanece).
- Múltiplos consumidores/tokens por agente (um token único na v1).
