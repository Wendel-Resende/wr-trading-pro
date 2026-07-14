# Fase 4 — MCP read-only (servidor de ferramentas somente-leitura)

Status: **especificação para implementação aditiva e não destrutiva**. Sem
execução financeira, sem `execute_order`, sem mutação de estado. Lê apenas
por meio das camadas de aplicação (`src/application/*`) já entregues nas
Fases 2 e 3 — nunca acessa o banco diretamente, nunca escreve.

Esta spec é a continuação direta da Fase 3 (runtime de agentes) e da Fase 2
(dados CVM/B3 com proveniência). O servidor MCP expõe, como *tools*, os
serviços de leitura já validados, para que um cliente MCP (por exemplo um
LLM de pesquisa) possa consultar o estado do sistema **sem poder agir**.

---

## 1. Objetivo

Oferecer uma superfície de integração padronizada (Model Context Protocol)
que permita a um cliente externo (LLM/agente de pesquisa) **ler** o estado do
WR Trading Pro:

- Dados de mercado/B3 versionados e com proveniência (Fase 2).
- Decisões de risco e intenções de ordem (Fase 3).
- Execuções de agentes, reconciliação e datasets de features.

Restrição absoluta: **nenhuma tool desta fase executa ordem, escreve no
banco, aprova, cancela ou dispara side-effect**. O `ExecutionBroker` permanece
desabilitado (igual Fases 1–3).

---

## 2. Princípios (NÃO NEGOCIÁVEIS)

1. **READ-ONLY POR CONSTRUÇÃO.** Cada tool é uma função pura sobre um
   *port* de leitura. Nenhuma tool chama `save*`, `create*`, `update*`,
   `cancel*`, `execute*`. O próprio servidor MCP NÃO importa adaptadores de
   escrita (ex.: `src/adapters/prisma/risk-policy/repository.ts` no modo
   escrita) — consome apenas os `service.ts` de leitura e seus `ports`.
2. **SEM LLM DENTRO DO SERVIDOR.** O MCP server é um repassador de dados;
   não invoca modelo, não toma decisão. O cliente MCP é quem decide.
3. **SEM EXECUÇÃO.** Não existe `execute_order`, `approve`, `cancel`,
   `createIntent` entre as tools. O kill switch `WR_TRADING_ENABLED` continua
   como janela de ordens (Fases 1–3); aqui ele é irrelevante para leitura,
   mas o servidor NÃO deve oferecer nenhum caminho que contorne o gate.
4. **ADITIVO.** Não remova nem altere Fases 2/3, `tradingAgentsService`,
   `MLPredictionsTab`, `src/app/api/agents/**`, nem `docs/CODEX_HANDOFF.md`.
5. **REUTILIZE, NÃO DUPLIQUE.** As tools montam sobre os services existentes
   (`src/application/*`). Não recrie consultas Prisma fora dos adapters.

---

## 3. Superfície de transporte

- **Modo preferencial (primeiro ciclo):** `stdio` local. O servidor é
  iniciado como processo filho (ex.: `npm run mcp:start`), sem exposição de
  rede. Isso elimina superfície de ataque de rede (ver CR-2/CR-3 do dossiê).
- **Modo opcional (segundo ciclo, fora desta spec):** HTTP/SSE vinculado a
  `127.0.0.1` com token efêmero derivado da sessão (reaproveitando o
  middleware de autenticação da Fase 0, item 9/10). **Não** esteja nesta
  spec; se vierem a implementar, siga CR-2/CR-3.
- **Não** vincule a `0.0.0.0`. **Não** aceite CORS irrestrito.

Configuração via `env` (não hardcode):
- `WR_MCP_TRANSPORT` (`stdio` | `http`, default `stdio`).
- `WR_MCP_HTTP_PORT` (apenas se `http`; default `8787`, bind `127.0.0.1`).
- `WR_MCP_HTTP_TOKEN` (apenas se `http`; obrigatório nesse modo).

---

## 4. Catálogo de tools (primeiro ciclo)

