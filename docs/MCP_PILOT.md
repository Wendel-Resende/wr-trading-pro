# MCP Piloto — setup, rollout e operação

Servidor MCP **HTTP + Bearer** (`src/mcp/pilot/`) que expõe o WR Trading Pro
para agentes externos (Hermes/Claude no WSL) — diferente do MCP read-only
stdio da Fase 4. Cobre leitura rica (CVM, monitoramento, comitê de agentes,
conta/ordens/book/candles do MT5, opções/spread/volatilidade, ML) **e** um
trilho de trade governado (`trade.*`) com aprovação humana obrigatória.

Fail-closed em todas as camadas: sem tokens válidos o processo não sobe; sem
kill switch ligado nenhuma ordem chega ao broker; sem conta DEMO (por
padrão) nenhuma ordem é enviada.

## 1. Pré-requisitos

Antes de subir o `mcp-pilot`, os seguintes processos precisam estar rodando
(mesma ordem do modo desenvolvimento do projeto — ver `CLAUDE.md`):

1. **Terminal MT5 aberto e logado** numa conta (idealmente DEMO), com o
   servidor MCP nativo ligado (Tools > Options > MCP > "Ativar servidor
   interno") e `MT5_MCP_API_KEY` configurada no `.env`. Sem isso, tools de
   mercado/conta/trade retornam erro classificado do MCP nativo
   (`MT5_MCP_NOT_CONFIGURED`/`MT5_MCP_UNREACHABLE`/`MT5_DISCONNECTED`).
2. `python python/spread_api.py` (Flask `:5000`)
3. `python python/volatility_api.py` (Flask `:5555`)
4. `npm run dev` — Next.js servindo em **`:3001`** (não a porta 3000 padrão;
   ver `WR_MCP_NEXT_BASE_URL` abaixo)
5. Banco Prisma/SQLite migrado (`npx prisma migrate deploy` ou `dev`, já
   coberto pelo setup normal do projeto)

Só então subir o `mcp-pilot` (passo 4 abaixo).

## 2. Gerar os tokens

O `mcp-pilot` exige dois segredos independentes, cada um com **no mínimo 32
caracteres** (`resolvePilotConfig` em `src/mcp/pilot/config.ts` recusa subir
o processo sem eles — fail-closed):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Rode o comando duas vezes e preencha no `.env`:

- `WR_MCP_HTTP_TOKEN` — Bearer que o **cliente MCP** (Hermes) apresenta ao
  servidor `mcp-pilot`.
- `WR_SERVICE_TOKEN` — Bearer que o **próprio `mcp-pilot`** usa para chamar
  as API routes do Next (validado pelo middleware do lado do servidor
  Next.js). Não é o mesmo valor do token acima.

Nunca reutilizar `WR_AUTH_SESSION_SECRET` (já existente no projeto) para
esses dois — são segredos de superfícies diferentes.

## 3. Envs e defaults

| Variável | Default | Descrição |
|---|---|---|
| `WR_MCP_HTTP_TOKEN` | *(obrigatório, ≥32 chars)* | Bearer que o cliente MCP apresenta ao servidor |
| `WR_MCP_HTTP_HOST` | `127.0.0.1` | Interface de bind. Para expor ao WSL/Hermes, usar o IP do vswitch WSL (ex. `172.28.64.1`) |
| `WR_MCP_HTTP_PORT` | `8790` | Porta HTTP do `mcp-pilot` |
| `WR_SERVICE_TOKEN` | *(obrigatório, ≥32 chars)* | Bearer usado pelo `mcp-pilot` para chamar as API routes do Next |
| `WR_MCP_NEXT_BASE_URL` | `http://127.0.0.1:3001` | Base URL do servidor Next (nota: porta `3001`, não `3000`) |
| `WR_MCP_SPREAD_API_URL` | `http://127.0.0.1:5000` | `spread_api.py` (Flask, sem auth própria — bind loopback) |
| `WR_MCP_VOLATILITY_API_URL` | `http://127.0.0.1:5555` | `volatility_api.py` (Flask, sem auth própria — bind loopback) |
| `WR_MCP_TRADE_ALLOWLIST` | `PETR4,VALE3,ITUB4,BBDC4,ABEV3,WEGE3` | Símbolos B3 permitidos em `trade.propose` (via `RiskPolicy`) |
| `WR_MCP_TRADE_MAX_NOTIONAL` | `50000` | Notional máximo por proposta |
| `WR_MCP_TRADE_MAX_CONCENTRATION_PCT` | `20` | Concentração máxima da posição no portfólio (%) |
| `WR_MCP_TRADE_MAX_PROPOSALS_PER_HOUR` | `10` | Rate limit de `trade.propose` por `requestedBy` (fixo em `mcp:hermes` no servidor — ver §6) |
| `WR_TRADING_ENABLED` | `false` | Kill switch lido pelo `OrderIntentService` (TS). O envio real ao broker é fail-closed do lado TS (`Mt5DemoBroker`/`Mt5TradingUnavailableError`) independentemente deste valor — ver §8/§9 |
| `WR_TRADING_DEMO_ONLY` | `true` | Mantida por compatibilidade; a guarda DEMO do lado Python foi removida junto com o bridge (Ponto 4) e não tem efeito atual |

`spread_api.py`/`volatility_api.py` não recebem Bearer — são serviços Flask
locais sem autenticação própria, protegidos por bind em loopback + CORS
allowlist (`network_config`).

## 4. Subir o servidor

```bash
npm run mcp:pilot
```

Isso executa `tsc -p scripts/mcp-pilot/tsconfig.json && node
scripts/mcp-pilot/.dist/src/mcp/pilot/index.js` (ver `package.json`). Log de
sucesso:

```
[mcp-pilot] servindo em http://<host>:<port>/mcp (host=<host>)
```

Cada chamada de tool é auditada em stdout: nome da tool, `privilege`, chaves
dos argumentos (nunca os valores) e latência em ms.

## 5. Firewall Windows (restringir a porta ao WSL)

Se `WR_MCP_HTTP_HOST` for setado para o IP do vswitch WSL (para o Hermes no
WSL alcançar o `mcp-pilot` rodando no Windows), restrinja a porta 8790 ao
range do vswitch — nunca abra para `0.0.0.0`/qualquer interface. Descobrir a
sub-rede do vswitch WSL:

```powershell
wsl hostname -I           # IP do WSL, ex. 172.28.64.23
ipconfig                  # procurar o adaptador "vEthernet (WSL)" — IP do host, ex. 172.28.64.1
```

Criar a regra restrita a essa sub-rede (ajustar `172.28.64.0/20` conforme o
range real do adaptador WSL):

```powershell
New-NetFirewallRule -DisplayName "WR MCP Piloto (WSL only)" `
  -Direction Inbound -Protocol TCP -LocalPort 8790 `
  -RemoteAddress 172.28.64.0/20 -Action Allow
```

## 6. Conectar o Hermes

### Opção A — `hermes mcp add` (nativo)

```bash
hermes mcp add wr-trade-pro http://172.28.64.1:8790/mcp
```

E no YAML de config do Hermes, registrar o servidor com o header
`Authorization`:

```yaml
mcp_servers:
  wr-trade-pro:
    url: "http://172.28.64.1:8790/mcp"
    enabled: true
    timeout: 30
    headers:
      Authorization: "Bearer <WR_MCP_HTTP_TOKEN>"
```

### Opção B — cliente Python (fallback)

Usar se o runtime HTTP nativo do Hermes repetir o pitfall de erro 400 já
observado com outro servidor MCP (SQX) — documentado no vault
(`hermes-knowledge`). Cliente `mcp.client.streamable_http`:

```python
from mcp.client.streamable_http import streamablehttp_client
from mcp import ClientSession

async with streamablehttp_client(
    "http://172.28.64.1:8790/mcp",
    headers={"Authorization": "Bearer <WR_MCP_HTTP_TOKEN>"},
) as (read, write, _):
    async with ClientSession(read, write) as session:
        await session.initialize()
        tools = await session.list_tools()
```

## 7. Catálogo de tools (39 no total, 4 gated)

Todas as tools são `privilege: 'free'` exceto as 4 do trilho de trade
(`trade.*`), que são `privilege: 'gated'` — as únicas do catálogo (ver
docblock de `src/mcp/pilot/tools/trade.ts`).

**Read-only herdadas da Fase 4** (`src/mcp/tools/`, 8 tools):
- CVM: `cvm.get_facts`, `b3.get_instrument`
- Mercado (SQLite): `market.get_bars`
- Runtime: `agent_run.get`, `risk_decision.get`, `order_intent.get`
- Reconciliação: `reconciliation.report`, `dataset.feature_values`

**CVM rico** (`cvm-rich.ts`, 3 tools, free): `cvm.list_companies`,
`cvm.company_fundamentals`, `cvm.dividends_portfolio`

**Monitoramento** (`monitoring.ts`, 6 tools, free): `monitoring.list`,
`monitoring.add`, `monitoring.remove`, `alerts.list`, `alerts.create`,
`reports.get`

**Comitê de agentes** (`agent-actions.ts`, 4 tools, free): `agent_run.submit`,
`agent_run.advance`, `agent_run.cancel`, `agent_run.list`

**Conta/ordens/mercado ao vivo via MCP nativo do MT5** (`portfolio.ts`, 6
tools, free, wrappers de `src/lib/server/mt5-mcp-tools.ts`):
`portfolio.get_positions`, `portfolio.get_account`, `orders.list_open`,
`orders.history`, `market.get_live_candles`, `market.get_order_book`

**Opções/spread/volatilidade via serviços Python** (`market-live.ts`, 3
tools, free): `market.scan_options`, `market.find_spread_pairs`,
`market.get_volatility`

**Escore de fator direcional** (`ml-directional.ts`, 5 tools, free):
`ml.directional_ranking`, `ml.directional_model`, `ml.cost_profiles`,
`ml.directional_train`, `ml.training_status`

> Substituem `ml.run_prediction`/`ml.run_backtest`, removidas junto com o motor
> híbrido (rodavam heurísticas MA Crossover / Regressão Linear que se
> apresentavam como ML). Diferente das demais tools proxy, estas falam com a
> camada de APLICAÇÃO diretamente — `resolveRequestedBy` deriva o principal do
> cookie de sessão e o piloto autentica por Bearer, então as rotas
> `/api/v1/ml/*` responderiam `UNAUTHENTICATED`. `requestedBy` é fixado como
> `mcp:hermes`, como no trilho de trade.
>
> `ml.directional_train` NÃO é `gated`: neste catálogo `gated` significa
> "passa pelo trilho propose/approve com código de confirmação", e o treino não
> passa. Suas guardas reais são outras — exige `costProfileId` de um perfil
> ativo (nenhum custo default é aceito), só um treino ativo por vez
> (`TRAINING_RUN_ALREADY_ACTIVE`), roda em processo separado cancelável e fica
> auditável em `MlTrainingRun` sob `mcp:hermes`.

**Trilho de trade governado** (`trade.ts`, 4 tools, **gated**):
`trade.propose`, `trade.approve`, `trade.reject`, `trade.status`

## 8. Fluxo de aprovação (`trade.*`)

```
trade.propose(symbol, direction, volume, rationale, ...)
   │
   ├─ rate limit (WR_MCP_TRADE_MAX_PROPOSALS_PER_HOUR, por requestedBy
   │   fixo em "mcp:hermes" no servidor — nunca vem do argumento, ver
   │   docblock de trade.ts: evita burlar a cota trocando de "identidade")
   │
   ├─ snapshot real via MCP nativo do MT5 (conta/posições/preço)
   │
   ├─ RiskPolicy.evaluate (allowlist, notional máx., concentração máx.)
   │     │
   │     ├─ REJECTED  → status=RISK_REJECTED, fim (nada persistido de sensível)
   │     └─ ACCEPTED  → gera confirmationCode de 6 dígitos (só o HASH é
   │                     persistido), expiresAt = agora + 30min
   │                     status=PENDING_HUMAN
   │
   ▼
[usuário recebe o confirmationCode fora de banda (ex. no chat do Hermes)
 e decide aprovar ou não]
   │
   ▼
trade.approve(proposalId, confirmationCode)
   │
   ├─ código errado → INVALID_CODE (até 3 tentativas; na 3ª, EXPIRED)
   ├─ expirado       → PROPOSAL_EXPIRED
   ├─ código certo   → transição atômica PENDING_HUMAN → APPROVED
   │                    (fecha corrida de dois approve concorrentes)
   │     │
   │     ├─ OrderIntentService.create (kill switch: WR_TRADING_ENABLED)
   │     │     │
   │     │     ├─ kill switch OFF → status=APPROVED,
   │     │     │     executionState=BLOCKED_KILL_SWITCH (nada enviado)
   │     │     │
   │     │     └─ kill switch ON  → intent criada (idempotente por
   │     │           proposalId) → Mt5DemoBroker.send()
   │     │              │
   │     │              └─ fail-closed: sempre retorna {ok:false, error:
   │     │                   Mt5TradingUnavailableError.MESSAGE} → status=
   │     │                   EXECUTION_FAILED. Nenhuma ordem é enviada ao
   │     │                   MT5, independentemente do kill switch (a
   │     │                   ponte Python que antes enviava a ordem foi
   │     │                   removida no Ponto 4 da migração)

trade.reject(proposalId)  → status=REJECTED (só se PENDING_HUMAN)
trade.status(proposalId)  → status atual + RiskDecision + OrderIntents
```

`execution.send` (broker) **nunca** é chamado em nenhum caminho de falha
(risco rejeitado, código errado/expirado, estado inválido, kill switch
desligado) — só depois que a `OrderIntent` é criada com sucesso. Mesmo
quando chamado, hoje sempre retorna falha (ver acima) — não há caminho de
execução real neste catálogo.

## 9. Rollout em 2 etapas — ATUALMENTE: etapa 2 não resulta em execução

**Etapa 1 — validação do trilho sem risco de execução.**
`WR_TRADING_ENABLED=false` (default). Fluxo completo `propose → approve`
funciona normalmente até a criação da `OrderIntent`, mas o kill switch
bloqueia o envio: resultado é sempre `status=APPROVED,
executionState=BLOCKED_KILL_SWITCH`. Nada é enviado ao broker. Usar esta
etapa para validar rate limit, risco, código de confirmação, expiração e
auditoria — com o usuário aprovando de verdade no chat do Hermes.

**Etapa 2 — execução real em conta DEMO (NÃO disponível neste catálogo).**
A ponte Python que enviava a ordem ao MT5 foi removida no Ponto 4 da
migração para o MCP nativo. Mesmo com `WR_TRADING_ENABLED=true`,
`Mt5DemoBroker.send()` é fail-closed e sempre retorna falha — o resultado
de `approve` é sempre `status=EXECUTION_FAILED`, nunca `EXECUTED`. Setar
`WR_TRADING_ENABLED=true` não habilita envio real; serve só para validar
que o trilho chega até a chamada do broker antes de falhar.

## 10. Limitações conhecidas

- **Proposta presa em `APPROVED` sem execução.** Se o processo cair entre a
  transição `PENDING_HUMAN → APPROVED` e o envio ao broker, a proposta fica
  em `APPROVED` com `executionState` nulo — o código já foi gasto e ela
  nunca volta para `PENDING_HUMAN`. Consultável via `trade.status`; requer
  intervenção manual (não há retry automático por design, para não
  duplicar ordens).
- **Terminal MT5 fechado ou sem `MT5_MCP_API_KEY`.** Tools que dependem do
  MCP nativo (`market.get_order_book`, `portfolio.*`, `trade.propose`, etc.)
  falham com erro classificado (`MT5_MCP_NOT_CONFIGURED`/
  `MT5_MCP_UNREACHABLE`/`MT5_MCP_TERMINAL_DISCONNECTED`), não mais um
  timeout de WebSocket.
- **`trade.propose` exige MT5 aberto.** O snapshot de risco
  (`createBridgeSnapshot`) busca conta, posições e preço de referência via
  MCP nativo do MT5 em tempo real — sem o terminal MT5 aberto/logado (ou
  sem `MT5_MCP_API_KEY`), `propose` falha antes mesmo de avaliar o risco.
- **`spread_api.py`/`volatility_api.py` sem autenticação própria** — a
  segurança dessas duas rotas depende inteiramente de bind em loopback e
  não devem ser expostas fora de `127.0.0.1`.
