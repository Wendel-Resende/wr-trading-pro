# Revisão Independente — Dossiê de Upgrade WR Trading Pro

> Revisor: Fable 5 / Claude Code (implementador)
> Data: 2026-07-11
> Objeto: `docs/architecture/upgrade-dossier-2026-07-11.md`
> Método: verificação achado-a-achado contra o código atual (leitura, sem execução).

---

## 1. Veredito geral

O dossiê é sólido. **Verifiquei os 9 achados críticos diretamente no código e todos se confirmam.** A ordem geral do roadmap (contenção → contratos → dados → agentes → MCP → pesquisa) está correta e eu a endosso. As divergências abaixo são pontuais: uma citação de linha imprecisa, um item da Fase 0 que conflita com regra arquitetural registrada no `CLAUDE.md`, uma dependência interna no item 2 que exige split, e correções técnicas no esquema CVM (Decimal e unique com coluna nullable no SQLite).

---

## 2. Verificação dos 9 achados críticos

| # | Status | Evidência verificada |
|---|--------|----------------------|
| CR-1 | **Confirmado** | `src/app/login/page.tsx:30-38` grava `{isAuthenticated: true}` em `localStorage` sem verificar credencial alguma. Não existe `src/middleware.ts` no projeto. Nenhuma rota de API checa sessão. |
| CR-2 | **Confirmado** | `spread_api.py:34,687` e `volatility_api.py:24,277` — `CORS(app)` sem allowlist + `host='0.0.0.0'`. **Incompleto:** ver R-2 abaixo (dashboard de opções tem o mesmo problema e não foi listado). |
| CR-3 | **Confirmado** | `mt5_bridge.py:104-157` despacha qualquer mensagem de qualquer cliente sem token, sem validação de `Origin`, sem vínculo sessão-conta. `self.config` (linha 189-194) é estado global único. Agravante: erros de ordem usam `broadcast=True` (ex.: `handle_send_order:1024,1050`), vazando detalhes de operação para todos os clientes conectados. |
| CR-4 | **Confirmado, com correção de citação** | O vazamento real está em `mt5_bridge.py:114` (`logger.info(f"Data: {msg_data}")` loga o payload de `LOGIN` completo, incluindo `password` e `path`). As linhas 171-174 citadas no dossiê na verdade **mascaram** a senha (`'***' if password`). No frontend, `mt5Service.ts:269` (`console.log('Enviando mensagem:', jsonMessage)`) confirma o vazamento — a mensagem `LOGIN` serializada inclui a senha em claro no console. O redator central da Fase 0 resolve ambos. |
| CR-5 | **Confirmado** | `mt5_bridge.py:1081` — `mt5_order_type_mapping.get(order_type, mt5.ORDER_TYPE_BUY)`. Fail-open exato como descrito. |
| CR-6 | **Confirmado** | `agents/route.ts:47-83` — `getMockSuggestion()` retorna BUY/SELL com `quantity: 100` e é o fallback em três caminhos distintos (parse OpenAI falho :164, parse Ollama falho :199, modo sem match :203). Nenhum campo de proveniência. |
| CR-7 | **Confirmado** | `agents/workers.py:171-188` — `execution_order` é saída bruta do LLM, retornada sem qualquer validação determinística entre recomendação e execução. |
| CR-8 | **Confirmado** | `prisma/schema.prisma:167-227` — `StockMonitoring` guarda fundamentos (`patrimonioLiquido`, `lucroLiquido`, `roe`, etc.) como Float mutável, sem período, sem `publishedAt`, sem escopo CON/IND, sem fonte. Retificação CVM sobrescreve o valor anterior sem rastro. |
| CR-9 | **Confirmado** | `backtesting.ts:41-67` — na barra `i`, o sinal é calculado com `candles.slice(0, i + 1)` (linha 56, inclui `close[i]`) e a entrada abre em `candles[i].close` (linhas 42, 66-67). Lookahead clássico. A correção proposta (sinal em `t`, execução em `open[t+1]`) é o padrão correto. |

