# Plano — infraestrutura de pesquisa governada inspirada em Vibe-Trading

> Para Claude Code: leia primeiro a spec completa em
> `docs/superpowers/specs/2026-07-20-vibe-informed-research-infrastructure-design.md`,
> `CLAUDE.md`, `docs/CODEX_HANDOFF.md` e o vault indicado em `CLAUDE.md`.
> Esta é uma fila de trabalho. Não iniciar dois itens em paralelo e não fazer
> commit/push: cada item requer aceitação independente do Guardião.

## Objetivo

Aprofundar a infraestrutura de pesquisa da WR sem copiar Vibe-Trading: fechar o
backtest econômico real do ML, criar artefatos reproduzíveis, hipótese/meta com
evidências, observabilidade de agentes, preflight operacional e validação
estatística rigorosa.

## Restrições globais

- Reimplementar ideias do zero; sem copiar código, pacotes, frontend, assets ou
  conectores de Vibe-Trading.
- B3 OHLCV oficial é MT5; fundamentos são CVM point-in-time. Sem Yahoo/fallback
  silencioso ou dados sintéticos oficiais.
- Preservar `knowledgeTime`, `t+1`, custos, embargo, determinismo, Zod strict,
  Prisma migrations aditivas e portas/adapters.
- LLM gera conteúdo de pesquisa; não vira fonte financeira canônica e nunca
  executa ordem.
- Não tocar legado sem spec explícita. Não editar `docs/CODEX_HANDOFF.md`.
- Trade permanece DEMO-only, kill switch mestre, aprovação humana e
  `OrderIntent` governado. Item G não faz parte desta execução.
- Testes de TypeScript/Next devem rodar pelo Node Windows no repo
  `C:\WR\wr_trade_pro_`; Python pelo conda `IA_Day_Trading` quando disponível.

## Fila sequencial

### [ ] A. Backtest econômico real do ML Híbrido — P0

**Problema:** o ML Híbrido v1 persiste proxy direcional em
`trainingEvidenceJson.backtestProxy`; o `BacktestRun` governado não é criado.

**Entregáveis:**
1. Spec aditiva dedicada, antes de código, descrevendo a tradução de previsão
   walk-forward para `Signal`/barras e o contrato de custos B3.
2. Adaptador/application service que chama `BacktestRunService`; não duplicar o
   motor `runDeterministicBacktest`.
3. Backtest com barras reais, sinal em `t`, entrada `open[t+1]`, custos
   parametrizados, embargo e referência hash ao artefato ML.
4. `ResearchRun` sempre persistido; `ModelVersion` somente se gate aprovar;
   `BacktestRun` somente se os insumos forem reais e válidos.
5. UI/DTO honesto: nenhum proxy como retorno econômico.

**Testes obrigatórios:**
- nova suíte/harness com SQLite temporário cobrindo t+1, custos, embargo,
  point-in-time, rejeição de artefato/barras insuficientes e determinismo;
- `test:ml-hybrid`, `test:backtest-run`, `test:signal`, `test:model-version`,
  `test:research-run`, `prisma validate`, `tsc --noEmit`, `npm run build`;
- E2E DEMO/read-only: uma execução em subconjunto conhecido, sem criar ordem.

**Aceitação:** existe `BacktestRun` com proveniência auditável ou existe erro
explícito; nunca um resultado econômico inventado.

### [ ] B. Experiment Run Card v1 — P1

**Pré-requisito:** A aceito e publicado.

**Entregáveis:**
1. Spec aditiva e modelos/porta/repository/DTO próprios.
2. Gerador canônico JSON + visualização humana, referenciando IDs existentes
   sem duplicar valores canônicos.
3. Hash de configuração, artefatos, dataset e revisão Git; fontes, janelas,
   timeframe, métricas, validação, avisos e decisão de pesquisa.
4. API read-only paginada/limitada e UI de leitura; artefatos binários somente
   referenciados por hash.

**Testes obrigatórios:** estabilidade do JSON, SHA-256, omissão/redaction de
segredos, ordem determinística, referências inexistentes rejeitadas e resposta
HTTP limitada.

**Aceitação:** qualquer experimento auditável pode ser reconstruído a partir de
um Run Card e seus IDs/hashes; Run Card não autoriza trade.

### [ ] C1. ResearchHypothesis — P1

**Pré-requisito:** B aceito e publicado.

**Entregáveis:** modelo versionado de hipótese com tese, universo, sinal,
fontes, status, invalidação e links para Run Cards; transições explícitas e
append-only para evidência de reprovação.

