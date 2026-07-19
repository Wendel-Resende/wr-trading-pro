# CODEX_HANDOFF — WR Trading Pro

Última atualização: 2026-07-18 (noite)

## Sessão 2026-07-18 — ML Híbrido v1 (branch `feat/ml-hibrido`)

Upgrade da camada ML: modelo de direção a 10 pregões (LightGBM) sobre features
point-in-time — preço + fundamentos CVM defasados pelo prazo legal (ITR +45d,
DFP +90d) + TimesFM 2.5 200M zero-shot como feature — com walk-forward anual
(embargo 21 pregões), 4 baselines e gate estatístico (bootstrap em blocos
ticker-mês, IC95%) no trilho governado da Fase 5 (primeiro consumidor real).
Fluxo: brainstorm → spec (`docs/superpowers/specs/2026-07-18-ml-hybrid-upgrade-design.md`)
→ plano 12 tasks (`docs/superpowers/plans/2026-07-18-ml-hybrid-upgrade.md`)
→ subagentes com review por task. Guia operacional: `docs/ML_HYBRID.md`.

### Entregas

1. `python/ml/` novo: candles (backfill D1 MT5 full-refresh), features de
   preço, fundamentos point-in-time, adapter TimesFM (lazy, cache parquet,
   GPU RTX 4060 — torch 2.6.0+cu124 instalado no conda), dataset builder com
   teste anti-vazamento, walk-forward + treino. 7 suítes de teste.
2. `python/ml_api.py` (Flask :5560, loopback, deps injetáveis) + card
   "ML Engine" na aba Admin (Electron liga/desliga, padrão MCP Pilot).
3. Next: `src/application/ml-hybrid/` (gate determinístico mulberry32 +
   orquestração) e rotas `/api/v1/ml/{backfill,train,predict}`;
   `ResearchRun` sempre, `ModelVersion` só se gate aprovar, `Signal` nas
   previsões ao vivo. Suíte `npm run test:ml-hybrid`.
4. UI: visão "Híbrido governado" na aba Previsões ML (estado honesto sem
   modelo aprovado; heurísticas antigas rotuladas "legado").

### Resultado científico do primeiro treino (registrado como está)

Universo 126/138 (12 tickers indisponíveis na XP, reportados por ticker);
1.248 barras D1/ticker (2021→2026); 15.084 amostras walk-forward 2024–2026;
47 min de treino (TimesFM ~25k previsões). Acurácia direcional:
**híbrido 47,5% | fundamentalista puro 52,3% | TimesFM 50,6% | sempre-alta
49,2% | só-preço 47,1%**. **Gate REPROVOU** (nenhum baseline batido com
IC95%) → ResearchRun `cmrr3mtah0001i1242twda715` persistido, sem
ModelVersion, UI mostra estado honesto. Confirma o experimento anterior do
Guardião: neste horizonte, o filtro fundamentalista puro segue melhor que o
híbrido aprendido. O gate fez exatamente o que existe para fazer.

### Bugs reais achados só no E2E ao vivo

- `createHttpMlApiPort` chamava `/train` sem o prefixo `/ml` (fix `3151631`
  + teste de URL capturada).
- `features_for` retornava `np.float32` (quebraria o jsonify) — cast float.
- Cache TimesFM relia o parquet inteiro a cada chamada — cache em memória.

### Operacional / limitações v1 (detalhe em docs/ML_HYBRID.md)

- 1º treino do universo excede o timeout (600s) da rota governada: rodar
  `/ml/train` direto 1x (popula `data/ml/tfm_cache/`), depois a rota reusa.
- Backtest é proxy direcional (desvio 5); sem BacktestRun governado
  (desvio 6 — o serviço Fase 5 recomputa métricas, proxy lá falsificaria
  proveniência). Desvios 1–6 no cabeçalho do plano.
- Próximos (v1.1+), em ordem: (1) **predict defasado** (Important da review
  final, hoje inalcançável): `predict` usa a última linha do dataset, que
  exclui as barras sem alvo — a "previsão do dia" fica ~10 pregões atrás;
  corrigir montando a linha de inferência sem exigir `y` ANTES de promover
  qualquer modelo; (2) backtest real com custos parametrizados +
  BacktestRun governado; (3) mais features/horizontes; (4) fine-tuning
  TimesFM sobre o mesmo harness. Backlog menor no relatório da review
  final (`.superpowers/sdd/final-review-report.md`) e no ledger.

## Sessão 2026-07-17/18 — MCP Piloto v1 (branch `feat/mcp-piloto`)

O MCP deixou de ser só-leitura: novo servidor `wr-mcp-pilot` (Streamable HTTP,
`src/mcp/pilot/`, `npm run mcp:pilot`) deixa o Hermes Agent operar a
plataforma inteira. Fluxo: brainstorm → spec
(`docs/superpowers/specs/2026-07-17-mcp-piloto-design.md`) → plano
(`docs/superpowers/plans/2026-07-17-mcp-piloto.md`) → 8 tasks por subagentes
com review por task → review final da branch (Ready to merge: YES) →
verificação E2E ao vivo pelo controller.

### Decisões do usuário (spec)

- **Acesso livre a tudo, exceto ordem**: 36 tools (32 free), só `trade.*`
  (4) tem gate humano. Admin fora do MCP por decisão explícita.
- **Aprovação via chat do Hermes** (`trade.approve` é tool MCP) com
  `confirmationCode` de 6 dígitos como controle compensatório.
- **Execução v1 só em conta DEMO** — guarda dura no bridge Python
  (`WR_TRADING_DEMO_ONLY`, fail-closed, testada sem MT5) + kill switch
  `WR_TRADING_ENABLED` continua mestre.
- Abordagem C: piloto é proxy das APIs existentes (Next :3001 com
  `WR_SERVICE_TOKEN` Bearer só para `/api/*`; Flask spread/vol; bridge WS
  com ws-token) — Next/Flask/bridge continuam loopback-only; só o piloto
  expõe porta ao WSL (`WR_MCP_HTTP_HOST` explícito + `WR_MCP_HTTP_TOKEN`).

### Entregas técnicas (13+ commits na branch)

1. Servidor HTTP+Bearer com gestão de sessões (uma por cliente),
   `privilege: 'free'|'gated'` obrigatório em toda tool, auditoria de
   chamadas sem valores.
2. Trilho de trade (`src/application/mcp-trade/` + modelo Prisma aditivo
   `McpTradeProposal`): propose → RiskPolicy determinístico → code sha256 →
   approve com transição CAS atômica (anti duplo-send comprovado) →
   OrderIntent (idempotente) → `Mt5DemoBroker` via bridge. Rate limit 10/h
   (requestedBy fixo server-side `mcp:hermes`), expiração 30min, 3 tentativas.
3. Bridge Python: handlers ADITIVOS `GET_ACCOUNT_INFO` +
   `GET_*_SNAPSHOT` (positions/orders/history unicast — os broadcasts da UI
   ficaram intocados) + guarda DEMO fail-closed.
4. Scan de opções server-side (`POST /api/options/scan` no spread_api,
   reusando scanner_opcoes refatorado); `min_correlacao` agora honrado no
   find-best-pairs; ML (previsão/backtest) in-process com validação
   `INSUFFICIENT_DATA`.
5. Suíte nova `npm run test:mcp-pilot` (config, auth, sessões, tools por
   grupo, trilho completo com broker fake) + `python/tests/test_demo_guard.py`.
6. Docs: `docs/MCP_PILOT.md` (setup, tokens, firewall, conexão Hermes,
   catálogo, rollout) + `.env.example` com os 14 envs novos.

### E2E ao vivo (controller) — PASS total

Ambiente isolado (env temp, DB temp, MT5 demo real): 401 sem Bearer; 36
tools/4 gated; CVM 138 via service token; conta DEMO real (equity 837k,
XPMT5-DEMO); candles vivos; `trade.propose` → PENDING_HUMAN + code; code
errado → INVALID_CODE; code certo → **APPROVED + BLOCKED_KILL_SWITCH**
(etapa 1 exata); `trade.status` com ciclo completo sem expor hash.
3 bugs reais achados SÓ no E2E e corrigidos (`f6f6107`): Origin ausente no
WS do Node (bridge rejeitava), sessão única no servidor (reconexão do
Hermes quebrava), proposalId não-UUID (descasamento service×tools).

### Backlogs registrados (review final)