**Conclusão:** nenhum falso positivo entre os críticos. A severidade atribuída está adequada — eu não rebaixaria nenhum.

---

## 3. Divergências e ajustes propostos

### R-1 — Item 10 da Fase 0 conflita com regra registrada no CLAUDE.md
O dossiê propõe "Mover estado para `app.getPath('userData')`" (M8 + Fase 0 item 10). O `CLAUDE.md` registra o oposto como regra arquitetural: *"dados locais do WR Trading Pro devem ficar dentro de `wr_trade_pro_`. Não usar `AppData`/`Roaming` como fonte de verdade do app"*.

Ambos os lados têm mérito: o problema real que o achado M8 identifica é **SQLite dentro de pasta sincronizada pelo OneDrive** (`electron/main.ts:66-68` deriva `data/` do `PROJECT_ROOT`, que está em `OneDrive\Área de Trabalho\...`). OneDrive pode travar/copiar o arquivo `.db` durante um write e corromper o banco — esse risco é concreto e o dossiê não o nomeou explicitamente.

**Proposta:** não implementar o item 10 até o Guardião_Hermes decidir explicitamente entre:
- (a) manter a regra do CLAUDE.md e resolver o risco movendo o projeto para fora do OneDrive (ou excluindo `data/` do sync), ou
- (b) revogar a regra, atualizar o CLAUDE.md e migrar para `userData`.

Implementar o item 10 como está seria violar uma decisão registrada sem revogá-la formalmente.

> **Resolvido em 2026-07-14 — opção (a).** O usuário moveu o projeto para fora do OneDrive; o caminho atual é `C:\WR\wr_trade_pro_`. A regra do CLAUDE.md permanece válida (dados locais em `data/` dentro do projeto) e o item 10 do dossiê (migração para `userData`) fica **descartado** — a causa raiz do risco (sync do OneDrive sobre o SQLite) foi eliminada.

### R-2 — CR-2 está incompleto: dashboard de opções também expõe 0.0.0.0
`python/options/dashboard_opcoes.py:466` (e a versão base de apoio, linha 669) também fazem `app.run(host='0.0.0.0', ...)`. O item 1 da Fase 0 deve incluí-los, senão a contenção fica furada.

### R-3 — O próprio servidor Next.js precisa entrar no item 1
O item 1 fala só dos serviços Python. `next dev`/`next start` escutam em todas as interfaces por padrão, e as 21 rotas de API sem autenticação (CR-1) ficam expostas na LAN pelo mesmo vetor. Adicionar `-H 127.0.0.1` aos scripts (`package.json:9,11`) e ao spawn do Electron (`startNextServer`) é uma linha e fecha metade do CR-1 imediatamente, antes mesmo do item 8.

### R-4 — Item 2 tem dependência interna: dividir em 2a (Origin) e 2b (token)
Validar `Origin` no handshake do WebSocket é independente e bloqueia Cross-Site WebSocket Hijacking sozinho — pode ser feito no primeiro dia. Já o **token efêmero precisa de um emissor**, e o emissor natural é a sessão do item 8 (que ainda não existe na ordem proposta). Alternativas sem sessão (token via env var no spawn do Electron) não cobrem o modo dev de 4 terminais. **Proposta:** 2a (Origin allowlist `localhost`) cedo; 2b (token derivado da sessão) logo após o item 8.

### R-5 — Fase 0 deixa uma janela sem controle de ordens até a Fase 3
Os gates exigem "nenhuma ordem real sem aprovação humana + idempotency key + kill switch", mas o roadmap só entrega isso na Fase 3. Entre a Fase 0 e a Fase 3, o `handle_send_order` continua executando qualquer payload bem-formado. Custo baixo para mitigar já na Fase 0:
- variável de ambiente `WR_TRADING_ENABLED` (default `false`) como kill switch no bridge — ~10 linhas;
- chamar `mt5.order_check()` antes de `mt5.order_send()` — validação nativa do MT5, sem lógica nova.

Isso não substitui o A5/A6 (allowlist, limites, idempotência), só fecha a janela. Sugiro como **item 11** da Fase 0.

