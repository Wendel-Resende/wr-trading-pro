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

### Ferramentas de pesquisa estatística — portadas do Jesse (2026-09-06)

Duas capacidades que o motor de backtest da WR não tinha, portadas do framework
Jesse (MIT, `jesse 3.1.1`) e adaptadas ao que o motor da WR permite afirmar:

```
src/domain/v1/models/research-rng/            PRNG semeado (xoshiro128**) — nunca Math.random
src/domain/v1/models/rule-significance/       bootstrap estacionário + p-valor, PURO
src/domain/v1/models/monte-carlo-trades/      embaralhamento de ordem de trades, PURO
src/domain/v1/models/backtest-run/metrics.ts  computeMetrics extraída para reuso
src/application/research-session/             valida config por kind, CAS no run
src/app/api/v1/research-sessions/**           rotas
src/mcp/pilot/tools/research.ts               12 tools research.* (todas 'free')
```

- **A Fase 1 do Jesse não foi portada, de propósito.** Lá o teste de significância
  roda um backtest só-de-sinal chamando `should_long()` porque o sinal só existe
  dentro do ciclo de vida da estratégia. Na WR o sinal já é dado de primeira classe
  (`Signal`, `BacktestSignalInput`), então a saída dessa fase já existe.
- **O `knowledgeTime` NÃO é herdado do motor neste caminho — é verificado aqui
  (2026-09-06).** O texto anterior desta seção dizia que o teste herdava a garantia
  point-in-time de `runDeterministicBacktest` (R-BT-7); não herdava: `bars` e
  `signals` chegam crus do `configJson` que o agente monta e nunca passam pelo motor.
  A garantia agora existe de fato, em `nextBarLogReturns`, que DESCARTA o sinal com
  `knowledgeTime > barTime` — descarte, não exceção, para ser coerente com o resto
  da função (que já descarta HOLD, barra sem sucessora e preço não positivo); o
  descartado some de `nObservations` e o piso de 30 continua valendo sobre o que
  sobrou.
- **Piso de 30 observações** (`MIN_OBSERVATIONS`, mesmo valor do Jesse): abaixo dele
  o retorno é `pValue: null` com `insufficientData: true`, nunca um p-valor sobre
  amostra pequena demais. Mesma regra do "pilar sem dado não reprova" da Saúde
  Financeira.
- **O Monte Carlo NÃO produz intervalo de confiança para retorno.** O motor da WR é
  aditivo (`netPnl` absoluto, `lotSize` fixo), então retorno total, Sharpe, win rate
  e desvio-padrão são invariantes à ordem dos trades — só `maxDrawdown` e o Calmar
  variam. O resultado separa `invariants` (valor único, com `orderInvariant: true`)
  de `pathDependent` (percentis 5/50/95 e ICs de 90%/95%). **Piso de 10 trades
  (`MIN_TRADES`):** abaixo dele as bandas de `pathDependent` vêm `null` com
  `insufficientData: true` — com 1 trade não há ordem a embaralhar e com 2 ou 3 a
  banda é degenerada mas indistinguível de uma real no JSON. Os `invariants` saem
  mesmo assim, porque são exatos com qualquer número de trades. **Calmar é
  `number | null`:** cenário SEM drawdown algum tem Calmar indefinido, não zero — os
  `null` saem dos percentis e são contados em `excludedCount`, e se todos forem
  `null` a banda inteira é `null`. Antes o melhor caso possível recebia `0` e
  ordenava junto do pior. Publicar percentis
  idênticos em três casas para o retorno pareceria informação sem ser. O Jesse varia
  o retorno porque compõe (sizing sai do saldo corrente); replicar isso exigiria
  mudar o motor para sizing proporcional — decisão de modelagem, não feita.
- **Determinismo é requisito, não conveniência:** nenhum `Math.random()` no domínio.
  Mesma seed → mesmo p-valor, sempre. Um p-valor irreprodutível não é evidência.
- **Sem UI, de propósito** — a validação estatística nasce como capacidade do agente,
  que é quem propõe trades. As 10 abas continuam sendo o critério de "terminar".
- **Teto de CUSTO na fronteira Zod (2026-09-06):** os limites por dimensão sozinhos
  permitiam ~1e9 iterações. `SignificanceConfigSchema` recusa
  `signals × nSimulations > 5e7` e `MonteCarloConfigSchema` recusa
  `trades × nScenarios > 5e6`, com a mensagem dizendo o teto e o valor recebido. O
  cálculo roda síncrono no MCP Pilot (processo filho do Electron): sem isso, uma
  config mal dimensionada do agente congelaria o app. `ResearchSessionSubmissionSchema`
  e `ResearchSessionDraftPatchSchema` agora são de fato aplicados no
  `PrismaResearchSessionRepository` (antes eram exportados e nunca chamados, então o
  teto de `configJson ≤ 2 MB` não valia em lugar nenhum).
