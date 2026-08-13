# WR Trade Pro — CLAUDE.md

## Segundo cérebro (vault Obsidian)

O conhecimento do projeto vive no vault Obsidian `C:\Users\rwres\hermes-knowledge` (mantido pelo Guardião_Hermes e pelo usuário):

- **No início de cada sessão de trabalho neste projeto**, ler `index.md` e `concepts/wr-trading-pro-professional-upgrade.md` do vault para contexto de estado/decisões — junto com `docs/CODEX_HANDOFF.md` deste repo.
- **Ao tomar/registrar decisões relevantes** (arquitetura, segurança, roadmap), atualizar a página correspondente do vault e adicionar entrada no `log.md`, seguindo as convenções de `SCHEMA.md` (frontmatter, `updated`, wikilinks, index).
- Divisão de papéis: o vault é a fonte de verdade de decisões e conhecimento; `docs/CODEX_HANDOFF.md` é o handoff operacional entre sessões; o histórico técnico fica no git.
- Em conflito entre vault e código/git, o git vence para fatos técnicos — anotar a divergência no vault com data (política de update do `SCHEMA.md`).

## Arquitetura

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

- **Múltiplas contas/corretoras (2026-08-02):** o endpoint/API key não são mais só do `.env` — o usuário
  cadastra "perfis de conexão" (nome, endpoint, API key) em **Configurações > Contas MT5** e ativa qual
  quiser (ex.: "B3 - XP Demo", "Forex - Corretora X"). Precedência em `getMt5McpConfig()`
  (`src/lib/server/mt5-mcp-config.ts`): **perfil ativo persistido > `.env`** (fallback/bootstrap).
  - `src/lib/server/mt5-connection-store.ts`: CRUD + ativação, API key cifrada em repouso (AES-256-GCM,
    reaproveita `WR_LLM_CONFIG_ENCRYPTION_KEY` já usada pelos providers de LLM — não exige outra chave).
  - Rotas: `GET/POST /api/mt5/connections`, `PATCH/DELETE /api/mt5/connections/[id]`,
    `POST /api/mt5/connections/[id]/activate`, `POST /api/mt5/connections/deactivate`.
  - Trocar de perfil invalida o client MCP e o cache de nomes de tool descobertos
    (`__resetMt5McpClientForTests`/`__resetMt5McpToolCacheForTests` — nomes de teste, mas chamados também
    em produção pelas rotas de ativação/edição/remoção).
  - `getMt5McpConfig()` **passou a ser assíncrona** (lê o DB) — todo chamador precisa `await`.
- Config sem perfil ativo (fallback): `MT5_MCP_ENDPOINT` (default `http://127.0.0.1:22346/mcp`) +
  `MT5_MCP_API_KEY` no `.env`.
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
  - **Trilho `trade.*` liberado para qualquer mercado do MT5 conectado, não só B3 (2026-08-02):** decisão
    explícita do usuário — a WR analisa dados de qualquer ativo que o MT5 conectado cote (forex, cripto,
    B3 etc.), e o agente não deve ficar restrito a operar só uma lista fixa quando a oportunidade real
    pode estar em outro instrumento. Duas travas B3-específicas foram removidas:
    - `src/mcp/pilot/tools/trade.ts`: regex do `symbol` em `trade.propose` generalizado de
      `^[A-Za-z]{4}\d{1,2}$` (só ticker B3, ex. PETR4) para `^[A-Za-z0-9]{3,12}$` (aceita PETR4, BTCUSD,
      EURUSD etc.), com uppercase automático.
    - `src/domain/v1/models/risk-policy/risk-policy.ts` + `src/application/mcp-trade/service.ts`:
      `instrumentAllowlist` vazia agora significa "sem restrição de instrumento" (antes tinha default
      hardcoded de 6 tickers B3 — `PETR4,VALE3,ITUB4,BBDC4,ABEV3,WEGE3`). `.env`:
      `WR_MCP_TRADE_ALLOWLIST=` (vazia). Setar essa env var de novo reativa a trava como lista explícita,
      se algum dia quiser restringir por perfil de conexão.
    - `src/adapters/prisma/risk-policy/schemas.ts`: removido `.min(1)` do array — vazio agora é estado
      válido.
    - **`market-live.ts` (scan de opções B3 via Flask) foi deixado com o padrão B3** — é uma ferramenta
      diferente (opções B3 via `spread_api`/`volatility_api`), não o trilho de trading MT5.
    - O que continua limitando o que pode ser negociado, por design (não é bug, é a governança
      funcionando): `maxNotional`, `maxPositionConcentrationPct` (20% do NAV por padrão — trava real
      contra posição desproporcional em conta pequena), `maxProposalsPerRun`, kill switch
      `WR_TRADING_ENABLED` e aprovação humana com código de 6 dígitos.
    - **Achado operacional (não é config nova, é como o app já funcionava):** o MCP Pilot roda como
      processo filho do Electron (`ELECTRON_RUN_AS_NODE`, `scripts/mcp-pilot/dist/**`) e herda
      `process.env` do processo pai. O `.env` só é lido uma vez, na subida do processo principal do
      Electron (`@next/env` `loadEnvConfig`, chamado uma vez em `electron/main.ts`/`dist/main.js`).
      **Reiniciar só o MCP Pilot pela aba Admin não relê o `.env`** — mudança de variável de ambiente
      exige fechar e reabrir o app Electron por completo.
    - **Achado operacional (lote mínimo × concentração):** em contas pequenas (ex. demo Exness com NAV
      ~R$2.000), o lote mínimo de 0.01 de um ativo caro (ex. BTCUSD) pode sozinho já estourar o teto de
      concentração de 20% — proposta rejeitada por `CONCENTRATION_EXCEEDS_MAX` antes de chegar no broker,
      comportamento esperado da trava de risco, não bug.
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