### R-6 — A7 (mass assignment em spread-orders) merece promoção para a Fase 0
Cliente poder criar ordem já como `FILLED` com tickets arbitrários corrompe a trilha de auditoria que as fases seguintes vão assumir como confiável. O projeto já tem `zod@3.24` instalado (`package.json:91`) — um schema de entrada é esforço de minutos. Sugiro promover.

### R-7 — Item 5 é maior do que parece
Remover `NEXT_PUBLIC_*_API_KEY` (`llmService.ts:437-442`) não é só renomear env vars: o `llmService` roda client-side, então as chamadas LLM precisam migrar para uma rota de API server-side (proxy). Isso é desejável de todo modo (converge com A1/A2 e com o item 6), mas o dossiê deveria dimensioná-lo como refactor pequeno-médio, não como remoção de variável. Itens 5 e 6 devem ser implementados **juntos** — o item 6 sem o 5 quebra o modo OpenAI/Ollama da UI.

### R-8 — Item 9 é viável; preload já é compatível
Verifiquei `electron/preload.ts`: usa apenas `contextBridge`/`ipcRenderer`, que funcionam em preload sandboxed. `sandbox: true` (`main.ts:361`) não deve quebrar nada. Validação obrigatória: `npm run electron:compile` + smoke test do fluxo de opções (IPC `save-options-scan` usa better-sqlite3 no **main process**, não no renderer, então está a salvo). Sem objeção.

### R-9 — Fase 0 sem rede de segurança de testes
M10 (zero testes) é listado como médio, mas interage mal com a Fase 0: vamos mexer em autenticação, logging e envio de ordens sem nenhum teste de regressão. Não proponho montar suíte completa agora, mas sim: (a) um script de smoke manual documentado (login MT5, tick, ordem em conta demo, spread, volatilidade) executado após cada item da Fase 0, e (b) testes unitários apenas para o redator de logs (item 3) e o mapeamento fail-closed (item 4), que são funções puras e triviais de testar. Conforme `AGENTS.md`, `npm run build` + `npm run electron:compile` em todo item que tocar TS/Electron.

---

## 4. Ordem de implementação recomendada — Fase 0

Critério: risco eliminado por hora de esforço, respeitando dependências. Numeração original do dossiê entre parênteses.

| Ordem | Item | Justificativa |
|-------|------|---------------|
| 1 | (4) Fail-closed no tipo de ordem | 1 linha em `mt5_bridge.py:1081`, elimina o pior cenário (compra a mercado acidental). Zero risco de regressão. |
| 2 | (3) Redator central de segredos em logs | Função pura + aplicação em `mt5_bridge.py:114`, `mt5Service.ts:269` e `electron/main.ts`. Testável unitariamente. |
| 3 | (1) Bind `127.0.0.1` + CORS allowlist — **ampliado** | Incluir `dashboard_opcoes.py` (R-2) e `-H 127.0.0.1` no Next (R-3). Mudança de config, reversível. |
| 4 | (2a) Validação de Origin no WebSocket | Split do item 2 (R-4). Independente, bloqueia CSWH imediatamente. |
| 5 | (11 novo) Kill switch + `order_check()` no bridge | R-5. Fecha a janela de ordens sem controle até a Fase 3. |
| 6 | (7) `getMockSuggestion()` → `NO_DECISION` + `mode=degraded` | Requer ajuste coordenado na UI que consome a sugestão — testar o caminho degradado de verdade (Ollama desligado). |
| 7 | (5)+(6) Chaves para o backend + limpar body do endpoint | Juntos, mesmo refactor (R-7): proxy server-side de LLM, remover `NEXT_PUBLIC_*`, remover `api_key`/`local_url` do body. |
| 8 | (8) Sessão HttpOnly + middleware de autenticação | Maior item. Criar `src/middleware.ts`, rota de sessão, cobrir as 21 rotas de API. Nota: app roda em `http://localhost`, então cookie sem flag `Secure` — aceitável local, registrar como limitação. |
| 9 | (2b) Token efêmero no WebSocket derivado da sessão | Depende do item 8 (R-4). |
| 10 | (9) `sandbox: true` + `will-navigate` + `setWindowOpenHandler` | Independente; deixei por último apenas porque exige smoke test Electron completo (R-8). Pode adiantar se houver folga. |
| — | (10) Mover estado para `userData` | ~~Bloqueado~~ **Descartado em 2026-07-14**: projeto movido para fora do OneDrive (opção (a) do R-1); regra do CLAUDE.md mantida. |
| + | (A7 promovido) Zod no `spread-orders` POST | R-6. Encaixar entre os itens 5 e 8, esforço mínimo. |