Cada tool recebe `inputSchema` (JSON Schema) e retorna `content` estruturado.
Todas são deterministicas e idempotentes (leitura).

### 4.1 — Dados de mercado / B3 / CVM (Fase 2)

- `cvm.get_facts`
  - input: `{ ticker: string, asOf?: string (ISO-8601), scope?: 'CON'|'IND', limit?: int>=1 }`
  - fonte: `src/application/feature-value` / `dataset-snapshot` + read-models
    de CVM (Fase 2). Retorna fatos point-in-time com `knowledgeTime`.
- `b3.get_instrument`
  - input: `{ instrumentId: string }`
  - fonte: `Instrument`/`InstrumentCatalog` (porta de domínio, Fase 1/2).
- `market.get_bars`
  - input: `{ instrumentId: string, from: string, to: string, timeframe?: string }`
  - fonte: `MarketBar` (read-model versionado, Fase 2). Respeita
    `knowledgeTime <= consulta` (sem lookahead — CR-9).
- `portfolio.snapshot`
  - input: `{ asOf?: string }`
  - fonte: `PortfolioProvider` (porta, Fase 1). Somente leitura.

### 4.2 — Runtime de agentes (Fase 3)

- `agent_run.get`
  - input: `{ runId: string }` | `{ status?: string, limit?: int>=1 }`
  - fonte: `src/application/agent-run` (Item 1/2 da Fase 3).
- `risk_decision.get`
  - input: `{ decisionId: string }` | `{ runId?: string, outcome?: 'APPROVED'|'REJECTED', limit?: int>=1 }`
  - fonte: `src/application/risk-policy` (Item 3 da Fase 3).
- `order_intent.get`
  - input: `{ intentId: string }` | `{ decisionId?: string, status?: 'CREATED'|'CANCELLED', limit?: int>=1 }`
  - fonte: `src/application/order-intent` (Item 4 da Fase 3). **Somente
    leitura** — não cria/cancela intenção.
- `reconciliation.report`
  - input: `{ dataset?: string, limit?: int>=1 }`
  - fonte: `src/application/reconciliation` (Fase 2, item 6).
- `dataset.feature_values`
  - input: `{ datasetId: string, asOf?: string, limit?: int>=1 }`
  - fonte: `src/application/feature-value` + `dataset-snapshot` (Fase 2).

> O catálogo acima é o mínimo do primeiro ciclo. Se faltar um service de
> leitura para alguma tool, **crie a tool apenas se o service existir**;
> não implemente a tool apontando para escrita.

---

## 5. Estrutura de arquivos (aditiva)

```
src/mcp/
  index.ts                 # entrypoint (stdio/http conforme env)
  server.ts                # monta o servidor MCP (sem LLM, sem escrita)
  tools/
    registry.ts            # catálogo de tools + inputSchemas
    cvm.ts                 # cvm.get_facts, b3.get_instrument
    market.ts              # market.get_bars, portfolio.snapshot
    runtime.ts             # agent_run.get, risk_decision.get, order_intent.get
    reconciliation.ts      # reconciliation.report, dataset.feature_values
  ports/
    mcp-read-service.ts    # interfaces de leitura consumidas pelas tools
  config.ts                # resolve WR_MCP_* do env (adapter, não núcleo)
scripts/mcp/
  run-mcp-tests.cjs        # harness: sobe servidor em modo teste
  mcp-test.ts              # casos de teste (ver seção 8)
  tsconfig.json            # igual aos harness anteriores
package.json               # + "mcp:start" e "test:mcp"
```

- `src/mcp/server.ts` e `tools/*` importam **apenas** services de leitura e
  seus ports. Proibido importar `src/adapters/prisma/*/repository.ts` em modo
  escrita ou qualquer `execute*`/`cancel*`.
- `mcp-read-service` é uma fachada fina que injeta os services existentes
  (reutiliza `compose.ts` de cada application domain).

---

## 6. Contratos de resposta