### Aba Opções — scan server-side em Python (2026-08-12)

A aba estava MORTA desde 2026-08-02: `optionsService.ts` fazia 5 chamadas ao protocolo
WebSocket da ponte removida (`GET_SYMBOLS`, `SELECT_SYMBOL`, `UNSELECT_SYMBOL`,
`SUBSCRIBE_TICKS`, `GET_SYMBOL_INFO`). Como `mt5Service.send()` virou no-op silencioso,
`getSpotPrice` esperava 15 s e devolvia `{last:0,ask:0,bid:0}` — zero virando dado.

**Não foi religada pelo MCP nativo, e isso é deliberado:** o servidor MCP do terminal **não
expõe tool de `symbol_info`** (confirmado por sonda em 2026-08-11), e sem ela não há bid, ask
nem vencimento por opção — o scan sairia sem cotação.

O scan completo **já existia e funcionava** em Python (`python/options/scanner_opcoes.py`,
exposto por `POST /api/options/scan` do `spread_api.py`), usando o pacote `MetaTrader5`, que
tem a API completa. Era o caminho que o **agente de IA já usava** pela tool
`market.scan_options` — a funcionalidade nunca morreu, só a UI perdeu acesso.

- `src/app/api/options/scan/route.ts`: proxy Next -> Flask (o `spread_api` é loopback-only, o
  navegador não o alcança). Percentuais passam como "humanos" (10 = 10%); quem converte para
  fração é o handler Flask — converter dos dois lados daria 0,1%.
- `optionsService.scanOptions` chama o proxy e mapeia o payload snake_case para
  `OptionStrike`. O `ask` não vem no payload mas é **derivável** de
  `spread_pct = (ask-bid)/ask`; nada é fabricado.
- Toda a lógica de score, top 3/top 5 e alertas da UI foi preservada.
- Helpers mortos removidos: `getOptionSymbols`, `getSpotPrice`, `getSymbolInfo`,
  `selectSymbol`, `unselectSymbol`.
- **Efeito colateral bom:** aba e agente passam a enxergar exatamente o mesmo dado. Antes
  divergiam silenciosamente.

### Guarda DEMO — APOSENTADA (2026-08-12)

`WR_TRADING_DEMO_ONLY` foi **removida** do `.env` e do `.env.example`. A guarda vivia em
`python/mt5_bridge.py`, deletado em 2026-08-02, e nunca foi reimplantada no MCP nativo —
enquanto isso a execução de ordem foi HABILITADA, então a variável declarava uma proteção
inexistente. Config que promete proteção que não existe é pior que config nenhuma.

**Nada hoje distingue conta demo de conta real.** As travas reais são: kill switch
`WR_TRADING_ENABLED`, aprovação humana com código de 6 dígitos, `maxNotional`,
`maxPositionConcentrationPct`, rate limit e `assertTradingEligible()` (AutoTrading do
terminal). Se um dia quiser a guarda de volta, `account_info` do MT5 devolve `"type":"demo"` —
o conserto é pequeno, mas é decisão de governança, não detalhe técnico.