- **O gate PASSOU a valer (2026-09-06):** `trade.propose` aceita `evidenceSessionId`
  opcional e a política de risco pura ganhou a regra de evidência, com quatro códigos
  próprios (`EVIDENCE_MISSING`, `EVIDENCE_INCONCLUSIVE`, `EVIDENCE_PVALUE_ABOVE_MAX`,
  `EVIDENCE_STALE`) — quatro e não um porque "recusado por evidência" tem quatro causas
  e juntá-las esconderia qual o agente precisa corrigir.
  - A decisão é PURA: o serviço busca a `ResearchSession` e a achata num fato
    (`RiskEvidence`); quem decide é `evaluatePolicy`, junto de notional e concentração.
    Sessão inexistente, de `kind` errado ou não concluída são tratadas como AUSENTE —
    não são medição fraca, não são medição. `resultJson` corrompido vira
    `EVIDENCE_INCONCLUSIVE`, nunca licença para operar.
  - Roda ANTES das regras de tamanho: sem evidência de poder preditivo, o tamanho da
    posição é irrelevante, e `EVIDENCE_MISSING` é a mensagem acionável.
  - `WR_MCP_TRADE_MAX_PVALUE=0.05` liga o gate; vazia = DESLIGADO, e é isso que mantém
    chamadas existentes do Hermes funcionando em quem atualizar sem configurar.
    `WR_MCP_TRADE_EVIDENCE_MAX_AGE_DAYS=30` dá validade à evidência — sem prazo, uma
    sessão de meses atrás autorizaria o trade de hoje.
  - **Achado operacional:** o `.env` do projeto CHEGA aos processos de teste (verificado).
    Por isso `buildMcpTradeService` em `scripts/mcp-pilot/mcp-pilot-test.ts` neutraliza
    as duas env vars, no mesmo padrão que `WR_TRADING_ENABLED` já usava — sem isso as
    suítes mediriam o mundo que o `.env` descreve, não o que cada teste declara.
  - Testes: `npm run test:risk-policy` (10 casos puros, fronteiras exatas) e
    `npm run test:mcp-pilot` (9 casos de integração provando a fiação até o banco).
- Testes: `npm run test:research-session`
- Spec: `docs/superpowers/specs/2026-09-06-ferramentas-pesquisa-jesse-design.md`
- Plano: `docs/superpowers/plans/2026-09-06-ferramentas-pesquisa-jesse.md`

### Ingestão point-in-time da CVM (2026-09-06)

Os modelos canônicos `CvmFiling`/`Issuer` existiam no schema desde a Fase 2, com
unit-of-work e testes, e estavam VAZIOS — o `data/cvm/README.md` já registrava
"sem protocolo de documento, sem data de publicação, sem versionamento de
retificação". Agora estão preenchidos.

```
src/lib/server/cvm-header-parser.ts   PURO: CSV de cabeçalho -> issuers + filings
scripts/cvm-ingest/                   script (npm run cvm:ingest) + testes
```

- **Só o cabeçalho, não os valores.** Cada pacote anual traz `itr_cia_aberta_YYYY.csv`
  (~500 KB) com `CD_CVM`, `ID_DOC`, `DT_REFER`, `DT_RECEB`, `VERSAO` e `LINK_DOC`.
  Os arquivos de valores (DRE/BPA/BPP/DFC, centenas de MB) NÃO são baixados —
  `CvmFact` segue vazio de propósito.
- **A defasagem legal presumida VAZA, e não é pouco.** `directional_features.py`
  carimba `knowledge_date = data_ref + 45d (ITR) / 90d (DFP)`. Medido sobre os 48.593
  filings de 2011 a 2026: a mediana confirma o proxy (ITR 44d, DFP 83d), mas o p90 já
  o estoura (ITR 65d, DFP 132d) e **21,3% dos ITR e 19,4% das DFP são entregues DEPOIS
  do prazo presumido**. Para uma em cada cinco linhas, o painel trata o fundamento como
  conhecido antes de existir. É look-ahead real, não hipótese.
- **A retificação é o segundo vazamento, e é irrecuperável para trás.** Os pacotes da
  CVM publicam APENAS a versão corrente nos arquivos de valores — verificado: zero
  documentos com duas versões presentes. O cabeçalho guarda o histórico (uma linha por
  versão, com `DT_RECEB` própria), então sabemos QUEM foi retificado e QUANDO, nunca o
  que mudou. 10,9% dos filings são retificação.
- **`VERSAO` não é ordinal confiável** — dado real: a DIBENS LEASING tem dois
  documentos do mesmo ITR ambos marcados `VERSAO=1`, e há emissor com v1, v2 e um
  SEGUNDO v1 entregue meses depois da v2. A cadeia é ordenada por `DT_RECEB`, com
  versão e protocolo só como desempate.
