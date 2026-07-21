# Infraestrutura de pesquisa governada — evolução inspirada em Vibe-Trading

Data: 2026-07-20
Status: aprovado pelo usuário para planejamento e implementação incremental
Referência externa estudada: `HKUDS/Vibe-Trading` v0.1.11 (MIT), instalada localmente apenas para inspeção e testes

## Decisão de arquitetura

A WR Trading Pro **não copia, não incorpora e não depende** do código, pacotes,
frontend, runtime ou conectores do Vibe-Trading. A inspeção do repositório WR
não encontrou imports, dependências ou referências de runtime a Vibe/HKUDS.

O que será reutilizado são **padrões de engenharia**, reimplementados do zero
sobre a arquitetura atual da WR:

- Next.js 15 + TypeScript + Prisma/SQLite + Electron;
- serviços Python locais (MT5/CVM/ML), todos loopback-only;
- domínio v1 / ports / adapters / application services;
- dados B3 via MT5 e fundamentos via CVM; nunca Yahoo/A-share como fallback
  oficial;
- trilhos existentes `ResearchRun`, `ModelVersion`, `Signal`, `BacktestRun`,
  `AgentRun`, `RiskDecision`, `OrderIntent` e MCP Pilot.

A prioridade é consolidar a WR como laboratório B3/CVM reproduzível e
observável. Não é ampliar uma plataforma genérica de trading nem habilitar
execução autônoma.

## Contexto verificado

O Vibe possui padrões úteis de produto: hipótese durável, metas de pesquisa
com critérios/evidências, Run Card com hashes/artefatos, runtime de swarm com
eventos reconciliáveis, preflight operacional e validações estatísticas.

A WR já supera a referência em pontos críticos que são inegociáveis:

- ponto no tempo (`knowledgeTime`) para CVM e mercado;
- entrada em `t+1`, custos, embargo e stop/TP intrabar no motor determinístico;
- `RiskPolicy`, kill switch, aprovação humana, idempotência e guarda DEMO;
- migrations auditáveis e testes SQLite temporários.

Nenhuma evolução abaixo pode reduzir essas garantias.

## Objetivos

1. Fechar o ciclo real `ML/Signal -> BacktestRun` com retorno econômico B3 e
   proveniência, substituindo somente o proxy direcional explicitamente
   identificado no ML Híbrido v1.
2. Gerar um dossiê canônico e reproduzível de cada experimento.
3. Dar vida durável a hipóteses, critérios, evidências e invalidações.
4. Tornar a execução de comitês/agentes observável e recuperável sem depender
   de logs soltos.
5. Exibir saúde, origem e degradação de cada dependência operacional.
6. Tornar validação estatística um artefato auditável, sem importar algoritmos
   inadequados para o timeframe B3.

## Escopo incremental priorizado

### Item A — Backtest econômico real para ML Híbrido (P0)

É pré-requisito para os demais itens. O ML Híbrido v1 registra apenas proxy
±2%/25 bps em `trainingEvidenceJson` e não cria `BacktestRun`, pois isso
falsificaria proveniência.

Implementar um adaptador que transforme as previsões walk-forward reais em
sinais e barras reais, e invoque exclusivamente o `BacktestRunService` já
existente. Persistir:

- `ResearchRun` com hash de dataset, universo, janelas e parâmetros;
- `ModelVersion` apenas quando o gate estatístico aprovar;
- `BacktestRun` com `entryRule='open_next_bar'`, custos B3 explicitados,
  timeframe, período, embargo e métricas calculadas pelo motor v1;
- referência hash para `walkforward_predictions.csv` e demais artefatos ML.

Regras: sem proxy apresentado como retorno real; sem dados sintéticos; sem
`OrderIntent`; sem escrita fora dos stores permitidos; falha explícita se faltar
MarketBar/candle elegível.

### Item B — Experiment Run Card v1 (P1)

Criar artefato imutável de leitura que consolide um experimento. Ele não é uma
nova origem de verdade e não duplica resultados: referencia os IDs canônicos.

Campos mínimos:

- `runCardId`, schema/version, timestamps e `codeRevision` Git;
- IDs de `ResearchRun`, `ModelVersion?`, `BacktestRun?`, `DatasetSnapshot?`;
- universo, período, timeframe e regra de entrada;
- hashes de dataset/configuração/código/artefatos e metadados de tamanho;
- fontes, `IngestionRun`, revisão de MarketBars e alcance temporal;
- evidência de treino, métricas e validação estatística;
- avisos estruturados (`DEGRADED`, `INSUFFICIENT_DATA`, `MODEL_REJECTED`,
  `SOURCE_STALE`, etc.);
- decisão de pesquisa (`APPROVED_FOR_RESEARCH`, `REJECTED`,
  `INSUFFICIENT_EVIDENCE`) — nunca autorização de trade.