### Saúde Financeira — ranking descritivo (2026-08-12)

Aba **Saúde Financeira**, irmã e distinta da **Ranking Fundamentalista**. A diferença é o tipo
de afirmação, não o assunto:

- **Ranking Fundamentalista** é PREDITIVO ("tende a render acima das pares no próximo
  trimestre") — por isso tem walk-forward, IC, t-stat e gate.
- **Saúde Financeira** é DESCRITIVO ("manteve as contas em ordem ao longo do tempo") — é
  contagem sobre balanço já publicado. **Não tem gate nem modelo, e não pode reprovar.**

Por isso não usa Python nem o ML Engine. Tudo em TypeScript, lendo
`data/cvm/cvm_fundamentos.db` com `node:sqlite` read-only, no padrão de `cvm-sector-ranking.ts`:

```
src/lib/server/cvm-financial-health-rules.ts   PURO: 5 pilares + agregação, zero I/O
src/lib/server/cvm-financial-health.ts         query + point-in-time + exclusões
src/app/api/cvm/financial-health/route.ts      GET (?asOf=YYYY-MM-DD opcional)
src/components/saude/**                        só a View faz fetch
```

- **Cinco pilares por trimestre**, critérios absolutos: `divida_bruta_pl` ≤ 1,
  `liquidez_corrente` ≥ 1, `icj` ≥ 2, `lucro_liquido` > 0, `fco` > 0. Escolhidos pela
  COBERTURA real, não pela elegância — por isso dívida bruta/PL (99%) e não dívida
  líquida/EBITDA (83%), e lucro/FCO da demonstração crua e não `margem_liquida` (69%).
- **Escore** = média de (pilares aprovados ÷ pilares MEDIDOS). Pilar sem dado não aprova e
  **não reprova** — fingir doença por dado ausente seria o mesmo defeito de exibir zero como
  cotação.
- **Coluna "recente" (8 trimestres) fica SEPARADA do escore histórico.** A média não sabe
  *quando* a empresa falhou; a divergência entre as duas colunas é a informação. Fundir num
  peso único a destruiria. Confirmado no dado real: DASA3, YDUQ3, HAPV3 e MRVE3 aparecem em
  declínio.
- **Universo: 117** = 138 − 18 do setor financeiro − 3 sem história (piso de 20 trimestres:
  JALL3, CAML3, SRNA3). Exclusões aparecem NA TELA com a razão, nunca por omissão.
- Financeiras usam `empresas.setor_cvm` (classificação oficial), nunca o campo `setor` de
  texto livre. Ficam fora porque num banco o passivo circulante é o depósito do cliente e
  alavancagem alta é o modelo de negócio — a régua da indústria faria ITUB4 parecer doente.
  **Bloco próprio para elas depende de coletar Basileia e inadimplência da CVM**; com só
  lucro e ROE seria fachada.
- **Sem tool MCP de propósito:** o agente já recebe o ranking de fator no trilho
  `trade.propose`; um segundo ranking convidaria as duas listas a virarem recomendação.
- Testes: `npm run test:financial-health` (limiares na fronteira, dado ausente, piso,
  desempate, janela recente + prova de fumaça sobre o banco real).
- Spec: `docs/superpowers/specs/2026-08-12-ranking-saude-financeira-design.md`

### Bloco de bancos na Saúde Financeira — dados BCB/IFData (2026-08-13)

Os 10 bancos B3 estavam fora do ranking de Saúde Financeira porque a régua da indústria
descreve doença num banco (o passivo circulante é o depósito do cliente). O CLAUDE.md
registrava que um bloco próprio "depende de coletar Basileia e inadimplência". **Esses dados
agora existem** — 27 tabelas `bcb_*` / 245.590 linhas em `data/cvm/cvm_fundamentos.db`.

```
src/lib/server/bcb-financial-health-rules.ts   PURO: 5 pilares + agregação, zero I/O
src/lib/server/bcb-financial-health.ts         query prudencial + inadimplência financeira
src/app/api/bcb/financial-health/route.ts      GET read-only, devolve os critérios junto
src/components/saude/BancosPanel.tsx           bloco na view existente
src/components/saude/bancos-types.ts           contratos da UI (nada importado do servidor)
```

- **Limiares são REGULATÓRIOS, não calibrados por distribuição** — essa é a diferença de fundo
  para a aba da indústria, onde os limiares foram escolhidos pela cobertura real do dado. Aqui:
  Basileia ≥ 10,5% (8% + conservação 2,5%), Capital Nível I ≥ 8,5% (6% + 2,5%), alavancagem ≥ 3%
  (Basileia III), imobilização ≤ 50% (limite BCB), lucro > 0. Não há limiar nosso a defender.
- **Agregação idêntica à da indústria:** aprovados ÷ MEDIDOS, piso de 20 trimestres, janela
  recente de 8 separada do escore. Pilar sem dado não aprova e **não reprova** — com alvo
  concreto aqui: a razão de alavancagem só é publicada a partir de 2017 (30 das 450 linhas
  são NULL), e tratá-la como reprovação puniria o banco pelo silêncio do regulador.
- **O escore quase não discrimina, e a tela diz isso.** Contra mínimos regulatórios, banco
  listado aprova quase sempre: 8 dos 10 ficam em 1,00 (só BMGB4 0,99 e PINE4 0,94). A saída
  NÃO foi apertar a régua até aparecer variação — isso seria inventar um critério para
  fabricar um ranking. Foi exibir os **valores atuais** ao lado (Basileia/Nível I/alavancagem/
  imobilização da última data-base), que variam de verdade: 10 valores distintos de Basileia
  contra 3 escores. O escore diz se houve descumprimento; a Basileia diz de quanto é a folga.
  Há teste travando essa razão (`basileiasDistintas > escoresDistintos`).
- **Perímetros nunca fundidos.** O escore sai INTEIRO do prudencial (1004/1009,
  `bcb_prudencial_capital` + lucro de `bcb_prudencial_resumo`). A inadimplência (níveis D–H
  sobre o total) vem do FINANCEIRO (1005), com `cod_inst` e data-base próprios — fica em coluna
  à parte, fora do escore, e o teste exige que os dois `cod_inst` sejam diferentes. As
  data-bases de fato divergem: prudencial 1T26, financeiro 4T24.
- Total ausente ou ≤ 0 na carteira classificada devolve inadimplência `null`, nunca 0% — a
  divisão por zero viraria um percentual fabricado.
- `ExclusoesPanel` agora diz que os financeiros com dado BCB **são avaliados no bloco de
  bancos**, em vez de sumirem. Os 3 sem história (JALL3, CAML3, SRNA3) continuam excluídos.
- **Sem tool MCP nova, sem ranking unificado:** um banco com Basileia alta e uma indústria com
  liquidez alta não são comparáveis; uma lista única convidaria a comparação. O agente já
  recebe contexto BCB por `agent-data-context.ts`.
- Testes: `npm run test:bcb-financial-health` (fronteira exata dos limiares, ausência não
  reprovando, piso, janela recente, perímetros distintos + prova de fumaça sobre o banco real).

### Dados locais do projeto

O banco de opções oficial é `data/options/options_data.db` (gerado em runtime; ignorado pelo Git).

Regra arquitetural: dados locais do WR Trading Pro devem ficar dentro de `wr_trade_pro_`. Não usar `AppData`/`Roaming` como fonte de verdade do app.

## Como Rodar

Ver a skill `rodar-dev` (`.claude/skills/rodar-dev/SKILL.md`).

## Como o app é aberto no dia a dia (2026-08-12)

O atalho da área de trabalho (`WR Trading Pro.lnk`) **não aponta para um executável
empacotado** — ele roda `node_modules/electron/dist/electron.exe "C:\WR\wr_trade_pro_"`,
ou seja, o Electron direto sobre a pasta do projeto. Consequências:

- O app sempre carrega o código ATUAL do repositório. Não precisa de `electron:package` para
  ver mudanças — basta `npm run build` (Next) e `npm run electron:compile` (`electron/dist/main.js`).
- **Trocar de branch troca o que o app mostra.** Se o repositório estiver noutra branch, o
  atalho abre aquela versão. Isso já causou confusão real ("abri o app e não tem atualização").
- `npm run electron:package` só é necessário para distribuir a outra máquina.

**Armadilha removida em 2026-08-12:** existia `release/build/win-unpacked/` com um executável
de **24/04**, enquanto o `electron-builder` escreve em `release/win-unpacked/`. Quem abrisse o
binário de `release/build/` nunca veria mudança nenhuma. Apagado, junto com os artefatos Linux
(`linux-unpacked`, AppImage) — 2,9 GB. Tudo regenerável e fora do Git.

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