Com esses ajustes, respondo à pergunta central: **os 10 itens são quase suficientes, mas não exatamente** — faltam o dashboard de opções e o Next no bind local, falta o kill switch mínimo, o item 2 precisa de split por dependência, e o item 10 não deve ser executado como está.

---

## 5. Riscos não cobertos pelo dossiê

1. **SQLite sob OneDrive** — risco de corrupção por sync durante write (detalhado em R-1). É indiscutivelmente o risco de integridade de dados mais imediato do projeto e não aparece nomeado em nenhum achado. **Resolvido em 2026-07-14:** projeto movido para fora do OneDrive (`C:\WR\wr_trade_pro_`).
2. **Credenciais em texto claro no banco** — `AIProvider.apiKey` (`schema.prisma:113`) e `DataSource.config` ("JSON string with credentials/settings", `schema.prisma:125`) persistem segredos sem cifragem no `dev.db`. Combinado com o banco dentro do OneDrive, os segredos sobem para a nuvem da Microsoft. Sugiro achado novo, severidade alta, com remediação via `safeStorage` do Electron ou keyring do SO (Fase 1). *(Nota 2026-07-14: com o projeto fora do OneDrive, o vetor de upload para a nuvem deixou de existir; a cifragem dos segredos no banco segue recomendada para a Fase 1.)*
3. **Vazamento entre clientes via broadcast** — o dossiê cobre a sessão MT5 global (CR-3), mas não que respostas de erro e execução de ordem usam `broadcast()` em vez de resposta ao cliente solicitante (`mt5_bridge.py:1024,1050,1062...`). Mesmo com token por sessão, todo cliente conectado vê as ordens dos demais. A correção do CR-3 precisa incluir *scoping* de respostas, não só autenticação.
4. **Empacotamento distribui código-fonte e config** — `package.json` build inclui `python/**/*` e `agents/**/*` com `asar: false`. Hoje é risco baixo (app local), mas qualquer distribuição futura do instalador carrega tudo. Registrar para a Fase 6.
5. **`getPythonPath()` hardcoded quebra o empacotado em qualquer outra máquina** — o dossiê lista como A13, correto, mas vale explicitar a consequência: o executável Electron atual **só funciona na máquina do desenvolvedor**. Isso eleva a urgência prática de A13 caso haja intenção de rodar em segunda máquina antes da Fase 1.
6. **Fase 0 sem rede de testes** — coberto em R-9; o risco é introduzir regressão de segurança ao corrigir segurança.

---

## 6. Esquema CVM — confirmação com duas correções obrigatórias

O desenho conceitual está **correto e completo** para point-in-time: `versionNumber`/`isRestatement`/`supersedesFilingId` preservam retificações, `validFrom = publishedAt` viabiliza as-of join, `scope` CON/IND e `durationType` cobrem as armadilhas clássicas de dados CVM. A migração aditiva com reconciliação antes do corte é a estratégia certa. Porém, como escrito, o schema tem dois problemas concretos no Prisma 6 + SQLite:

### C-1 — `Decimal` no SQLite não garante exatidão (obrigatório corrigir)
Prisma aceita `Decimal` com o connector SQLite, mas SQLite não possui tipo decimal nativo: a coluna recebe afinidade NUMERIC e o valor é armazenado como REAL (float IEEE 754 de 8 bytes). Ou seja, `valueDecimal Decimal` compila e migra, mas **não entrega a garantia de exatidão que motivou a escolha** — valores com mais de ~15 dígitos significativos perdem precisão silenciosamente, e demonstrações em unidades (scale=UNIT) de empresas grandes chegam lá.