- Corrida mutate+restore do `min_correlacao_filtro` no calculator do
  spread_api (passar como argumento antes de uso multi-cliente concorrente).
- Escopo por rota do `WR_SERVICE_TOKEN` (hoje vale para todo /api/*).
- Reconciliação de proposta APPROVED presa (crash entre CAS e send —
  fail-closed, consultável).
- **Atenção**: a guarda DEMO agora vale também para a UI (ordem manual em
  conta real exige `WR_TRADING_DEMO_ONLY=false` consciente além do kill
  switch).

### Próximos passos

1. Merge da branch na main (decisão do usuário).
2. Conectar o Hermes real (WSL): tokens no .env, `WR_MCP_HTTP_HOST` no IP
   do vswitch, firewall (docs/MCP_PILOT.md), `hermes mcp add`.
3. Rollout etapa 2 (ligar `WR_TRADING_ENABLED` p/ DEMO) após alguns dias de
   observação do comportamento do agente na etapa 1.

## Sessão 2026-07-17 — Verificação do banco CVM pós-atualização FRE (Guardião)

Auditoria read-only do `data/cvm/cvm_fundamentos.db` após o Guardião atualizar
o banco. **Atualização de hoje OK e íntegra:** integrity_check ok, foreign_key_check
sem violações, contagens estáveis. Comparado com o backup pré-write de hoje
(`backup-20260717`, feito 5s antes), a única diferença são **4 tabelas FRE
aditivas** — nada existente foi alterado: `fre_capital_social` (505),
`fre_distribuicao_capital` (138), `fre_posicao_acionaria` (5.303),
`fre_transacao_parte_relacionada` (3.145). Total 63.296 linhas, 138 empresas.
Crescimento 9→12,9 MB foi só checkpoint do WAL mesclando o FRE no arquivo principal.

### Achado repassado ao Guardião (via log do vault)

- Buraco pré-existente em `dre_trimestral` (herdado da regeneração de DRE de
  15/07 à noite, não da atualização de hoje): faltam 3 linhas —
  **ITUB4 (019348) 2012 T2 e T3; ABEV3 (023264) 2013 T1**, ambas da carteira 12.
  É bug e não dado ausente na fonte: esses trimestres existem em
  bpa/bpp/dfc/dra/dva/indicadores, só a DRE ficou com 0. Pedido de backfill
  registrado no `log.md` do vault para o Guardião.

### Limpeza

- Removido o backup untracked `cvm_fundamentos.db.backup-20260715-1952` (+ sidecars
  -shm/-wal deixados por leituras RO). Mantido `backup-20260717` como ponto de
  rollback mais recente (untracked — é arquivo de dados, fora do Git).

## Sessão 2026-07-17 — Hardening do runtime LLM (timeout + reaper de órfãos)

Fecha os 2 achados do E2E do comitê (sessão 2026-07-15). TDD (RED→GREEN) sobre
`test:agent-run`, que ganhou 3 blocos novos.

### O que foi entregue

1. **Timeout real nas chamadas LLM** (`llm-providers.ts`): todo `fetch` dos
   provedores (OpenAI-compatible e Ollama, incluindo o retry sem `think`) usa
   `AbortSignal.timeout` — default 120s, teto 600s, clamp server-side
   (`LLMConfig.timeoutMs`). Provedor pendurado agora falha com
   "timeout após Xms sem resposta do provedor".
2. **Orçamento propagado por chamada**: `AgentLlmOptions.timeoutMs` na porta;
   o `advance` passa o orçamento RESTANTE (`budget.timeoutMs - decorrido`) a
   cada nó AGENT/SYNTHESIS; sem orçamento, vale o default do provider.
3. **Reaper de runs órfãos**: `AgentRunService.reapStaleRuns()` marca `FAILED`
   (`ORPHANED_RUN`) todo RUNNING sem progresso há mais de 15min (processo morto
   no meio do advance). QUEUED nunca é tocado; idempotente. Porta nova
   `listRunningUpdatedBefore` (índice `[status, updatedAt]` já existia). Rota
   `POST /api/v1/agent-runs/reap` (limiar só server-side) disparada pelo
   `AgentRunsPanel` no mount, antes da listagem.
4. **Refactors de suporte**: `llm-providers.ts` com imports relativos e classes
   exportadas (testabilidade); `MarketContext` do request agora é
   `LLMMarketContext` em `types/llm.ts` (quebra o ciclo de alias `@/` que
   impedia a suíte de compilar o módulo).
5. **Verificação runtime E2E** (não só testes): `next start` isolado com
   `.env.local` temporário + banco SQLite temp + "provedor" mudo em loopback:
   `advance` retornou em **8s com `TIMEOUT_EXCEEDED`** (antes do fix: RUNNING
   eterno); reaper ceifou órfão semeado e segunda chamada retornou 0; probes
   401 (sem sessão) e 405 (GET) ok. Receita persistida em
   `.claude/skills/verify/SKILL.md`.

### Notas/pegadinhas descobertas

- O dotenv-expand do `@next/env` corrompe valores com `$` **mesmo vindos do
  process env** (não só do `.env`) — para subir o app com credenciais de teste,
  usar `.env.local` com `\$` (e removê-lo ao final).
- Prisma no Windows: `DATABASE_URL` deve ser `file:C:/...`; path estilo Git
  Bash (`file:/c/...`) cria/abre um banco em outro lugar (P2021).
- Cosmético (em aberto): quando todos os fallbacks falham, o `_llm.reason` do
  nó mostra o erro genérico do orquestrador ("No LLM provider is available")
  em vez da mensagem de timeout do provedor preferido — a mensagem real fica
  nos logs do servidor.

### Em aberto (herdado)

- Qualidade analítica fina do qwen3.5:4b (imprecisões numéricas pontuais).
- Fora da v1 do comitê: analista de preço/MT5, otimista, modo carteira
  inteira, 2ª rodada de debate.
- `data/cvm/cvm_fundamentos.db.backup-20260715-1952` untracked na raiz de
  dados (backup da sessão anterior; decidir se apaga ou ignora).

## Sessão 2026-07-15 — Comitê de Agentes v1 (branch `feat/comite-agentes`)

Entrega da v1 do comitê de investimento multiagente sobre o runtime AgentRun
(ideia registrada no vault em `comite-investimento-multiagente-b3`). Fluxo:
brainstorm → spec (`docs/superpowers/specs/2026-07-15-comite-agentes-design.md`)
→ plano (`docs/superpowers/plans/2026-07-15-comite-agentes.md`) → execução por
subagentes com review por task.

### O que foi entregue

1. **`buildRoleContext`** (`agent-data-context.ts`): fatia de dados por papel —
   fundamentalista (evolução 8 trimestres), dividendos (série DFC ~5 anos +
   payout + pertencimento à carteira 12), risco (dívida/liquidez, volatilidade
   de margens 8 tri, concentração setorial da carteira), cético (compacto do
   ticker). Papel desconhecido cai no contexto genérico da carteira.
2. **Registro de papéis** (`src/application/agent-run/committee.ts`): prompts
   versionados no git para `fundamentalista-cvm`, `dividendos`, `risco`,
   `cetico` + `buildGestorSystemPrompt` para o nó SYNTHESIS com `role: 'gestor'`.
3. **Runtime** (`service.ts`): nós AGENT com papel de comitê usam prompt +
   fatia próprios; SYNTHESIS-gestor pondera pareceres rotulados por papel;
   caminho genérico intacto (retrocompatível); contrato/schemas/rotas sem mudança.
4. **UI** (`AgentRunsPanel.tsx`): template "Simples | Comitê", ticker
   obrigatório no comitê (regex B3), budget maior (maxCost 30k tokens), e seção
   "Pareceres do Comitê" legível por papel (cético destacado; gestor = contrato final).
5. **Testes**: `test:agent-run` ganhou 4 blocos — fatias por papel, registro,
   comitê simulado (8 nós) e comitê com **stub LLM injetado** (verifica prompt
   por papel, cético lendo os 3 pareceres, gestor sintetizando, custo em tokens).
6. **E2E live validado** (relatório em `.superpowers/sdd/task-5-report.md`):
   comitê WEGE3 SUCCEEDED com Ollama (8.274 tokens) e DeepSeek (13.004);
   4 pareceres distintos, cético rebatendo nominalmente, números batendo com a
   base CVM (payout ~83%, lucro 12m R$ 6,7 bi); regressão do modo Simples OK.

### Em aberto (achados do E2E, pré-existentes — não desta branch)

- ~~`llm-providers.ts`: `fetch` sem AbortController/timeout~~ **Resolvido em
  2026-07-17** (AbortSignal.timeout + orçamento restante por chamada).
- ~~Runs órfãos RUNNING se o processo morre no meio do advance~~ **Resolvido
  em 2026-07-17** (reaper `ORPHANED_RUN` + rota `/api/v1/agent-runs/reap`).
- Qualidade analítica fina do qwen3.5:4b tem imprecisões numéricas pontuais;
  DeepSeek não exibiu o problema.
- Fora da v1 (spec): analista de preço/MT5, otimista, modo carteira inteira,
  2ª rodada de debate.

## Sessão 2026-07-14/15 — Checkpoint do dia (Claude Code direto)

Dia inteiro de evolução da plataforma trabalhando direto no Claude Code
(novo fluxo: usuário → Claude Code; Guardião_Hermes em paralelo no WSL;
coordenação pelo log do vault Obsidian `hermes-knowledge`). HEAD publicado:
`97da73d` (main sincronizada com o GitHub). Detalhes de cada entrega no
log do vault, nas entradas de 2026-07-14/15.

### Infra e segurança

1. **R-1 fechado:** projeto movido para fora do OneDrive (`C:\WR\wr_trade_pro_`);
   item "userData" descartado; revisão fable5 anotada.
2. **Vault Obsidian integrado** como segundo cérebro (instrução no CLAUDE.md).
3. **C-1/C-2 do esquema CVM:** verificados como já resolvidos na Fase 2.
4. **Segredos no banco:** modelos mortos `AIProvider`/`DataSource` removidos
   (migração `drop_plaintext_secret_models`).
5. **Regressão NEXT_PUBLIC_ revertida** (commit do Guardião 06b9918 aceitava
   chaves públicas no servidor): chaves renomeadas no .env para nomes
   server-side; bundle verificado limpo. Regra: nunca aceitar NEXT_PUBLIC_
   no servidor — renomear a env.

### Acesso e app

6. **Primeiro acesso na tela de login** (cria usuário/senha; fail-closed;
   middleware migrado para runtime nodejs). Bug real corrigido: dotenv-expand
   corrompia o hash scrypt (`\$` obrigatório — gerador e docs atualizados).
7. **Atalho da Área de Trabalho recriado** + `launch.bat` corrigido.
8. **Serviços Python sobem em modo não-empacotado** (isPortInUse pula os já
   ativos) → conexão MT5 funcionando pelo atalho. Validado pelo usuário.

### Dados CVM na UI

9. **Tab Fundamentos CVM** (138 empresas, snapshot em `data/cvm/`, proveniência
   explícita, APIs `/api/cvm/*` read-only) + **visão Dividendos & Carteira**
   (score de qualidade, carteira 12 vigente com gates Monte Carlo).
10. **1T2026 completo** após 2 rodadas de regeneração do Guardião (a cópia
    WSL→Windows dele falha silenciosamente; processo acordado: Guardião
    regenera a fonte, Claude Code copia e valida contagens).

### Agentes (o grosso do dia)

11. **Aba Agentes ligada ao runtime AgentRun v1** (visão Runs Governados:
    criar/processar/acompanhar DAG/cancelar). 2 bugs do runtime corrigidos:
    rota `/advance` inexistente (runs ficavam QUEUED) e run "venenoso"
    (output `{}` fora do contrato quebrava get/list).
12. **LLM real nos nós AGENT/SYNTHESIS** via porta injetável (`AgentLlmPort` +
    adapter do proxy server-side). LLM fornece conteúdo; runtime monta e
    sanitiza o contrato. Custo do orçamento em tokens reais. Fallback
    simulado sempre marcado.
13. **Ollama 55x mais rápido na RTX 4060:** `num_ctx=8192` (100% GPU) +
    `think:false`. Run completo: ~9min → ~10s. `OLLAMA_DEFAULT_MODEL` no .env.
14. **Seleção de provedor/modelo** nas duas telas (`GET /api/llm/providers`);
    preferência auditável no input do run. DeepSeek/OpenAI/Qwen/Groq ativos
    após renomeação das chaves.
15. **Dados reais nos prompts** (implantação do Guardião e362b1f revisada):
    3 correções — percentuais duplicados (ROE "890%"), fonte de proventos
    trocada para a série DFC validada (tabela dmpl inconsistente — Guardião
    deve revisar no pipeline), carteira dinâmica do CSV. Validado: WEGE3
    payout 83%, lucro 12m R$ 6,7 bi (plausíveis).

### Em aberto / próximos passos

- Guardião: revisar tabela `dividendos_jcp_dmpl` do pipeline; método de cópia
  WSL→Windows; `financial_health` painel 2026T1 (regra de janela?).
- Ideias na fila: papéis de comitê nos agentes (qualidade/risco/cético),
  walk-forward no backtest (inspiração Vibe-Trading), login Google (adiado),
  `asar: false` e `getPythonPath()` hardcoded (baixa prioridade).

## Sessão 2026-07-14 — Decisão R-1 resolvida + commits pendentes

### Decisão do usuário

- **R-1 resolvido pela opção (a):** o projeto foi movido para fora do OneDrive; caminho atual `C:\WR\wr_trade_pro_`. A regra do CLAUDE.md (dados locais em `data/`) permanece válida e o item 10 do dossiê (migração para `userData`) foi **descartado** — a causa raiz (sync do OneDrive sobre o SQLite) foi eliminada.
- `fable5-review-2026-07-11.md` anotado com a resolução (R-1, seção 4, seção 5 e resumo executivo).

### O que foi feito

- Commits das pendências da árvore: `96b9b04` (electron/dist recompilado do fix e812799) e `f0a7140` (handoff da sessão de 2026-07-11).
- Verificado no código que a Fase 0 da revisão está toda implementada e commitada: fail-closed no tipo de ordem, redator de segredos, binds 127.0.0.1, validação de Origin no WS, kill switch `WR_TRADING_ENABLED` + `order_check()`, `NO_DECISION`, `src/middleware.ts`, token efêmero no WS, sandbox Electron, Zod em spread-orders.

### Em aberto

1. ~~Correções obrigatórias do esquema CVM (C-1/C-2)~~ **Verificado em 2026-07-14: já implementadas na Fase 2 Item 2 (`ca213b2`)** — `CvmFact.valueRaw BigInt` + `scalePow`, `periodStart` NOT NULL com `INSTANT ⇒ periodStart === periodEnd`; `npm run test:cvm-facts` passando integralmente.
2. ~~Cifragem de segredos no banco~~ **Resolvido em 2026-07-14 por remoção:** `AIProvider`/`DataSource` eram modelos mortos (zero uso no código, tabelas vazias; chaves LLM já são env vars server-side desde a Fase 0 item 7). Removidos do schema + types espelho, migração `20260714184514_drop_plaintext_secret_models`. Validado com `tsc --noEmit`, `npm run build` e `test:cvm-facts` (cadeia de migrações íntegra em banco limpo). Obs.: o `dev.db` local estava 11 migrações atrás — todas aplicadas com `migrate deploy` (backup em `prisma/dev.db.backup-20260714`).
3. Demais riscos da seção 5 da revisão (empacotamento com `asar: false`, `getPythonPath()` hardcoded).

## Sessão 2026-07-11 — Revisão independente do dossiê de upgrade

### O que foi feito

- Revisão crítica do dossiê `docs/architecture/upgrade-dossier-2026-07-11.md` (43 achados do Guardião_Hermes), com verificação achado-a-achado contra o código real.
- Todos os 9 achados críticos confirmados no código; nenhum falso positivo.
- Documento de revisão criado: `docs/architecture/fable5-review-2026-07-11.md`.

### Arquivos alterados

- Criado: `docs/architecture/fable5-review-2026-07-11.md`
- Atualizado: este arquivo. Nenhum arquivo de código foi alterado (regra da tarefa).

### Comandos de verificação executados

- Nenhum build necessário (mudança somente em docs). Verificação foi por leitura de código: `mt5_bridge.py`, `backtesting.ts`, `agents/route.ts`, `schema.prisma`, `llmService.ts`, `mt5Service.ts`, `login/page.tsx`, `electron/main.ts`, `electron/preload.ts`, `workers.py`, `package.json`, grep de `CORS`/`0.0.0.0`/`NEXT_PUBLIC`.

### Próximos passos recomendados

1. Guardião_Hermes revisar `fable5-review-2026-07-11.md` e decidir o conflito do item 10 da Fase 0 (userData vs regra do CLAUDE.md sobre dados locais — risco real é SQLite sob OneDrive).
2. Aprovar as correções obrigatórias do esquema CVM (Decimal → BigInt + expoente; periodStart não-nulo).
3. Iniciar Fase 0 na ordem recomendada na seção 4 da revisão (começa por fail-closed no tipo de ordem, 1 linha em `mt5_bridge.py:1081`).

### git status relevante

- Branch `main` limpa antes da tarefa; após: 1 arquivo novo + este handoff modificado, sem commit (aguardando pedido do usuário).

## Pausa 2026-05-20 — retomar subida ao GitHub

### Estado ao pausar

- Projeto estruturalmente limpo para preparar GitHub.
- `ProfitDLL/` deve permanecer no projeto, por decisão do usuário, pois contém referência de uso da DLL.
- `estudo/` e `monitoramento_acoes/` foram removidos por decisão do usuário; eram exemplos/dados antigos e a funcionalidade já foi incorporada na plataforma.
- `.env` permanece local, ignorado e fora do Git.
- `.env.example` foi criado para subir ao GitHub sem credenciais reais.
- Valores reais antigos de MT5 foram removidos do conteúdo rastreado atual.
- Ainda há risco de credenciais no histórico Git local antigo; antes do primeiro push, limpar histórico se o remoto não deve receber esses commits antigos.

### O que foi feito nesta rodada

- Auditoria estrutural com `analyze-project`, `architecture` e `architect-review`.
- Uso de sub-agentes para varredura de arquivos soltos, untracked, artefatos e referências reais no código.
- Remoção de artefatos grandes e temporários:
  - `codex-electron-check/`
  - `codex-electron-check-fixed/`
  - `codex-electron-check-final/`
  - `graphify-out/`
  - `agent_workspace/`
  - caches Python
- Organização de docs e scripts exploratórios em `docs/archive/`.
- Mesclagem do histórico do banco legado de opções para o banco canônico `data/options/options_data.db`.
- Remoção do banco legado duplicado `python/options/options_data.db`.
- Sanitização de docs legadas com credenciais MT5 reais.
- Criação de `.env.example`.
- Atualização de `package.json` para incluir `agents/**/*` no pacote Electron.

### Verificações já aprovadas

- `npm run build`: aprovado.
- `npm run electron:compile`: aprovado.
- `py_compile` dos serviços Python principais: aprovado.
- Banco `data/options/options_data.db`:
  - `integrity ok`
  - `scans`: 11
  - `options`: 138
  - opções órfãs: 0

### Próxima sessão

1. Revisar `git status --short`.
2. Revisar se todos os arquivos novos/organizados devem entrar no commit.
3. Limpar histórico Git local para remover credenciais antigas antes do primeiro push.
4. Criar ou conectar repositório GitHub remoto.
5. Fazer commit final de organização/segurança.
6. Subir para GitHub.

## Retomada 2026-05-20 — seguranca de credenciais `.env`

### O que foi feito

- Verificado que `.env` existe localmente, esta ignorado por `.gitignore` e nao esta rastreado pelo Git.
- Criado `.env.example` com as mesmas chaves esperadas, mas sem senhas, tokens ou chaves reais.
- Confirmado que `.env.example` nao esta ignorado e deve ser versionado como template seguro.
- `git grep` nao encontrou mais os valores reais antigos de MT5 no conteudo rastreado atual.

### Decisao

- `.env` e `.env.local` ficam sempre locais e ignorados.
- `.env.example` e o arquivo que deve subir para o GitHub.
- Antes do primeiro push, ainda e necessario limpar o historico Git se o remoto nao deve receber credenciais antigas que ja apareceram em commits locais anteriores.

### Arquivos alterados nesta retomada

- `.env.example`
- `docs/CODEX_HANDOFF.md`

## Retomada 2026-05-20 — auditoria estrutural antes do GitHub

### O que foi feito

- Executada a sequência de skills solicitada:
  - `analyze-project`: inventário de estrutura, `git status`, arquivos untracked, artefatos, tamanhos e referências.
  - `architecture`: definição de estrutura alvo e trade-offs de versionamento/arquivamento.
  - `architect-review`: revisão de riscos antes de apagar ou mover arquivos.
- Usados sub-agentes de exploração somente leitura para:
  - classificar arquivos untracked e artefatos locais;
  - verificar referências reais no código para pastas/arquivos candidatos a limpeza.
- Criado `docs/PROJECT_CLEANUP_AUDIT.md` com classificação e plano de execução.

### Achados principais

- Encontrados três diretórios `codex-electron-check*`, cada um com cerca de 1 GB, como artefatos de validação Electron.
- Confirmado que `data/options/options_data.db` é o banco runtime canônico local e deve permanecer ignorado pelo Git.
- Confirmado que `python/options/options_data.db` é banco legado duplicado e candidato a remoção.
- Confirmado que `agents/` é usado por `/api/agents`, mas o pacote Electron atual não inclui `agents/**/*` em `package.json`.
- Confirmado que scripts exploratórios em `python/options/test_*.py` não são runtime e seriam incluídos no pacote Electron por estarem dentro de `python/**/*`.
- Detectado risco crítico antes do GitHub: docs legadas rastreadas contêm exemplos com credenciais reais de MT5. Elas precisam ser sanitizadas e, como já estão em commits locais, o histórico deve ser limpo antes do primeiro push se essas credenciais não puderem ir ao GitHub.

### Arquivos alterados nesta retomada

- `docs/PROJECT_CLEANUP_AUDIT.md`
- `docs/CODEX_HANDOFF.md`

### Verificações executadas

- `git status --short`
- `git diff --ignore-cr-at-eol --stat`
- `git ls-files`
- `git ls-files --others --exclude-standard`
- `git check-ignore -v ...`
- Varredura de tamanhos por diretório.
- Busca por referências com `rg`.
- Busca de padrões sensíveis em arquivos rastreados e não rastreados, sem expor valores de `.env`.

### Próximo passo

- Plano aprovado e executado pelo usuário.

### Limpeza executada apos aprovacao

- Sanitizadas credenciais reais de MT5 em docs legadas rastreadas:
  - `docs/legacy/CHART_DATA_ANALYSIS.md`
  - `docs/legacy/MT5_CONNECTION_DEBUG.md`
  - `docs/legacy/MT5_CONNECTION_FIX.md`
  - `docs/legacy/MT5_DEBUG_GUIDE.md`
  - `docs/legacy/MT5_INTEGRATION_GUIDE.md`
  - `docs/legacy/TROUBLESHOOTING.md`
- `git grep` nao encontrou mais os valores reais antigos de login/senha/servidor MT5 no conteudo atual.
- Movidos docs e scripts exploratorios para pastas organizadas:
  - docs LLM para `docs/archive/llm-evaluations/`
  - docs MT5 `.NOT_USED` para `docs/archive/mt5/`
  - divergencias de opcoes para `docs/archive/options/`
  - scripts exploratorios `test_mt5_*` para `docs/archive/options/manual-checks/`
  - status ProfitDLL para `docs/profitdll/`
- Removidos artefatos locais/gerados:
  - `codex-electron-check/`
  - `codex-electron-check-fixed/`
  - `codex-electron-check-final/`
  - `codex_ws_check.py`
  - `.obsidian/`
  - `2026-05-15.md`
  - `Sem título.canvas`
  - `graphify-out/`
  - `agent_workspace/`
  - `models/`
  - caches Python `__pycache__/`
- Atualizado `.gitignore`:
  - `.obsidian/`
  - `*.canvas`
  - `20??-??-??.md`
  - `/archive/` e `/scripts/` agora so ignoram pastas da raiz, permitindo `docs/archive/` versionado.
- Atualizado `package.json` para incluir `agents/**/*` no pacote Electron, pois `/api/agents` depende da pasta `agents/`.

### Validacao do banco de opcoes

- Antes de remover `python/options/options_data.db`, foi comparado com o banco canonico `data/options/options_data.db`.
- Banco legado tinha 1 scan antigo de `PETR4` com 53 opcoes.
- Esse historico foi importado para `data/options/options_data.db`.
- Depois da importacao:
  - `PRAGMA integrity_check = ok`
  - `scans`: 11
  - `options`: 138
  - opcoes orfas: 0
  - `PETR4` tem 2 scans historicos:
    - `2026-05-10T17:17:12.755313`, spot `46.01`
    - `2026-05-13T18:44:12.228Z`, spot `44.83`
- Removido o banco legado duplicado `python/options/options_data.db` depois da importacao.

### Verificacoes executadas apos limpeza

- `npm run build`: aprovado.
- `npm run electron:compile`: aprovado.
- `C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe -m py_compile python\options\scanner_opcoes.py python\spread_api.py python\mt5_bridge.py python\profitdll_bridge.py python\volatility_api.py`: aprovado.
- Caches Python recriados pelo `py_compile` foram removidos novamente.

### Pendencias antes do GitHub

- Decisao do usuario: manter `ProfitDLL/`, pois contem a referencia de como usar a DLL.
- Decisao do usuario: remover `estudo/` e `monitoramento_acoes/`, pois eram exemplos/dados antigos e a funcionalidade ja foi incorporada na plataforma.
- Removidos:
  - `estudo/`
  - `monitoramento_acoes/`
- Como credenciais reais ja existiram em commits locais, limpar o historico Git antes do primeiro push se o remoto nao deve receber esse historico antigo.

## Retomada 2026-05-20 — inspeção dos arquivos `codex-*.log`

### O que foi verificado

- Lidos `CLAUDE.md`, `BUILD_STATUS.md` e este handoff antes da tarefa, conforme `AGENTS.md`.
- Não foram encontrados arquivos chamados exatamente `codex.log`.
- Foram encontrados 36 arquivos `*codex*.log` na raiz do projeto, somando cerca de 15,9 KB.
- Os arquivos têm data de `2026-05-11` e nomes como:
  - `codex-next-stdout.log`
  - `codex-spread-stderr.log`
  - `codex-final-mt5-stderr.log`
  - `codex-final-vol-stdout.log`

### Conclusão

- Esses logs foram gerados durante validações anteriores do pacote Electron/Next/Python, quando os serviços foram iniciados em background e suas saídas foram redirecionadas para arquivos.
- O conteúdo confirma que eles registram stdout/stderr de:
  - Next.js em `localhost:3001`;
  - `mt5_bridge.py` em `8766`;
  - `spread_api.py` em `5000`;
  - `volatility_api.py` em `5555`.
- Eles são artefatos temporários de verificação, não fazem parte do código-fonte nem da configuração funcional do app.

### Arquivos alterados nesta retomada

- `docs/CODEX_HANDOFF.md`

### Próximos passos recomendados

1. Remover os `codex-*.log` da raiz se o usuário autorizar.
2. Manter `*.log` no `.gitignore` para evitar que esse tipo de artefato entre no Git.

### Limpeza executada após autorização

- O usuário autorizou excluir os logs temporários do Codex.
- Removidos 36 arquivos `*codex*.log` da raiz do projeto.
- Total removido: 15.899 bytes.
- Verificação após remoção: `Get-ChildItem -Force -File -Filter *codex*.log` não retornou arquivos.
- `.gitignore` já continha `*.log`, então nenhuma nova regra foi necessária para logs.

## Retomada 2026-05-20 — atualização global do Codex CLI

### O que foi feito

- Lidos `CLAUDE.md`, `BUILD_STATUS.md` e este handoff antes da tarefa, conforme `AGENTS.md`.
- Executado `npm install -g @openai/codex` para atualizar o Codex CLI global.
- Versão global anterior identificada:
  - `@openai/codex@0.130.0`
- Versão global após atualização:
  - `@openai/codex@0.132.0`
  - `codex-cli 0.132.0`

### Arquivos alterados nesta retomada

- `docs/CODEX_HANDOFF.md`

### Verificações executadas

- `git status --short`: worktree já tinha várias mudanças pendentes antes desta tarefa.
- `npm list -g @openai/codex --depth=0`: antes `0.130.0`, depois `0.132.0`.
- `npm install -g @openai/codex`: concluído, `changed 2 packages in 10s`.
- `codex --version`: retornou `codex-cli 0.132.0`.

### Observações

- O npm emitiu aviso de cleanup `EPERM` ao tentar remover uma pasta temporária antiga em `C:\Users\rwres\AppData\Roaming\npm\node_modules\@openai\.codex-rLvboW6U`, envolvendo `codex.exe`.
- A atualização principal foi aplicada e a versão ativa do CLI foi confirmada como `0.132.0`.
- O npm também avisou que há versão mais nova do próprio npm: `11.10.0 -> 11.15.0`; isso não foi atualizado porque a tarefa solicitada era apenas `@openai/codex`.

### Próximos passos recomendados

1. Se quiser limpar a pasta temporária `.codex-rLvboW6U`, feche processos `codex.exe` ativos e remova manualmente depois.
2. Atualizar o npm global separadamente somente se isso for desejado.

### Git status relevante

- Antes da tarefa, o worktree já estava sujo com várias alterações rastreadas e arquivos untracked.
- Esta retomada alterou apenas `docs/CODEX_HANDOFF.md`.

## Retomada 2026-05-12 — decisão de dados dentro do repositório

### Decisão arquitetural do usuário

- O projeto WR Trading Pro tem como limite arquitetural a pasta:
  - `C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_`
- Dados locais, bancos SQLite, runtime state e persistência da plataforma não devem ser salvos em `AppData`/`Roaming`.
- O app é uma plataforma de operação B3 com: Dashboard, Ordens, Portfólio, Previsões ML, Modelos ML, Spread B3, Opções, Monitoramento, Agentes e Admin.
- O fluxo atual usa dados via MT5, mas o plano é migrar para ProfitDLL/Data Solutions quando houver assinatura/chave.

## Retomada 2026-05-12 — verificação da origem `python/options`

### O que foi verificado

- O diretório `python/options` foi a origem da funcionalidade de Opções.
- `dashboard_opcoes_(versao base apoio).py` é a referência funcional mais completa: Dash v4, SQLite, ranking por score, volatilidade, P.Exerc, filtros e capital dinâmico.
- `dashboard_opcoes.py` é uma versão Dash menor/variante de referência.
- `scanner_opcoes.py` era o scanner CLI e foi atualizado para absorver os pontos documentados em `DIVERGENCIAS_SCANNER_vs_DASHBOARD.md`.
- `src/services/optionsService.ts` é a conversão TypeScript usada pela plataforma React/Electron.

### Conclusão técnica

- A plataforma preservou a lógica essencial nascida em `python/options`:
  - letras B3 `A-H` para CALL e `J-R` para PUT;
  - `parseStrike` genérico;
  - `determineType` genérico;
  - anualização em base 365;
  - volatilidade D1;
  - probabilidade simplificada de exercício;
  - ranking por anualizado/segurança/spread;
  - persistência SQLite.
- A plataforma melhorou a integração:
  - UI nativa em Next/React em vez de Dash separado;
  - persistência via Electron no banco oficial `data/options/options_data.db`;
  - scanner Python e UI agora apontam para o mesmo banco interno do projeto.

### Correção feita nesta verificação

- Encontrada divergência na plataforma TypeScript:
  - `getOptionSymbols()` filtrava sufixos por `F`, `FUT`, `FI`, `WDO`, `DOL`.
  - Isso podia excluir opções válidas com letra de mês `F`, `M` ou `W`.
- Corrigido `src/services/optionsService.ts` para validar símbolos usando `determineType(s) !== 'UNKNOWN' && parseStrike(s) > 0`, alinhando melhor com o módulo Python.

### Verificações executadas

- Inventário de `python/options`.
- Leitura de `README.md`, `DIVERGENCIAS_SCANNER_vs_DASHBOARD.md`, `dashboard_opcoes_(versao base apoio).py`, `scanner_opcoes.py` e `src/services/optionsService.ts`.
- `npm run build`: aprovado.
- `python -m py_compile python/options/scanner_opcoes.py`: aprovado.

## Retomada 2026-05-12 — atualização do executável `release/win-unpacked`

### O que foi feito

- Confirmado que o executável antigo em `release/win-unpacked/WR Trade Pro.exe` ainda era de `2026-05-04` e usava código antigo.
- Confirmado que `release/win-unpacked/resources/app/electron/dist/main.js` antigo ainda apontava o banco de opções para `app.getPath('userData')`.
- Executados:
  - `npm run build`: aprovado.
  - `npm run electron:compile`: aprovado.
  - `npx electron-builder --win --dir`: primeira tentativa falhou por lock temporário em `release/win-unpacked/resources/app/python`.
  - Listagem de processos não encontrou plataforma/serviços antigos segurando a pasta.
  - Segunda tentativa de `npx electron-builder --win --dir`: aprovada.
- Após validação, percebido que app empacotado poderia resolver a raiz como `release/win-unpacked/resources/app`, o que salvaria em uma cópia dentro do pacote.
- Corrigido `electron/main.ts`: quando `app.isPackaged`, a raiz do projeto é descoberta primeiro a partir da pasta do executável (`process.execPath`), fazendo o `.exe` em `release/win-unpacked` subir até `wr_trade_pro_`.
- Reexecutados:
  - `npm run electron:compile`: aprovado.
  - `npm run build`: aprovado.
  - `npx electron-builder --win --dir`: aprovado.

### Resultado

- Novo executável atualizado:
  - `release/win-unpacked/WR Trade Pro.exe`
  - timestamp validado: `2026-05-12 17:57:04`
- Código empacotado atualizado:
  - `release/win-unpacked/resources/app/electron/dist/main.js`
  - timestamp validado: `2026-05-12 17:56:18`
- `main.js` empacotado contém:
  - `findNearestProjectRoot(path.dirname(process.execPath))`
  - `APP_DATA_DIR = path.join(PROJECT_ROOT, 'data')`
  - `OPTIONS_DATA_DIR = path.join(APP_DATA_DIR, 'options')`
  - `DB_PATH = path.join(OPTIONS_DATA_DIR, 'options_data.db')`
- Simulação da descoberta de raiz a partir de `release/win-unpacked` confirmou:
  - `PROJECT_ROOT=C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_`
  - `DB=C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_\data\options\options_data.db`

### Próximos passos recomendados

1. Abrir `release/win-unpacked/WR Trade Pro.exe`.
2. Fazer um scan na aba Opções.
3. Confirmar que `data/options/options_data.db` teve `LastWriteTime` atualizado e recebeu o novo scan.

## Retomada 2026-05-12 — regra OTM para Opções

### O que foi verificado

- Usuário fez um scan novo pela aba Opções.
- Banco oficial `data/options/options_data.db` foi atualizado em `2026-05-12 18:00:20`.
- Último scan salvo:
  - `scan_id`: 32
  - ativo: `BBAS3`
  - `scanned_at`: `2026-05-12T21:00:20.231Z`
  - spot: `21.36`
  - opções salvas: 20
  - CALL: 10
  - PUT: 10
- Foi detectado que esse scan ainda continha:
  - 2 CALLs com strike menor/igual ao spot.
  - 3 PUTs com strike maior/igual ao spot.

### Correção aplicada

- Ajustado `src/services/optionsService.ts` para descartar opções não OTM antes de ranquear/salvar:
  - CALL só entra se `strike > spot`.
  - PUT só entra se `strike < spot`.
- Ajustado `python/options/scanner_opcoes.py` com a mesma regra:
  - descarta CALL com `strike <= spot`.
  - descarta PUT com `strike >= spot`.
- Registros antigos no banco permanecem como histórico; próximos scans devem seguir a regra nova.

### Verificações executadas

- `npm run build`: aprovado.
- `npm run electron:compile`: aprovado.
- `python -m py_compile python/options/scanner_opcoes.py`: aprovado.
- `npx electron-builder --win --dir`: primeira tentativa falhou porque o `WR Trade Pro.exe` estava aberto e bloqueou `d3dcompiler_47.dll`; depois dos processos fecharem, a segunda tentativa foi aprovada.
- Novo executável:
  - `release/win-unpacked/WR Trade Pro.exe`
  - timestamp validado: `2026-05-12 18:05:39`

### Próximo teste recomendado

1. Abrir novamente `release/win-unpacked/WR Trade Pro.exe`.
2. Fazer novo scan em Opções.
3. Conferir no banco se o novo `scan_id` tem:
   - `CALL` sempre com `strike > spot`.
   - `PUT` sempre com `strike < spot`.

## Retomada 2026-05-12 — alinhamento inicial do módulo de opções

### O que foi feito

- Alterado `electron/main.ts` para descobrir a raiz do projeto `wr_trade_pro_` e usar `data/` como pasta de dados local.
- O banco oficial de opções do app passou a ser:
  - `data/options/options_data.db`
- O handler `get-user-data-path` agora retorna a pasta interna `data/`, não `app.getPath('userData')`.
- `ensureOptionsDB()` cria `data/options/` automaticamente.
- Alterado `python/options/scanner_opcoes.py` para usar o mesmo banco:
  - `PROJECT_ROOT / data / options / options_data.db`
- Criado `data/README.md` documentando a regra: sem `AppData` como fonte de verdade.
- Atualizados `.gitignore`, `CLAUDE.md`, `BUILD_STATUS.md`, `python/options/README.md` e este handoff.
- Copiado o banco antigo de `C:\Users\rwres\AppData\Roaming\wr-trade-pro\options_data.db` para `data/options/options_data.db`, sem apagar o original.
- Banco copiado validado:
  - `PRAGMA integrity_check = ok`
  - `scans`: 8
  - `options`: 62
  - schema migrado para conter `cabe_capital` e `cabe_10k`

### Arquivos alterados nesta retomada

- `.gitignore`
- `CLAUDE.md`
- `BUILD_STATUS.md`
- `data/README.md`
- `docs/CODEX_HANDOFF.md`
- `electron/main.ts`
- `electron/dist/main.js`
- `electron/dist/main.js.map`
- `python/options/README.md`
- `python/options/scanner_opcoes.py`

### Verificações executadas

- `npm run electron:compile`: aprovado.
- `python -m py_compile python/options/scanner_opcoes.py`: aprovado.
- `npm run build`: aprovado.
- Validação SQLite em `data/options/options_data.db`: `integrity ok`, 8 scans, 62 opções.

### Próximos passos recomendados

1. Testar manualmente a aba Opções no Electron e confirmar que novos scans aparecem em `data/options/options_data.db`.
2. Quando o usuário autorizar, remover manualmente o banco antigo de `AppData` para eliminar vestígio fora do repositório.
3. Padronizar outros bancos/arquivos runtime do projeto sob `data/` se forem encontrados.
4. Antes da migração ProfitDLL/Data Solutions, definir subpastas claras em `data/market/`, `data/options/`, `data/logs/` ou equivalente.

### O que foi feito

- Lidos `CLAUDE.md`, `BUILD_STATUS.md` e este handoff antes das alterações, conforme `AGENTS.md`.
- Aplicada a sequência registrada para a bagunça de opções:
  - `analyze-project`: inventário do fluxo real de opções e pontos de persistência.
  - `architecture`: avaliação da decisão de dados locais e trade-offs.
  - `architect-review`: revisão de risco antes de mexer em schema/persistência.
- Confirmada a divergência principal:
  - Electron/UI usa `app.getPath('userData')/options_data.db` com coluna `cabe_capital`.
  - Scanner CLI usa `python/options/options_data.db` com coluna `cabe_10k`.
- Corrigido alinhamento de cálculo na UI:
  - `anualizar()` em `src/services/optionsService.ts` agora usa base 365, alinhada ao scanner Python.
  - `calcExerciseProb()` para PUT agora usa `Phi(d)`, alinhado ao scanner Python.
  - `selectedSymbols` agora é preenchido para permitir `UNSELECT_SYMBOL` após o scan.
- Aplicada migração compatível de schema:
  - `electron/main.ts` cria/migra `cabe_10k` e `cabe_capital`.
  - `python/options/scanner_opcoes.py` cria/migra `cabe_10k` e `cabe_capital`.
  - Inserts passam a gravar as duas colunas, sem apagar histórico nem mover bancos.

### Arquivos alterados nesta retomada

- `src/services/optionsService.ts`
- `electron/main.ts`
- `electron/dist/main.js`
- `electron/dist/main.js.map`
- `python/options/scanner_opcoes.py`
- `docs/CODEX_HANDOFF.md`

### Verificações executadas

- `npm run build`: aprovado.
- `npm run electron:compile`: aprovado.
- `python -m py_compile python/options/scanner_opcoes.py`: aprovado.
- `git diff --ignore-cr-at-eol --stat`: revisado; ainda há ruído/pendências anteriores no worktree.

### Próximos passos recomendados

1. Decidir explicitamente a arquitetura do banco de opções:
   - manter `userData` como local oficial do app desktop; ou
   - usar um caminho configurável/visível no projeto para ambiente local; ou
   - criar `WR_OPTIONS_DB_PATH`/config e documentar o fluxo.
2. Migrar/conciliar dados existentes entre `C:\Users\rwres\AppData\Roaming\wr-trade-pro\options_data.db` e `python/options/options_data.db` somente após essa decisão.
3. Revisar o campo `cabe_capital`/`cabe_10k`: hoje Electron grava `1` para as opções salvas; o próximo ajuste ideal é enviar o capital usado no scan e calcular a coluna com base nele.
4. Rodar teste manual da aba Opções com MT5 conectado para comparar PETR4/RENT3 entre UI e scanner.

### Git status relevante

- Worktree já estava sujo antes desta retomada.
- Novas alterações funcionais desta retomada: `src/services/optionsService.ts`, `electron/main.ts`, `electron/dist/main.js`, `electron/dist/main.js.map`, `python/options/scanner_opcoes.py`.
- `docs/CODEX_HANDOFF.md` permanece untracked e foi atualizado.

## Retomada 2026-05-11 — rodada técnica Electron/Python

### O que foi feito

- Validado o fluxo desktop empacotado sem abrir janela GUI: Next.js production server + serviços Python iniciados a partir da pasta empacotada.
- Identificado e corrigido bug crítico no `mt5_bridge.py`: `websockets 9.1` quebrava no Python 3.13 quando um cliente conectava (`Lock.__init__() got an unexpected keyword argument 'loop'`).
- Ambiente Conda `IA_Day_Trading` atualizado para `websockets 15.0.1`.
- `mt5_bridge.py` e `profitdll_bridge.py` alterados para usar `websockets.legacy.server.serve`, preservando o handler atual.
- `spread_api.py` e `volatility_api.py` passaram a usar `debug=False` e `use_reloader=False` para evitar processos filhos Flask soltos quando usados pelo Electron.
- Criado pacote de validação em `codex-electron-check-final/win-unpacked/WR Trade Pro.exe`.
- `.gitignore` atualizado para ignorar artefatos locais `codex-electron-check*/` e `codex_ws_check.py`.

### Arquivos alterados nesta rodada

- `.gitignore`
- `BUILD_STATUS.md`
- `docs/CODEX_HANDOFF.md`
- `python/mt5_bridge.py`
- `python/profitdll_bridge.py`
- `python/requirements.txt`
- `python/spread_api.py`
- `python/volatility_api.py`

### Verificações executadas

- `npm run build`: aprovado.
- `npm run electron:compile`: aprovado.
- `npx electron-builder --win --dir --config.directories.output=codex-electron-check-final`: aprovado, gerou `win-unpacked`.
- `python -m py_compile python/mt5_bridge.py python/profitdll_bridge.py python/spread_api.py python/volatility_api.py`: aprovado.
- Validação do pacote final:
  - `http://127.0.0.1:3001` retornou `200`.
  - `http://127.0.0.1:5000` retornou `404` na raiz, esperado para Flask sem rota `/`.
  - `http://127.0.0.1:5555` retornou `404` na raiz, esperado para Flask sem rota `/`.
  - `ws://127.0.0.1:8766` conectou com sucesso.
  - Após encerrar processos de teste, restaram apenas conexões `TIME_WAIT`, sem listeners ativos em `3001`, `8766`, `5000` ou `5555`.

### Observações

- O teste de abrir a janela real do `.exe` foi recusado pelo usuário/sandbox, então a validação foi feita pelos processos equivalentes iniciados a partir da pasta empacotada.
- `web3 5.31.4` ainda declara dependência antiga `websockets<10`; `openbb-core` e `yfinance` exigem versões novas. Para este app, `websockets 15.0.1` é a escolha correta por compatibilidade com Python 3.13 e com a ponte MT5 após ajuste para `legacy.server`.
- O pacote final de teste está em `codex-electron-check-final/`; é artefato local ignorado pelo Git.

### Próximos passos recomendados

1. Testar manualmente abrindo `codex-electron-check-final/win-unpacked/WR Trade Pro.exe`.
2. Se a janela abrir bem, gerar o pacote oficial em `release/` ou ajustar o instalador NSIS.
3. Considerar mover o caminho Python hardcoded do Electron para configuração/env, antes de distribuir para outra máquina.
4. Commitar as correções do desktop/Python separadamente das mudanças pendentes de `python/options/`.

## Estado atual confirmado

## Retomada 2026-05-12 — filtro de pares ideais no Spread B3

### O que foi feito

- Mantida a lista principal de pares em `python/Projeto_spread/pares_acoes.py` sem alterações.
- Ajustado após validação do usuário: o campo `Ganho Mínimo Personalizado` agora participa do status `Ideal`; se não houver oportunidade histórica atingindo o ganho mínimo escolhido, o par não é marcado como ideal.
- Implementado em `python/spread_api.py` um filtro estatístico para classificar pares da estratégia de Spread B3:
  - histórico alinhado por datas comuns entre os dois ativos;
  - correlação de retornos/preços;
  - z-score do spread assinado contra a média histórica;
  - meia-vida estimada de reversão à média;
  - cruzamentos da média no período;
  - score de 0 a 100;
  - sinal/direção de entrada (`Vender A e comprar B` ou `Comprar A e vender B`).
- Ajustada a lógica de oportunidades históricas para considerar a direção do spread no dia de entrada, e não apenas vender sempre o primeiro ativo.
- Atualizado o frontend da busca de pares para mostrar:
  - ranking `Top 5 - Pares Ideais`;
  - score;
  - z-score/correlação;
  - spread atual/medio e spread atual assinado;
  - meia-vida de reversão;
  - maior ganho histórico;
  - direção sugerida;
  - status operacional `Ideal Forte`, `Ideal Limite`, `Acompanhar` ou `Fraco`.
- Classificação operacional implementada:
  - `Ideal Forte`: par ideal com score >= 75, correlação >= 0.65 e meia-vida <= 25 pregões;
  - `Ideal Limite`: passou nos filtros mínimos, mas não nos critérios fortes;
  - `Acompanhar`: tem oportunidade/sinal, mas falhou algum filtro estatístico;
  - `Fraco`: sem sinal operacional suficiente.
- Evitada a análise duplicada: a tela agora chama a API uma vez e cria o ranking localmente a partir do mesmo resultado.
- Regerado o executável oficial em `release/win-unpacked/WR Trade Pro.exe`.

### Arquivos alterados nesta rodada

- `python/spread_api.py`
- `src/types/spread.ts`
- `src/services/spreadService.ts`
- `src/components/SpreadPairsFinder.tsx`
- `BUILD_STATUS.md`
- `docs/CODEX_HANDOFF.md`

### Verificações executadas

- `C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe -m py_compile python\spread_api.py`: aprovado.
- `npm run build`: aprovado.
- Teste sintético de `SpreadCalculator.calcular_qualidade_par(...)`: retornou score, sinal e direção de entrada sem erro.
- `npx electron-builder --win --dir`: aprovado, atualizou `release/win-unpacked`.
- Verificado que `release/win-unpacked/resources/app/python/spread_api.py` contém `calcular_qualidade_par`, `direcao_entrada` e `min_correlacao_filtro`.
- `release/win-unpacked/WR Trade Pro.exe` atualizado em `2026-05-12 19:37:51`.

### Próximos passos recomendados

1. Abrir `release/win-unpacked/WR Trade Pro.exe`, ir em Spread B3 e rodar `Encontrar Melhores Pares` com MT5 conectado.
2. Ajustar os limites do filtro após observar resultados reais:
   - correlação mínima atual: `0.55`;
   - z-score mínimo atual: `1.00`;
   - meia-vida máxima atual: `45` pregões;
   - histórico mínimo atual: `60` pregões.
3. Em uma próxima melhoria, adicionar controles na tela para o usuário calibrar esses filtros sem alterar código.

### Git status relevante

- A retomada mexeu nos arquivos listados acima.
- Já havia várias mudanças pendentes anteriores no projeto; nada foi apagado e nenhum commit foi criado.

## Retomada 2026-05-12 — verificação do banco de opções

### O que foi feito

- Inspecionado em modo somente leitura o banco `python/options/options_data.db`.
- Confirmado `PRAGMA integrity_check = ok`.
- Confirmadas tabelas:
  - `scans`
  - `options`
  - `sqlite_sequence`
- Contagens:
  - `scans`: 1
  - `options`: 53
- Scan único encontrado:
  - ativo `PETR4`
  - `scanned_at`: `2026-05-10T17:17:12.755313`
  - spot `46.01`
- Qualidade básica:
  - sem órfãos entre `options.scan_id` e `scans.id`
  - sem símbolos nulos/vazios
  - sem `bid`, `ask` ou `dte` negativos
  - sem `ask < bid`
  - sem `opt_type` vazio
- Distribuição:
  - `CALL`: 23 opções
  - `PUT`: 30 opções

### Divergência identificada

- O banco em `python/options/options_data.db` tem a coluna `options.cabe_10k`.
- O schema embutido no Electron em `electron/main.ts` usa `options.cabe_capital`.
- Isso indica que existem dois formatos próximos, mas não idênticos:
  - scanner CLI em `python/options/scanner_opcoes.py`: `cabe_10k`
  - banco do app Electron em `app.getPath('userData')/options_data.db`: `cabe_capital`
- Em 2026-05-12, com a plataforma WR Trade Pro aberta a partir de `release/win-unpacked/WR Trade Pro.exe`, o banco real de buscas da UI foi localizado em:
  - `C:\Users\rwres\AppData\Roaming\wr-trade-pro\options_data.db`
- Esse banco real do Electron tinha:
  - `scans`: 8
  - `options`: 62
  - buscas recentes: `RENT3` em `2026-05-12T15:32:11.626Z` e `PETR4` em `2026-05-12T15:31:15.068Z`
  - coluna `cabe_capital`, conforme `electron/main.ts`

### Verificações executadas

- Listagem de `python/options`.
- Localização de bancos `.db`.
- Inspeção SQLite via Python `sqlite3` em `mode=ro`.
- `PRAGMA table_info`, `sqlite_master`, contagens, amostras e `PRAGMA integrity_check`.
- Busca por referências a `cabe_10k`, `cabe_capital` e `options_data`.

### Próximos passos recomendados

1. Decidir se o banco CLI e o banco Electron devem compartilhar exatamente o mesmo schema.
2. Se sim, padronizar `cabe_10k` versus `cabe_capital` com uma migração compatível.
3. Usar `C:\Users\rwres\AppData\Roaming\wr-trade-pro\options_data.db` quando a dúvida for sobre buscas feitas pela plataforma desktop.

### Intenção do usuário para próxima etapa

O usuário considera incorreto o app gravar dados em `C:\Users\rwres\AppData\Roaming\wr-trade-pro` sem uma decisão arquitetural clara, porque o projeto principal está em `C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_`.

Também há preocupação explícita com bagunça estrutural:

- bancos de opções em locais diferentes;
- schema divergente entre scanner Python e Electron (`cabe_10k` vs `cabe_capital`);
- arquivos soltos em `python/options`;
- artefatos temporários;
- diferença entre scanner Python, UI Electron e persistência real;
- nome interno `wr-trade-pro` criando diretório separado no AppData.

Quando o usuário pedir para “arrumar a bagunça”, “organizar a arquitetura” ou semelhante, usar esta sequência de skills:

1. `analyze-project` — inventário real do repositório, arquivos, bancos, artefatos e fluxos.
2. `architecture` — definir arquitetura-alvo e limites claros entre app, serviços Python, dados locais, build e artefatos.
3. `architect-review` — revisão crítica antes de modificar arquivos, apontando riscos e plano de migração.

Não começar apagando/movendo arquivos. Primeiro mapear, propor plano e só executar após confirmação do usuário.

### Git status relevante

- Esta retomada alterou apenas `docs/CODEX_HANDOFF.md`.
- O banco `python/options/options_data.db` foi apenas lido, não modificado.

- Projeto: WR Trading Pro / WR Trade Pro.
- Stack: Next.js 15 + React 19 + TypeScript + Prisma/SQLite + Electron + Python MT5 bridge.
- `npm run build` passou na análise Codex em 2026-05-10.
- `npm run electron:compile` passou na análise Codex em 2026-05-10.
- O projeto NÃO usa mais `output: 'export'`; API routes dinâmicas são parte esperada da arquitetura.
- `BUILD_STATUS.md` foi atualizado para refletir o estado real.
- `AGENTS.md` existe na raiz e define o protocolo obrigatório de retomada: ler `CLAUDE.md`, `BUILD_STATUS.md` e este handoff antes de trabalhar.
- Memória local do Codex atualizada em `C:\Users\rwres\.codex\memories\wr_trade_pro_context.md` para registrar que as skills `brainstorming` e `writing-plans` estão instaladas e ativas.

## Commit recente

- `17f7c9b docs: update build status and ignores`
- Incluiu somente:
  - `.gitignore`
  - `BUILD_STATUS.md`

## `.gitignore` recente

Foram ignorados artefatos locais/gerados:

- `release/`
- `graphify-out/`
- `agent_workspace/`
- `python/options/options_data.db`

## Atenção: Git status no WSL

O WSL pode mostrar muitos arquivos como `M` por ruído de line ending CRLF/LF.
Antes de concluir que houve mudança real, use:

```bash
git diff --ignore-cr-at-eol --stat
```

Em 2026-05-10, após o commit `17f7c9b`, o ruído CRLF/LF ainda aparecia em `git status`, mas o diff funcional relevante estava limpo fora dos arquivos intencionais.

## Untracked deixados propositalmente fora do commit

Avaliar antes de commitar:

- `AGENTS.md`
- `docs/CODEX_HANDOFF.md`
- `electron/better-sqlite3.d.ts`
- `python/options/DIVERGENCIAS_SCANNER_vs_DASHBOARD.md`
- `python/options/dashboard_opcoes_(versao base apoio).py`
- `python/options/test_mt5_options.py`
- `python/options/test_mt5_options2.py`
- `python/options/test_mt5_vale.py`

Motivo: parecem candidatos a código/documentação úteis, não artefatos óbvios. `AGENTS.md` e este handoff são documentação operacional e provavelmente devem entrar no repositório quando o usuário pedir um commit.

## Mudanças pendentes observadas na retomada atual

`git status --short` em 2026-05-10:

```text
 M python/options/README.md
 M python/options/scanner_opcoes.py
?? AGENTS.md
?? docs/CODEX_HANDOFF.md
?? electron/better-sqlite3.d.ts
?? python/options/DIVERGENCIAS_SCANNER_vs_DASHBOARD.md
?? "python/options/dashboard_opcoes_(versao base apoio).py"
?? python/options/test_mt5_options.py
?? python/options/test_mt5_options2.py
?? python/options/test_mt5_vale.py
```

Nesta retomada não houve alteração de código do app. Foram apenas lidos os arquivos de handoff/protocolo e atualizadas memórias/documentação operacional.

## Verificações executadas nesta retomada

- `Get-ChildItem -Recurse -Filter AGENTS.md`: confirmou `AGENTS.md` na raiz.
- Leitura de `AGENTS.md`, `CLAUDE.md`, `BUILD_STATUS.md` e `docs/CODEX_HANDOFF.md`.
- `git status --short`: status listado acima.
- Não foram rodados `npm run build` nem `npm run electron:compile`, porque não houve mudança em TypeScript/Next/Electron nesta etapa.

## Pontos técnicos identificados pelo Codex

- Alguns serviços criam `new PrismaClient()` diretamente em vez de reutilizar `src/lib/prisma.ts`.
- `mt5Service` ainda tem logs excessivos no browser/build.
- Electron possui caminho hardcoded para `C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe`.
- ProfitDLL está preparado como types/stub/bridge parcial, aguardando ativação/chave Nelogica.
- Não há suíte de testes automatizada clara; build passa, mas comportamento não está coberto por testes.

## Próximos passos recomendados

1. Criar `.gitattributes` para estabilizar line endings Windows/WSL.
2. Classificar os untracked de `python/options/` e decidir o que entra no repositório.
3. Revisar `PrismaClient` duplicado e centralizar no singleton `src/lib/prisma.ts` se seguro.
4. Reduzir logs ruidosos em `src/services/mt5Service.ts`.
5. Parametrizar caminho Python no Electron via env/config em vez de hardcoded.
6. Integrar ProfitDLL quando a chave Nelogica estiver disponível.

## Regra de handoff

Ao terminar qualquer sessão ou tarefa, atualize este arquivo com o novo estado. Ele é a memória operacional que o Codex deve ler no início de cada nova sessão.