O artefato deve ter DTO/API read-only, JSON canônico e representação humana.
Artefatos binários permanecem sob `data/` e são referenciados por hash; não vão
para Git nem para resposta HTTP sem paginação/limite.

### Item C — Registro de hipóteses e metas de pesquisa (P1)

Criar `ResearchHypothesis` e, em incremento separado, `ResearchGoal`.

`ResearchHypothesis` registra tese, universo, definição de sinal, fontes,
status (`EXPLORING`, `TESTING`, `VALIDATED`, `REJECTED`, `MONITORING`), critérios
de invalidação e vínculos a Run Cards. Uma reprovação é evidência preservada,
não um registro apagado.

`ResearchGoal` organiza uma investigação: objetivo, critérios obrigatórios,
orçamento, claims, evidências vinculadas, freshness e status explícito como
`INSUFFICIENT_EVIDENCE`, `NEEDS_REFRESH`, `BLOCKED`, `COMPLETE` ou `CANCELLED`.
A conclusão de um comitê não pode marcar um objetivo como completo sem cobrir
os critérios obrigatórios.

Toda evidência deve declarar fonte, URI/identificador, timestamp de coleta,
`dataAsOf`, método, suposições, artefato/hash, confiança e caveat. Evidência do
LLM é texto/proveniência; não é fato financeiro canônico.

### Item D — Ledger de eventos e timeline de AgentRun (P2)

Criar `AgentRunEvent` append-only para persistir transições e observabilidade:

- enfileirado, iniciado, nó iniciado/concluído/falhou/bloqueado;
- orçamento, cancelamento, timeout, reaper e conclusão;
- provider/model, custo e fontes somente como metadados redigidos;
- nenhum segredo, prompt integral ou payload financeiro sensível em claro.

Expor listagem determinística e SSE autenticado/reconectável. A UI deve mostrar
linha do tempo e estado reconciliado. `nodeStatesJson` permanece como snapshot
atual; o ledger é a cronologia, sem alterar retroativamente eventos.

### Item E — Preflight de prontidão e proveniência operacional (P2)

Criar serviço read-only, endpoint autenticado e card Admin para mostrar:

- MT5/bridge e origem dos candles, incluindo modo `LIVE`, `CACHED`,
  `DEGRADED` ou `UNAVAILABLE`;
- integridade/frescor do banco CVM e cobertura por documento;
- ML Engine, modelo ativo, cache TimesFM e última execução;
- MCP Pilot, bind, estado de token sem revelar segredo e privilégios;
- kill switch, guarda DEMO e estado da conta somente como metadados seguros;
- migrations/integridade SQLite e versão de aplicação.

O preflight não inicia serviços, não muda configuração e não executa trade.

### Item F — Validação estatística auditável (P2)

Adicionar módulo independente ao backtest econômico para bootstrap em blocos,
permutação/Monte Carlo adequada e análise walk-forward por janela. Todos devem
registrar seed, método, número de reamostragens, intervalo de confiança,
amostra e limitações no Run Card.

**Não copiar a implementação do Vibe:** sua rotina de permutação usa
`sqrt(252)` fixo. A WR deve reutilizar `periodsPerYear` do timeframe real,
respeitar dependência temporal com block bootstrap e falhar explicitamente quando
a amostra for insuficiente.

### Item G — Mandato DEMO temporal (futuro, P3)

Não implementar agora. Apenas após observação sustentada do MCP Pilot em DEMO.
Se aprovado pelo usuário em nova decisão, estudar autorização imutável e
expirável com limites por sessão/dia e consentimento humano verificável.

Não substitui nem afrouxa: `RiskPolicy`, kill switch, DEMO-only, code de
confirmação, CAS anti-duplo envio, `OrderIntent` e idempotência.

## Fora de escopo

- Copiar código/licença/asset do Vibe-Trading;
- Alpha Zoo, fontes globais genéricas, Yahoo como OHLCV B3 oficial, IM channels
  e conectores de corretoras do Vibe;
- execução autônoma, conta real, ou sinal que crie `OrderIntent` fora do fluxo
  governado atual;
- remoção de legado, tabelas, migrations ou APIs existentes;
- segredos, chaves, prompts sensíveis e payloads de operação no ledger/eventos.

## Regras de entrega

Cada Item é um upgrade separado: spec aditiva -> implementação isolada em
worktree pelo Claude Code -> revisão independente do Guardião -> testes
Windows/WSL -> commit seletivo/push pelo Guardião -> checkpoint em dossiê,
vault e handoff. O Claude não deve editar `docs/CODEX_HANDOFF.md` durante a
implementação de um Item; o Guardião atualiza o handoff após aceitar o
incremento.

A ordem é A, B, C-Hypothesis, C-Goal, D, E, F. Item G requer aprovação nova.