**Correção proposta:**
```prisma
valueRaw   BigInt   // valor na escala original do arquivo, inteiro
scalePow   Int      // expoente decimal: valor real = valueRaw * 10^scalePow
```
(ou, alternativamente, `valueText String` com parse para decimal na aplicação). `BigInt` é armazenado como INTEGER de 64 bits no SQLite — exato. Manter `scale` (UNIT/THOUSAND/MILLION) como metadado de auditoria do arquivo original, mas normalizar `valueRaw` para unidades na ingestão, senão toda query comparativa precisa reescalar.

### C-2 — `@@unique` com `periodStart` nullable não deduplica fatos INSTANT (obrigatório corrigir)
No SQLite (e no padrão SQL), `NULL` é distinto de `NULL` em índices únicos. Como fatos de balanço (INSTANT) terão `periodStart = null`, a constraint `@@unique([filingId, statementType, scope, accountCode, periodStart, periodEnd])` **não impede duplicatas** exatamente na classe de fatos mais comum (BPA/BPP). Correção: tornar `periodStart` obrigatório com a convenção `periodStart = periodEnd` para INSTANT (o campo `durationType` já desambigua), ou usar coluna computada não-nula.

### C-3 — Ajustes recomendados (não bloqueantes)
- **Relações explícitas:** o resumo usa FKs como String solta (`issuerId`, `filingId`...). No Prisma, sem `@relation` não há constraint de integridade referencial no banco. Adicionar `@relation` em todas.
- **Índices para as-of join:** a consulta canônica ("fatos do emissor X conhecidos em T") precisa de `@@index([issuerId, accountCode, periodEnd, validFrom])` em `CvmFact`; sem isso, cada backtest vira full scan.
- **Unicidade de versão em `CvmFiling`:** `@@unique([issuerId, documentType, cvmProtocol])` permite dois registros com o mesmo `referenceDate` e `versionNumber` sob protocolos diferentes — correto para o modelo CVM (cada versão tem protocolo próprio), mas adicionar `@@unique([issuerId, documentType, referenceDate, versionNumber])` protege contra bug de ingestão duplicando versões.
- **Nomenclatura:** os gates falam em `knowledgeTime`; o schema usa `validFrom`. São o mesmo conceito — padronizar um nome nos contratos da Fase 1 para não gerar ambiguidade entre documentos.

**Veredito do esquema:** viável com Prisma 6 + SQLite **após C-1 e C-2**. Volume esperado (DFP/ITR de todas as listadas ≈ poucos milhões de linhas em `CvmFact`) está confortável para SQLite com os índices corretos.

---

## 7. Resumo executivo para o Guardião_Hermes

1. Os 9 críticos estão confirmados no código, sem falso positivo. Única imprecisão: a citação de linha do CR-4 no bridge (o vazamento é `mt5_bridge.py:114`, não :171-174).
2. Fase 0 primeiro está certo. Ajustes: incluir `dashboard_opcoes.py` e o bind do Next no item 1; dividir o item 2 (Origin já, token após sessão); adicionar kill switch + `order_check()` como item 11; promover A7 (Zod em spread-orders); implementar itens 5 e 6 juntos.
3. ~~Item 10 está bloqueado por conflito com o CLAUDE.md~~ **Resolvido em 2026-07-14:** o usuário moveu o projeto para fora do OneDrive (opção (a) do R-1). Item 10 descartado; regra do CLAUDE.md mantida.
4. Riscos novos identificados: corrupção por OneDrive sync, credenciais em claro em `AIProvider`/`DataSource`, broadcast de respostas de ordem para todos os clientes WS, ausência total de testes justamente nas mudanças de segurança.
5. Esquema CVM: aprovado condicionado a duas correções — `Decimal` → `BigInt` + expoente (SQLite armazena Decimal como float) e `periodStart` não-nulo (NULL quebra o `@@unique` para fatos INSTANT).