- Cada tool retorna objeto estável: `{ content: [...], isError?: false }`.
- Em erro de entrada (schema inválido, id inexistente), retorna
  `isError: true` com mensagem sanitizada (sem stack, sem SQL, sem detalhe de
  driver) — reutilize `ReadModelError`/`jsonError` padrão das Fases 2/3.
- `market.get_bars` **nunca** retorna candle com `time > knowledgeTime da
  consulta` (sem lookahead — CR-9 do dossiê).
- `cvm.get_facts` respeita `asOf` point-in-time (Fase 2): retorna o estado
  "as known on date T".

---

## 7. Segurança e kill switch

- Servidor MCP **não oferece** nenhuma tool de escrita/execução. A prova de
  "read-only" é um teste automatizado (seção 8, item R-LO-1).
- `WR_TRADING_ENABLED` não afeta leitura, mas o servidor **não deve** expor
  qualquer primitiva que contorne o gate de ordens das Fases 1–3.
- Se `WR_MCP_TRANSPORT=http`, exige `WR_MCP_HTTP_TOKEN` e bind
  `127.0.0.1`; ausência de token → falha ao iniciar (fail-closed).

---

## 8. Testes (harness `scripts/mcp`)

`npm run test:mcp` deve rodar com SQLite temporário (padrão dos itens
anteriores) e cobrir:

- **R-LO-1 (read-only garantido):** assertiva de que nenhuma tool chama
  método de escrita — verificado por spy no repositório (nenhum `save*`,
  `create*`, `update*`, `cancel*`, `execute*` é invocado durante qualquer
  tool call). Se um mutation for detectado, o teste falha.
- **R-LO-2:** `cvm.get_facts` com `asOf` retorna estado point-in-time
  correto (fatos posteriores a `asOf` não aparecem).
- **R-LO-3:** `market.get_bars` com `to` não retorna candles com
  `time > knowledgeTime` (sem lookahead).
- **R-LO-4:** `risk_decision.get` / `order_intent.get` / `agent_run.get`
  retornam os registros criados nos testes das Fases 2/3 (reescreva/reutilize
  fixtures mínimas em SQLite temp).
- **R-LO-5:** `b3.get_instrument` / `portfolio.snapshot` retornam contrato
  estável (sem `null` inesperado, campos obrigatórios presentes).
- **R-LO-6:** entrada inválida (schema) → `isError: true` com mensagem
  sanitizada; sem vazamento de stack/SQL.
- **R-LO-7:** `WR_MCP_TRANSPORT=http` sem `WR_MCP_HTTP_TOKEN` → falha ao
  iniciar (fail-closed).
- **R-LO-8:** `stdio` sobe e responde a `tools/list` + `tools/call` de uma
  tool de leitura com sucesso.
- **Regressões obrigatórias:** `prisma validate`, `tsc --noEmit`,
  `build` Next.js, e os `test:*` existentes (risk-policy, agent-run,
  reconciliation, dataset-feature, cvm-facts, market-bar, reference-data,
  smoke:auth, order-intent). Nenhuma regressão permitida.

---

## 9. Fora de escopo (decisão explícita)

- `execute_order`, `approve`, `cancelIntent`, `createIntent` — **não** entram.
- Transporte HTTP/SSE com auth completo — ciclo posterior (ver seção 3).
- Escrita em qualquer tabela — proibida nesta fase.
- Alteração de `tradingAgentsService`, `MLPredictionsTab`,
  `src/app/api/agents/**` — proibida.

---

## 10. Fluxo de release (padrão do projeto)

1. Guardião escreve esta spec e faz push.
2. Claude Code (Windows, Sonnet 5) implementa em worktree isolado, **sem
   commit**.
3. Guardião revisa o diff e roda validação independente (WSL+Windows):
   `prisma validate`, `tsc --noEmit`, `build`, `test:mcp` (R-LO-1..8) e as
   regressões da seção 8.
4. Guardião publica (commit + push) apenas após validação verde.

Se houver desvio da spec, o Claude reporta; o Guardião decide antes de
publicar.