- **Exercício social não-calendário existe e quebra a derivação por mês:** CAMIL fecha
  em fevereiro (ITR em mai/ago/nov); JALLES MACHADO, BRASILAGRO e CTC fecham em março
  (ITR em jun/set/dez). O trimestre sai do ORDINAL do ITR no pacote, não do mês — isso
  devolve 03→1, 06→2, 09→3 no caso calendário e acerta os demais.
- **`publishedAt` leva desempate de milissegundos.** 24% dos documentos multiversão têm
  duas versões no MESMO DIA (ENERGISA, ITR do 1T2023, v1 e v2 em 2023-05-11) e o domínio
  exige retificação estritamente posterior. A data continua exata nos 10 primeiros
  caracteres; o milissegundo codifica uma ordem que já é dado da CVM.
- **Estado atual:** 1.225 emissores e 48.593 filings (2011-03-31 a 2026-06-30), 7.102
  retificações com cadeia 100% ligada, zero protocolos duplicados.
- **Idempotente:** reexecutar não duplica (verificado — contagem idêntica antes e depois).
- **Três anomalias de identidade que o dado real impõe** (todas tratadas e reportadas na
  saída, nunca em silêncio): ITR de 4º trimestre que o schema não representa (23 casos,
  descartados e nomeados); empresas que mudaram de nome em 15 anos — o lote repete a
  identidade JÁ GRAVADA em vez de sobrescrever, porque SCD-1 destrutivo é proibido; e 5
  emissores cujo CNPJ é compartilhado entre códigos CVM distintos, gravados com CNPJ
  nulo, porque escolher um dono seria inventar.
- Testes: `npm run test:cvm-ingest` (16 casos, parser puro, sem rede nem banco).

**A troca foi feita (2026-09-06).** `directional_features.py` deixou de carimbar sempre
pelo prazo legal:

- `load_filing_dates()` lê `CvmFiling` do banco do app (`prisma/dev.db`, parâmetro
  `filings_db_path`) e devolve a data da **última versão** de cada documento. É essa
  escolha que corrige o vazamento por retificação: o valor guardado em
  `fundamental_indicators` já É o retificado, então carimbá-lo com a data da v1
  afirmaria conhecer em maio um número publicado em novembro.
- Não gravo nada dentro de `cvm_fundamentos.db`: ele é snapshot recopiado do WSL, e a
  coluna se perderia na próxima cópia.
- Duas colunas novas no painel, para o fallback nunca ser silencioso:
  `knowledge_source` (`DT_RECEB` | `PRAZO_LEGAL`) e `is_restatement`. O prazo legal
  segue valendo onde não há filing casado, e a linha diz que foi o caso.
- **Resultado medido sobre as 7.085 linhas reais:** 7.080 casam (99,9%), 5 caem no
  fallback. 12,9% tiveram o carimbo empurrado PARA FRENTE — é o look-ahead removido —
  e **80,1% tiveram o carimbo RECUADO**, porque a empresa publicou antes do prazo legal
  e o painel estava conservador à toa. A troca não é só custo: devolve sinal.
- 18,9% das linhas ficam marcadas como retificação, o que permite treinar com e sem
  elas e medir o efeito.
- Testes: `npm run test:directional:py` (8 casos novos em
  `python/tests/test_directional_knowledge_date.py`).

**Armadilha corrigida em 2026-09-07 — o primeiro retreino não pegou a mudança.** O worker
de treino é lançado pelo `ml_api` Flask com CWD próprio; o default de `DEFAULT_FILINGS_DB`
era relativo (`prisma/dev.db`) e não resolvia, `load_directional_panel` nem aceitava o
parâmetro, e **nada no resultado do treino denunciava a queda para o prazo legal**. O
retreino rodou, publicou e reproduziu EXATAMENTE as métricas antigas (IC 0,1020, t 4,575,
spread 0,0261, n=5256) — só a comparação com uma medição anterior pegou. Três correções:
default ancorado na raiz via `__file__`; `filings_db_path` repassado explicitamente pelo
worker a partir de `cfg['dbPath']` (que o `ml_api` já montava absoluto); e
`knowledge_provenance()` viajando no resultado (`knowledgeProvenance`), para cobertura
zero nunca mais parecer sucesso.

**Medições (rodadas, não publicadas):** a troca do carimbo derruba o IC de 0,1020 para
0,0915 (−10,3%) e melhora t-stat (+11,7%), spread topo-base (+39,2%) e anos positivos
(+10,0%) — o IC anterior vinha em parte de olhar adiante. Excluir as linhas retificadas
NÃO compensa: IC 0,0915 → 0,0905 (−1,1%) com perda de 19% da amostra. `is_restatement`
serve de diagnóstico, não de filtro.

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