**Testes obrigatórios:** Zod strict, transições inválidas, vínculo a Run Card,
invalidação preservada, listagem determinística e isolamento por usuário.

**Aceitação:** hipótese reprovada permanece consultável e não pode ser promovida
sem evidência exigida.

### [ ] C2. ResearchGoal + Evidence Ledger — P1

**Pré-requisito:** C1 aceito e publicado.

**Entregáveis:** objetivo com critérios obrigatórios, claims, evidências,
freshness, orçamento e status. Evidência precisa guardar origem, instante,
método, hash/artefato, confiança e caveat.

**Testes obrigatórios:** objetivo não completa com critério obrigatório pendente,
evidência stale/sem fonte recebe status correto, LLM não é aceito como fonte
canônica, orçamento/cancelamento e paginação determinística.

**Aceitação:** a conclusão do comitê é um resultado estruturado, não apenas
texto final.

### [ ] D. AgentRunEvent + timeline/SSE — P2

**Pré-requisito:** C2 aceito e publicado.

**Entregáveis:** ledger append-only de eventos, endpoint paginado, SSE
reconectável autenticado, snapshot reconciliado e UI de timeline. `nodeStatesJson`
continua snapshot; evento não é mutável.

**Testes obrigatórios:** ordem/tie-break determinístico, cancelamento, timeout,
reaper, reconexão SSE, redaction de segredo/prompt e nenhum evento de trade
forjado.

**Aceitação:** uma execução interrompida pode ser entendida e reconciliada sem
consultar log solto.

### [ ] E. Preflight operacional read-only — P2

**Pré-requisito:** D aceito e publicado.

**Entregáveis:** serviço e card Admin para saúde/proveniência de MT5, CVM, ML,
MCP Pilot, migrations/SQLite e gates de trade em modo seguro. Estados devem
ser `LIVE`, `CACHED`, `DEGRADED` ou `UNAVAILABLE`, com causa e timestamp.

**Testes obrigatórios:** cada dependência indisponível/degradada, ausência de
segredo em DTO, endpoint não inicia serviço/não muda estado/não cria ordem.

**Aceitação:** operador sabe, antes de pesquisar, que dado é utilizável e qual é
a sua proveniência.

### [ ] F. Validação estatística auditável — P2

**Pré-requisito:** B aceito e publicado; pode ocorrer depois de E se não houver
conflito.

**Entregáveis:** block bootstrap e análise walk-forward por janela sobre o
backtest econômico, opcionalmente permutação com hipótese nula explicitada.
Persistir método, seed, amostra, IC, p-value, limitações e resultado no Run
Card.

**Restrições:** usar `periodsPerYear` real; não usar `sqrt(252)` fixo; não usar
bootstrap i.i.d. quando a hipótese exigir preservar dependência temporal;
amostra insuficiente falha explicitamente.

**Testes obrigatórios:** seed determinística, timeframe não diário, amostra
insuficiente, blocos corretos, resultados serializáveis e ausência de NaN/Inf.

**Aceitação:** estatística melhora a decisão de pesquisa, nunca mascara
fragilidade ou promove modelo automaticamente.

## Entrega de cada item

1. Guardião cria/aceita a spec específica.
2. Claude Code implementa apenas aquele item em worktree, sem commit/push.
3. Claude entrega lista de arquivos, testes e limitações; não afirma sucesso
   sem saída real.
4. Guardião revisa diff, roda os testes Windows/WSL e executa validação E2E
   quando indicada.
5. Só após aceite: commit seletivo, push e checkpoint no vault/handoff.

## Prompt de início para Claude Code

```text
Leia CLAUDE.md, docs/CODEX_HANDOFF.md, o vault indicado em CLAUDE.md e:
- docs/superpowers/specs/2026-07-20-vibe-informed-research-infrastructure-design.md
- docs/superpowers/plans/2026-07-20-vibe-informed-research-infrastructure.md

Comece SOMENTE pelo Item A (Backtest econômico real do ML Híbrido). Primeiro
faça uma spec aditiva concreta em docs/architecture/ e pare para revisão do
Guardião antes de implementar. Não copie código do Vibe-Trading, não toque
CODEX_HANDOFF.md, não mude legado fora de escopo, não faça commit/push e não
crie caminho de execução de ordem. Todo resultado deve usar o BacktestRun
canônico, dados MT5/CVM point-in-time, entrada t+1, custos explícitos e testes
reais em Windows/WSL.
```
