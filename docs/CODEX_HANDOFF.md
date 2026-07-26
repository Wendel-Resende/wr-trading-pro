# CODEX_HANDOFF — WR Trading Pro

Última atualização: 2026-07-25 (Item D encerrado — pendências resolvidas)

## Estado das iniciativas (atualizado 2026-07-25) — ATENÇÃO: duas numerações de "Item"

> **Aviso p/ quem retomar:** existem DOIS esquemas de numeração de "Item" que se
> sobrepõem nas letras — não confundir. O ponteiro antigo "iniciar pelo Item A"
> desta seção ficou defasado e já causou confusão; substituído por este mapa real
> (verificado contra o git em 2026-07-25).

### Trilha ML (itens A/B/C/D) — TODOS CONCLUÍDOS e na `main`

| Item ML | Escopo | Commit | Estado |
|---|---|---|---|
| **A** | Backtest econômico real do ML Híbrido (governado) | `9c04dea` | ⚠️ na `main`, mas o MOTOR foi removido pelo Item D (ver abaixo) |
| **B** | Previsões ML unificadas/governadas | `9a78f97` | ⚠️ idem — substituído pelo Item D |
| **C** | Treino assíncrono (`MlTrainingRun` job manager) | `2680b0c` | ✅ na `main`, RELIGADO ao motor direcional (`775b237`) |
| **D** | Classificador Direcional com Ensemble Governado | `2f72b7a`..`3d33e3a` | ✅ na `main` (2026-07-25) |

Specs: `docs/architecture/2026-07-20-item-a-backtest-real-ml-hibrido-design.md`,
`.../2026-07-21-item-b-unified-ml-predictions-v1.md`,
`.../2026-07-23-item-c-async-ml-training.md`,
`.../2026-07-25-item-d-directional-classifier-v1.md`. **Nada a iniciar nesta trilha.**

> **ATENÇÃO p/ quem retomar:** o Item D fez uma **substituição limpa** — o motor
> híbrido (TimesFM + LightGBM + CVM, D1 10 pregões) dos itens A e B **não existe
> mais no código**. As specs de A e B seguem válidas como registro histórico do
> que foi feito e por quê, mas descrevem código removido. O único motor de
> previsão da plataforma hoje é o classificador direcional (60 pregões).

### Fila Vibe (research infra, letras A–F) — só A feito

Iniciativa aprovada: implementar incrementalmente padrões de engenharia do
Vibe-Trading, **sem copiar código, pacotes, frontend, assets ou conectores**.
Referência/fila canônica:

- `docs/superpowers/specs/2026-07-20-vibe-informed-research-infrastructure-design.md`
- `docs/superpowers/plans/2026-07-20-vibe-informed-research-infrastructure.md`

Ordem: **A** backtest econômico real → **B** Experiment Run Card → **C1/C2**
hipótese/meta/evidência → **D** eventos/timeline AgentRun → **E** preflight
operacional → **F** validação estatística. Mandato DEMO temporal é estudo futuro
e requer nova aprovação.

| Vibe | Escopo | Estado |
|---|---|---|
| **A** | Backtest econômico real (é o MESMO do Item ML A) | ✅ feito (`9c04dea`) |
| **B** | Experiment Run Card v1 | ⬜ pendente — sem modelo/código no schema |
| **C1** | ResearchHypothesis | ⬜ pendente |
| **C2** | ResearchGoal + Evidence Ledger | ⬜ pendente |
| **D** | AgentRunEvent + timeline/SSE | ⬜ pendente |
| **E** | Preflight operacional read-only | ⬜ pendente |
| **F** | Validação estatística auditável | ⬜ pendente |

**Próximo pendente real da fila Vibe: B (Experiment Run Card v1).** Diferente do
Vibe-A, o B ainda **não tem spec dedicada aprovada** pelo Guardião — só a
descrição de alto nível no plano da fila. Pelo processo multiagente, um item novo
passa por spec → revisão do Guardião → implementação em worktree, sem commit/push
até revisão do diff, sem `OrderIntent`, mantendo MT5/CVM point-in-time e os gates.

## Sessão 2026-07-25 (cont. 12) — Pendências técnicas resolvidas (branch `main`)

Commit `aa90b9f`. Fecha as duas pendências que sobravam do Item D.

### Prova econômica: excesso líquido de custos (não `runGoverned`)

`runGoverned` NÃO foi ligado ao motor direcional, e a decisão está registrada no
próprio método. Ele foi desenhado para sequências de trades BUY/HOLD por
instrumento com horizonte de 10 pregões (motor híbrido); o direcional produz
ordenação da seção transversal com posição mantida por um trimestre. Ligá-lo
exigiria readicionar os dois endpoints Python removidos na Fatia 6b, para servir
um caminho que nenhum modelo ACTIVE alcança — e responderia à pergunta errada.

`src/application/ml-directional/costs.ts`: custo de ida-e-volta
= 2 × (spread + slippage + emolumentos), descontado do excesso por quintil; o
spread topo-fundo desconta o DOBRO (duas pontas). O gate passa a avaliar o
LÍQUIDO — aprovar pelo bruto seria aprovar o que a corretagem come antes de
chegar ao usuário. Métricas brutas ficam lado a lado de propósito.

**Buraco fechado junto:** o `BacktestCostProfile` era obrigatório no treino,
validado e gravado na proveniência, e não alimentava cálculo nenhum. Agora
alimenta o gate. Corretagem FIXA segue de fora (depende do tamanho da carteira,
que o modelo não conhece) — omissão declarada no código, não esquecimento.

### Fase `BACKTESTS` removida

Fora de `MlTrainingRunPhase`. Continua ACEITA na leitura do repositório: runs do
motor híbrido a têm persistida e a auditoria precisa seguir legível.

### Nota de ambiente

`test:ml-training-run` abortou uma vez com erro de nível de SO (`3221226505`,
0xC0000409) e passou limpa na reexecução. Não referencia `BACKTESTS`; parece
flakiness do Prisma/Node no Windows sob invocações repetidas. Se reaparecer com
frequência, investigar antes de culpar a mudança de turno.

## Sessão 2026-07-25 (cont. 11) — COTAHIST 15 anos: HIPÓTESE REJEITADA (spike)

Executado como **spike científico**: o código ficou no scratchpad da sessão e o
repositório NÃO foi tocado (`git status` limpo). Nenhum commit — de propósito:
a pergunta era "mais dados salvam o modelo?", e a resposta dispensa código de
produção.

### O que foi montado

11 arquivos anuais do COTAHIST (2011–2021, 246.578 registros do mercado à
vista, 133 tickers) emendados à série do MT5 por fator de escala na primeira
data comum. Histórico 167 mil → **386 mil barras** (início 2011-01-03); painel
rotulado 2.353 → **5.871 linhas**; folds 4 → **14**.

Eventos societários: 220 candidatos (queda diária ≤ −18%), apenas **6
confirmados** pelo cruzamento com proventos da DFC. Política adotada: descartar
as janelas de 60 pregões contendo candidato não explicado (2,2% das linhas) —
nunca corrigir no escuro.

### Resultado: o sinal DESAPARECE com mais dados

| | 5 anos (4 folds) | 15 anos (14 folds) |
|---|---|---|
| Amostras out-of-sample | 1.608 | 5.312 |
| IC | +0,0720 | **+0,0133** |
| t-stat | 2,16 | **1,05** |
| Spread topo−fundo | +1,17 pp | **−0,46 pp** |
| Anos positivos | 75% | **43%** |

Quintis sem gradiente: Q1 +3,07% · Q2 +8,87% · Q3 +1,69% · Q4 +2,17% · Q5 +2,60%.

### A objeção do preço nominal foi testada e descartada

Mantendo o período de TESTE idêntico (2023–2026, só dados MT5 limpos) e
variando apenas o treino:

    treino desde 2011 (B3+MT5)   IC −0,0277  t −1,37
    treino desde 2019            IC −0,0206  t −1,03
    treino desde 2021 (só MT5)   IC −0,0301  t −1,04

Todos negativos, inclusive treinando só com dado limpo. Não é contaminação do
COTAHIST.

### O que fecha o caso

O recorte 2023–2026, que na sessão anterior dera **IC +0,072 (t=2,16)**, passou
a dar **−0,030** com uma perturbação mínima da amostra (7 tickers a mais, o
filtro de janelas suspeitas, algumas linhas do início de 2021). **Resultado que
troca de sinal assim nunca foi sinal** — era artefato de amostra pequena,
agravado por teste múltiplo (várias configurações testadas, a melhor relatada).

### Conclusão para quem retomar

Não há sinal transversal confiável nos fundamentos CVM para prever retorno
relativo em 60 pregões com as features atuais. As três variáveis do desenho
foram percorridas e nenhuma sobreviveu:

1. horizonte/alvo — absoluto → relativo aos pares;
2. instrumento — classificação binária → ranking (IC/quintis);
3. volume de dados — 5 → 15 anos.

**NÃO refazer o COTAHIST.** Foi feito, funcionou tecnicamente (download, parser
posicional, emenda, detecção de eventos) e a resposta foi não. Se alguém voltar
a essa fonte por outro motivo, o ponto fraco conhecido é a confirmação de
eventos societários: 220 candidatos, só 6 explicados pela DFC, e dividendos
abaixo de 18% passam despercebidos.

O que resta são hipóteses sobre a MATÉRIA-PRIMA, não sobre o método: features
de preço/momentum junto das contábeis, ou valuation relativa à própria história
da empresa (que o painel fundamentalista já calcula). São hipóteses NOVAS, não
refinamentos desta — exigem spec e aprovação.

### Estado da feature Previsões ML

Funcional e honesta: treino assíncrono cancelável, gate de ranking avaliado no
servidor, nenhum modelo ATIVO, UI mostrando os 5 critérios com valores medidos
e o excesso por quintil. O harness detectou, ao longo destas sessões, três
defeitos reais que teriam passado despercebidos — rótulos fabricados,
superconfiança de 95% e a métrica errada. É esse o ativo que ficou.

## Sessão 2026-07-25 (cont. 10) — Troca de instrumento: ranking (branch `main`)

Commits `81b7861` (alvo relativo) e `d8117c5` (instrumento + gates). Fecha a
investigação "por que o modelo não tem sinal?" com a resposta oposta à
esperada: **as features têm sinal; a classificação binária é que o destruía.**

### Diagnóstico — IC por feature

Spearman(feature, excesso de retorno) DENTRO de cada trimestre, 19 períodos:

| feature | IC | t |
|---|---|---|
| `roic` | +0,127 | +3,41 |
| `roa` | +0,123 | +3,39 |
| `roe` | +0,119 | +2,77 |
| `margem_ebit` | +0,103 | +3,50 |
| `delta_roe` | +0,084 | **+3,75** |

**16 de 28 features com |t| > 2.** Fator clássico de ações tem IC 0,02–0,05.
O ensemble também tinha: IC +0,072, t = 2,16.

### Por que a acurácia escondia isso

A vantagem vive na ORDENAÇÃO dentro do trimestre. A classificação binária trata
a empresa do percentil 51 igual à do percentil 99, enquanto o excesso entre
quintis difere em pontos percentuais inteiros. Acurácia 52,1% (abaixo do
baseline 52,2%) e IC 0,072 (t=2,16) descrevem o MESMO modelo.

### O que mudou no código

- `TARGET_MODE = 'sector_relative'`: y = 1 quando o retorno supera a mediana dos
  pares do período. Referência é o MERCADO, com o setor entrando só quando tem
  pares — a taxonomia CVM tem mediana de 2 empresas por (setor, período) e 305
  grupos de UMA só. Efeito: acurácia geral 42,0% → 52,1%, Brier 0,291 → 0,252.
- `_ranking_metrics()` no motor: IC + t-stat, excesso por quintil, spread
  topo-fundo, `spreadByYear`, `positiveYearsRatio`.
- **`gate.ts` REESCRITO** — a §4.7 original (acurácia ≥85%, Brier <0,15,
  cobertura ≥30, delta ≥15 p.p.) media o instrumento errado. Agora:
  IC ≥ 0,02 · t ≥ 2,0 · excesso do quintil superior ≥ 0,5%/tri · spread > 0 ·
  ≥ 60% dos anos positivos. Os 4 códigos antigos PERMANECEM no domínio e no
  Zod: versões já persistidas os têm e a auditoria precisa continuar legível.
- UI: gráfico de barras de excesso por quintil + spread por ano.

### Hipótese REJEITADA pela medição

Previsão registrada antes de medir: rank-normalizar features por período
melhoraria o ensemble. Piorou:

    sem normalizar:  IC +0,0720  t +2,16  spread +1,17 p.p.
    normalizando:    IC +0,0573  t +1,83  spread +0,89 p.p.

`CROSS_SECTIONAL_NORMALIZATION = False` (configurável, medição no docstring).

### Veredito atual: 4 de 5 gates

| critério | limiar | obtido | |
|---|---|---|---|
| IC médio | ≥ 0,02 | 0,072 | ✅ |
| t-stat | ≥ 2,0 | 2,16 | ✅ |
| Excesso do quintil superior | ≥ 0,5%/tri | **+0,03%** | ❌ |
| Spread topo−fundo | > 0 | +1,17 pp | ✅ |
| Anos positivos | ≥ 60% | 75% | ✅ |

Quintis: Q1 −1,13% · Q2 +0,06% · Q3 +1,97% · Q4 **+4,56%** · Q5 +0,03%.

O spread positivo vem de Q1 ser ruim, não de Q5 ser bom. **Quem compra o topo
precisa que o topo pague** — há teste dedicado a esse caso com os números reais.

### Bloqueio de dados confirmado (não tentar de novo sem fonte nova)

- XPMT5-DEMO limita D1 a **1248 barras (~5 anos)** para TODOS os instrumentos,
  incluindo WIN$N e IBOV. `copy_rates_range` devolve o mesmo que
  `copy_rates_from_pos`; repetir a chamada não aprofunda. Não é bug nosso.
- `preco_ref` do snapshot CVM NÃO serve de alternativa: é constante por empresa
  (ITUB4 = 40,04 em todo trimestre), não uma série temporal.
- COTAHIST da B3 (`bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_A<ano>.ZIP`)
  baixa e parseia sem autenticação — verificado, 2020 e 2021. MAS é preço
  NOMINAL contra o AJUSTADO do MT5: razão de 0,30 (PETR4) a 0,90 (WEGE3), e
  não-constante. Usar nominal inverteria 5% dos rótulos no agregado e **22% em
  TAEE11** — concentrado nos pagadores de dividendo, correlacionado com
  `payout_ratio`, que é feature. Só vale com correção de proventos.

### Correção de erro registrada

A "vantagem de +4,3 p.p." do alvo relativo, reportada antes, estava ERRADA:
comparava com "comprar tudo" (47,8%) em vez do melhor preditor constante
("sempre baixa", 52,2%). O ganho real do alvo relativo está na calibração e na
estabilidade, não em acurácia.

### Em aberto

Três leituras do quintil superior fraco, indistinguíveis com 4 anos: ruído nos
extremos (324 obs em Q5); o escore mede qualidade e empresa excelente já está
cara (prêmio no meio da distribuição — resultado conhecido); 60 pregões curto
demais para fundamento virar preço.

## Sessão 2026-07-25 (cont. 9) — Rótulos fabricados + calibração (branch `main`)

Commits `34e2978` (este handoff) e `9973f71`. Continuação direta do Item D: o
usuário pediu a calibração de probabilidade, e ela expôs um defeito bem mais
grave nos próprios rótulos.

### BUG CRÍTICO — 62% dos rótulos eram fabricados

`searchsorted` devolve índice 0 quando o carimbo de conhecimento antecede toda
a série de preços. Como `HistoricalCandle` só tem barras desde **2021-07-26**,
um trimestre de 2011 era "operado" na primeira barra existente (2021) e fechado
60 pregões depois: **o rótulo de 2011 virava o retorno de fevereiro de 2022**.

| | |
|---|---|
| Linhas afetadas | **3.770 de 6.124 (62%)** |
| Defasagem mediana carimbo→entrada | **620 dias** |
| Defasagem máxima | 3.753 dias |

O embargo do alvo vinha MASCARANDO o problema: descartava os folds antigos
porque o `exit_date` fabricado (2022) invadia o teste — na sessão anterior isso
foi lido como "falta de barras", e a conclusão de que o walk-forward rodava com
5 folds estava certa pelo motivo errado.

**Correção:** `MAX_ENTRY_LAG_DAYS = 15` em `ml/directional_classifier.py`. Sem
barra logo após a publicação não existe operação — a linha é descartada, nunca
deslocada para um preço de outro regime. Painel honesto: 2.353 linhas (todas
2021+), defasagem mediana 0 dias, máxima 8. Teste de regressão:
`test_entry_lag_guard_discards_stale_labels`.

### Calibração de probabilidade

`DirectionalEnsemble.calibrate()` aprende o mapa probabilidade-dita →
frequência-observada numa fatia SEPARADA e ANTERIOR ao teste (25% mais recente
do treino, com o mesmo embargo de alvo entre ajuste e calibração). O calibrador
viaja dentro do artefato; sem amostra suficiente o modelo segue cru e reporta
`calibrated: false` em vez de fingir.

| | cru | calibrado |
|---|---|---|
| Brier | 0,306 | **0,291** |
| Sinais de alta confiança | 160 | **0** |

**Default é 'sigmoid' (Platt), NÃO isotônica.** Medido nos dados reais: a
isotônica preserva 43 sinais com acurácia de **39,5%** — anti-preditivos, fruto
de degraus locais ajustados a poucas amostras. O Platt, monótono e suave, não
deixa nenhuma probabilidade passar do gate de 90%.

Métricas ganharam `brierRaw`/`nHighConfidenceRaw`/`calibrated` (antes×depois),
propagados até a UI — o efeito precisa ser auditável, não apenas afirmado.
Campos OPCIONAIS no Zod: artefatos treinados antes desta mudança não os têm.

### Leitura honesta do estado do modelo

Zero sinais não é regressão: é o diagnóstico. A confiança de 95% que o ensemble
cru reportava **não existia** — era superconfiança que o gate de 90% consumia
como se fosse informação. O Brier calibrado (0,291) segue pior que um preditor
constante de 0,5 (~0,25). Com estas features e este horizonte, não há sinal.

Hipóteses restantes, na ordem acordada com o usuário:

1. **Backfill de barras pré-2021** — EM ANDAMENTO. O painel CVM cobre
   2011–2026, mas os preços só 2021–2026; perdem-se 10 anos de história.
   Suspeita a verificar: `Mt5DailyClient.get_daily_rates` usa
   `copy_rates_from_pos(symbol, D1, 0, 5000)`, que devolve o que o terminal já
   tem em cache — `copy_rates_range` costuma forçar o download de uma janela
   maior do servidor do broker.
2. **Alvo relativo ao setor/índice** em vez de direção absoluta (mudança de
   spec, exige aprovação).
3. **Features de preço/momentum** junto das contábeis.

### Verificação

16/16 testes do motor (5 novos), `test_directional_api`, `test:ml-training-run`,
`tsc` e `build` verdes.

## Sessão 2026-07-25 (cont. 8) — Item D: Classificador Direcional (branch `main`)

Substituição limpa do motor de previsão da plataforma. Spec:
`docs/architecture/2026-07-25-item-d-directional-classifier-v1.md`. Sete commits:
`2f72b7a` (motor Python) → `853d6c6` (endpoints) → `49c720d` (Prisma) →
`8c22663` (serviço + rotas) → `29f564d` (UI) → `775b237` (treino async religado)
→ `3d33e3a` (remoção do legado).

### O que existe agora

| Camada | Onde |
|---|---|
| Painel trimestral CVM | `python/ml/directional_features.py` |
| Ensemble + gate + walk-forward | `python/ml/directional_classifier.py` |
| Worker cancelável | `python/ml/directional_worker.py` |
| Endpoints | `POST /ml/directional/{train,predict}`, `/ml/train-jobs*`, `/ml/backfill`, `/ml/health` |
| Persistência | `DirectionalModelVersion`, `DirectionalPrediction` (migration `20260725194135`) |
| Governança | `src/application/ml-directional/` (gate no servidor, ResearchRun, claim CAS) |
| Rotas Next | `GET /api/v1/ml/directional/models`, `.../models/[modelVersion]`, `GET` e `POST` em `.../predictions` |
| UI | `src/components/ml/DirectionalSignalsView.tsx` |
| Testes | `npm run test:directional-classifier` (48 asserts), `npm run test:directional:py` (17) |

**Treinar é `POST /api/v1/ml/training-runs`** (assíncrono/cancelável, Item C
religado). NÃO existe POST em `/api/v1/ml/directional/models` — foi removido de
propósito: um treino síncrono seguraria a conexão por minutos sem poder ser
cancelado, o bug que o Item C existe para não repetir.

### O que foi REMOVIDO (não procure, não existe mais)

Python: `timesfm_adapter.py`, `dataset.py`, `features.py`, `train.py`,
`train_worker.py`, `walkforward.py`; endpoints `/ml/train`, `/ml/predict`,
`/ml/predictions`, `/ml/snapshot-bars`; dependência `timesfm` (entraram
`xgboost` e `scikit-learn`).
Node: `application/ml-hybrid/`, rotas `ml/train`, `ml/predict`,
`ml/model-versions`; `HybridGovernedView`, `MLModelsTab`,
`services/{mlModels,mlService,backtesting,backtestAdapter}.ts`; tools MCP
`ml.run_prediction`/`ml.run_backtest`; suítes `ml-hybrid` e `ml-unified-reads`.

**Tabelas do banco preservadas** (decisão do usuário): nenhuma migration
destrutiva. `MlTrainingRun`, `ModelVersion`, `Signal` e `BacktestRun` seguem lá,
com o histórico do híbrido auditável — inclusive o ResearchRun do treino que o
gate reprovou em 2026-07-18.

### Religações que o legado carregava (armadilhas para quem mexer)

1. **Backfill D1 morava no port do híbrido.** `backfill` entrou em
   `DirectionalMlApiPort` — o motor ML é um processo Flask só.
2. **`GET /api/v1/research-runs` marcaria todo run direcional como REPROVADO:**
   resolvia o veredito lendo `ModelVersion.trainingEvidenceJson`, e a versão
   direcional não vive nessa tabela. Agora consulta `DirectionalModelVersion`
   primeiro e só cai no legado para linhas históricas.
   `isTrainingEvidenceApproved` migrou para `application/model-version`.
3. **`runForMlHybrid` → `runGoverned`** (e tipos correspondentes). A capacidade
   de backtest governado continua viva, mas **ninguém a chama** — ver pendências.

### Resultado científico — GATE REPROVOU nos 4 critérios (E2E ao vivo)

126 tickers, 167 mil barras D1, treino em <30s (sem TimesFM ficou barato):

| Gate | Exigido | Obtido |
|---|---|---|
| Acurácia (alta confiança) | ≥ 85% | **53,9%** ❌ |
| Brier score | < 0,15 | **0,329** ❌ |
| Cobertura último trimestre | ≥ 30 | **6** ❌ |
| Vantagem vs comprar-tudo | ≥ 15 p.p. | **9,3 p.p.** ❌ |

Nenhuma versão ativada; `ResearchRun` REPROVADO; a UI mostra o estado honesto
apontando qual gate falhou. Terceiro motor de ML seguido reprovado pelo próprio
gate (junto com o híbrido de 2026-07-18 e o experimento do Guardião).

**Diagnóstico:** matriz de confusão com **1 verdadeiro positivo contra 206
falsos negativos** — o ensemble quase só aposta na baixa. Brier 0,329 é pior que
um preditor constante de 0,5 (~0,25): superconfiança, não só imprecisão.
Cobertura cai de 243 sinais (2022) para 0 (2026).

**Restrição de dados não prevista na spec:** o painel CVM cobre 2011–2026, mas
`HistoricalCandle` só tem barras desde 2021 — o walk-forward roda com **5 folds**,
não os 15 que a spec assumia.

### Divergências conscientes da spec (todas nos commits)

- **`modelVersion` inclui o digest do dataset** (§4.4 definia só
  hiperparâmetros+features+universo). Sem isso, retreino com dado CVM novo
  colidiria com a versão antiga e — como a publicação é dedup por versão — seria
  descartado em silêncio, servindo o modelo velho sob métricas novas.
- **`researchRunId` é criado pelo Next**, não pelo Python (§4.3 pedia o
  contrário): o motor nunca escreve no Prisma.
- **3 colunas além da spec:** `gateFailures` (sem ela um FAILED não é
  auditável), `prob` (proximidade do corte) e `knowledgeDate` (PIT).
- **Estado `DRAFT`** no ciclo de vida: versão aprovada nasce inerte e só vira
  ACTIVE dentro do claim CAS contra o `MlTrainingRun`.
- **Top features é importância GLOBAL** (ganho do LightGBM), rotulada como tal
  na UI — o ensemble não produz atribuição por empresa (exigiria SHAP).

### Bugs reais corrigidos no caminho

- `float('nan')` nas métricas virava o literal `NaN` no `jsonify` do Flask —
  JSON inválido que quebraria o `JSON.parse` do Node. Vira `None` (0 fingiria
  "errou tudo"; quem reprova esse caso é o gate de cobertura).
- Fixtures do `test:ml-training-run` reusavam a mesma `modelVersion` entre
  cenário aprovado e reprovado; a idempotência por identidade canônica fazia o
  segundo reencontrar a versão ativa do primeiro.
- `npm run build` type-checa `scripts/`, `tsc --noEmit` não — rodar os dois.

### Pendências registradas — TODAS RESOLVIDAS depois (ver sessões cont. 9-12)

1. ~~Treino direcional não gera `BacktestRun`~~ **Resolvido em `aa90b9f`** pelo
   instrumento certo: excesso por quintil LÍQUIDO de custos, não backtest por
   instrumento (ver cont. 12).
2. ~~`MlTrainingRun.phase` com `BACKTESTS` inalcançável~~ **Removida** (`aa90b9f`).
3. ~~Calibração de probabilidade~~ **Feita** (`9973f71`, cont. 9) — revelou que a
   confiança de 95% não existia.
4. ~~Backfill de barras pré-2021~~ **Feito como spike e REJEITADO** (cont. 11):
   com 15 anos o sinal desaparece.

## Sessão 2026-07-25 (cont. 7) — Painel Fundamentalista fatia 5: seletor as-of — PAINEL COMPLETO (branch `main`)

Última fatia do roadmap do painel. Decisão do usuário: **as-of por prazo legal
agora** (o as-of estrito com retificações verdadeiras exige ingestão real no
modelo canônico `CvmFiling`/`CvmFact`, hoje vazio — registrado como pendência).

- **Backend** (`f102407`): `buildFundamentalSheet(cdCvm, asOf?)` e
  `sectorRanking(..., asOf?)` — um filtro único no loop cronológico corta períodos
  cujo carimbo de conhecimento (prazo legal) > corte; séries, DuPont, bandas de
  valuation, preço-justo e mediana setorial respeitam o corte POR CONSTRUÇÃO
  (lastPreco/lastEvPeriod só veem períodos conhecidos). DTO ganha `asOf` ecoado.
- **Rotas:** `?asOf=YYYY-MM-DD` validado (malformado → 400) em
  `/fundamentals` e `/sector-ranking`. Smoke: ABEV3 asOf 2020-01-01 → 28 períodos
  (vs 54 na visão completa); inválido → 400.
- **UI:** input de data "visão em (as of)" + badge amarelo `as of <data>` + botão
  limpar, na ficha E na view Setorial (estado compartilhado). Limitação declarada.
- Verificado: `test:cvm-fundamentals` **68 asserts** verdes, `tsc`/`build` OK.

### PAINEL DE ANÁLISE FUNDAMENTALISTA — ROADMAP CONCLUÍDO (5/5)

1. Ficha por empresa (v1) — `cea3385..65164e0`
2. DuPont/ROIC + fix de escala (fonte única 12M) — `e3dcc7d`
3. Comparação setorial PIT — `9cad178`/`2db6149`
4. Valuation por múltiplos + salvaguardas — `4703460`/`eb1c269`
5. Seletor as-of por prazo legal — `f102407`

Pendência futura registrada: as-of estrito com retificações (requer ingestão real
CVM no modelo canônico); datas de publicação reais no snapshot.

## Sessão 2026-07-25 (cont. 6) — Painel Fundamentalista fatia 4: Motor de Valuation v1 (branch `main`)

Decisão do usuário: **múltiplos + `preco_ref` do pipeline** (self-contained,
determinístico) — não MT5 ao vivo, não DCF (premissas inventadas).

### Entregue

- **Helpers puros** (`multipleBand`, `impliedFairPrice`): banda histórica do múltiplo
  (atual/mediana/min/max/n + posição barato/médio/caro vs mediana ±10%) e preço-justo
  implícito por **reversão à mediana** (`preco × mediana/atual`) — explicitamente NÃO
  é preço-alvo. Commit `4703460`.
- **Salvaguardas de honestidade (motivadas por caso real):** a série de ALOS3 tinha
  EV/EBITDA de até **649×** (EBITDA quase-zero) que gerava mediana 93× e "upside
  +318%" enganoso. Regras documentadas: (1) banda em **janela de 20 trimestres**;
  (2) **teto de plausibilidade** `MULTIPLE_PLAUSIBILITY_CAP=100×` (denominador
  deprimido → não-informativo, descartado); (3) fairPrice exige **n≥8** períodos
  válidos, senão `null`+`BASE_INSUFICIENTE`. Depois: ALOS3 mediana 22,7×, posição
  "médio", upside +1,7% (plausível); ABEV3 sem EV/EBITDA → BASE_INSUFICIENTE.
- **Assembler:** bloco `valuation` no `FundamentalSheetV1` — bandas de EV/EBITDA,
  P/EBITDA, EV/EBIT; preço ref. + período; mediana setorial de EV/EBITDA
  (`setor_cvm`, mesmo período); séries `evEbitda/pEbitda/evEbit` no `series`.
- **UI** (`eb1c269`): subseção "Valuation por Múltiplos" na ficha — cards por múltiplo
  com posição colorida, preço implícito com upside e a nota "não é preço-alvo",
  vs setor, e gráfico EV/EBITDA histórico com linha da mediana.
- Verificado: `test:cvm-fundamentals` verde, `tsc`/`build` OK.

### Roadmap do painel — resta

Seletor "as of" estrito (reconstrução point-in-time com retificações) — decisão de
design pendente com o usuário.

## Sessão 2026-07-25 (cont. 5) — Painel Fundamentalista fatia 3: Comparação Setorial point-in-time (branch `main`)

Ranking de empresas por setor sobre os indicadores 12M do pipeline.

- **Backend:** `cvm-sector-ranking.ts` — `listSectors()` (agrupa por `setor_cvm`, a
  classificação CVM mais limpa: Bancos 10, Energia 10, Construção 12…) e
  `sectorRanking(setor, indicator, ano?, tri?)`. Indicadores comparáveis (allowlist,
  fonte única `fundamental_indicators`): ROE, ROIC, Margem Líq./EBITDA, Dívida
  Líq./EBITDA, Payout, Giro — com `betterWhen` (direção do ranking) e stats do setor
  (mediana/p25/p75/média via helpers puros `median`/`percentile` por interpolação
  linear). **Point-in-time:** período padrão = mais recente cujo carimbo de
  conhecimento (prazo legal) já passou — não compara período não publicado.
- **Rotas:** `GET /api/cvm/sectors` (setores + catálogo de indicadores) e
  `GET /api/cvm/sector-ranking?setor=&indicator=&ano=&trimestre=` (indicator validado
  por allowlist; setor obrigatório; ano/tri opcionais). Verificado no handler:
  Construção Civil / ROE / 2026T1 (carimbo 2026-05-15, comparável) → 12 empresas,
  top CURY3 68,9%, mediana 18,6%; inválidos → 400.
- **UI:** 3ª view "Setorial" no switcher da aba Fundamentos CVM — seletor de setor +
  indicador, tabela de ranking com stats, carimbo de conhecimento e nota PIT.
- Verificado: `test:cvm-fundamentals` verde, `tsc`/`build` OK. Commits `9cad178`, `2db6149`.

### Roadmap do painel — restam

Motor de valuation (múltiplos + preço justo — decisão de fonte de preço pendente);
seletor "as of" estrito (reconstrução point-in-time com retificações).

## Sessão 2026-07-25 (cont. 4) — Painel Fundamentalista fatia 2: Decomposição DuPont/ROIC + correção de escala (branch `main`)

Segunda fatia do Painel de Análise Fundamentalista (roadmap após a ficha v1).

### Entregue

- **DuPont (ROE):** `dupontFactors` (derivado no WR) decompõe `ROE = margem líquida ×
  giro do ativo × alavancagem financeira (1/pl_ativos)`, com **checagem de identidade**
  contra o ROE do pipeline (honesta: flag de divergência; `null` sem base de comparação).
  Bloco `dupont` no `FundamentalSheetV1` + subseção na UI (identidade do último período,
  tabela dos últimos trimestres, gráfico **ROE vs ROIC** com o gap = efeito da alavancagem).
- Verificado: a identidade reconstrói o ROE do pipeline em **100%** dos períodos checáveis.
  Commit `e3dcc7d`.

### Bug do v1 corrigido junto (importante)

A ficha v1 **misturava** a tabela `indicadores` (percentual, trimestral) com
`fundamental_indicators` (decimal, 12M) — escalas E semântica incompatíveis (ex.: ABEV3
2025T4 `indicadores.roe`=5,15% [tri] vs `fundamental_indicators.roe`=0,18 [12M]). Isso
quebrava a identidade DuPont e deixaria os gráficos do v1 errados (ROE ~14 e ROIC ~0,16 no
mesmo eixo). **Correção:** `fundamental_indicators` passa a ser **fonte única** dos
indicadores (decimal → ×100 nos percentuais no DTO); `liquidez_corrente` (razão, escala
segura) segue de `indicadores`; `endividamento`/`divida_pl` (indicadores) trocados por
`divida_bruta_pl` (fundamental_indicators). Escalas coerentes confirmadas (ABEV3 ROE 17,8%
/ ROIC 17,8% / margens ~18-25%). `test:cvm-fundamentals` verde, `tsc`/`build` OK.

### Próximas fatias

Comparação setorial point-in-time; motor de valuation (múltiplos + preço justo);
seletor "as of" estrito.

## Sessão 2026-07-25 (cont. 3) — Ficha Fundamentalista por Empresa (v1) — CONCLUÍDA (branch `main`)

Primeira fatia do "Painel de Análise Fundamentalista" (foco: usar os dados
CVM/B3 que já temos). Motivada pela análise dos diagramas archify do Guardião
(Vibe-Trading/Fincept) — o Fincept tinha um Valuation/análise fundamentalista que
a WR não superficiava. **Decisão do usuário: seguir SEM revisão prévia do Guardião**;
documentar cada etapa para ele verificar depois. Spec/plano:
`docs/architecture/2026-07-25-ficha-fundamentalista-cvm-design.md` e
`docs/superpowers/plans/2026-07-25-ficha-fundamentalista-cvm.md`.

### Backend CONCLUÍDO e verificado (checkpoint)

Superfície read-only por empresa sobre o snapshot `cvm_fundamentos.db`, sem tocar
nenhum fluxo de ML/backtest/execução nem o schema Prisma. Reaproveita
`cvm-legacy-db.ts` (já lê DRE/BPA/BPP/DFC/`indicadores`).

- **`src/lib/server/cvm-fundamentals-derive.ts`** (helpers puros, testados): conversão
  de caixa `fco/lucro_liquido` (lucro≤0 → null+`LUCRO_NAO_POSITIVO`; ausente →
  null+`DADO_AUSENTE`, nunca fabrica); carimbo de conhecimento = fim do período
  (`data_ref` ou fim civil) + prazo legal (ITR T1-T3 +45d; DFP T4 +90d), sempre
  `estimadoPorPrazoLegal` (o snapshot não tem data de publicação real). Commit `cea3385`.
- **`src/lib/server/cvm-fundamentals-sheet.ts`**: `buildFundamentalSheet(cdCvm)` monta
  `FundamentalSheetV1` — séries trimestrais de margens/ROE/ROA/**ROIC**/alavancagem
  (dívida/PL, **dívida líq./EBITDA**, endividamento)/liquidez/**payout** (fonte
  `pipeline-cvm`, lê `fundamental_indicators` + `indicadores`) + conversão de caixa
  (`derivado-wr`), cada ponto com unidade, `dataRef`, `knowledgeDate` e proveniência.
  Commit `51a4b29`.
- **`GET /api/cvm/companies/[cdCvm]/fundamentals`** (read-only, padrão dos `/api/cvm/*`):
  200 com `series`/`provenance`; cd inválido → 400; inexistente → 404. Verificado no
  handler (cd `020958` → 200, 61 tri; `abc12` → 400; `9999999` → 404). Commit `5afb42e`.
- Suíte `npm run test:cvm-fundamentals` (helpers + smoke read-only do assembler contra
  o banco real) verde; `tsc --noEmit` limpo; `npm run build` OK (rota compila, `/api/cvm/*`
  existentes intactos).

### UI CONCLUÍDA

- **`src/components/tabs/CvmFundamentalsTab.tsx`**: seção "Ficha Fundamentalista" no
  detalhe da empresa (aparece quando uma empresa é selecionada). Busca
  `/api/cvm/companies/<cd>/fundamentals` e renderiza 4 gráficos Recharts —
  Retornos (ROE/ROA/ROIC), Alavancagem (dívida/PL & dívida líq./EBITDA), Conversão
  de caixa (FCO/Lucro, rotulada "derivado no WR") e Payout — com lacuna para dado
  ausente (`connectNulls`, nunca zero), rodapé de proveniência (fonte pipeline vs
  derivado WR) e carimbo de conhecimento estimado por prazo legal. Commit `65164e0`.
- Verificação: `npm run test:cvm-fundamentals` verde, `tsc --noEmit` limpo,
  `npm run build` OK. Nada de ML/backtest/execução/Prisma tocado.

**Para ver ao vivo:** o app Electron serve o build de produção — precisa de
`npm run build` (já feito) + reabrir o app; aba **Fundamentos CVM** → selecionar
uma empresa → rolar até "Ficha Fundamentalista".

### Fora de escopo (próximas fatias do painel)

Seletor "as of" estrito; múltiplos/valuation vs preço; comparação setorial PIT;
decomposição DuPont/ROIC explicativa; recálculo a partir de demonstrações cruas.

## Sessão 2026-07-25 (cont. 2) — Regex de ticker B3 unificado (follow-up sistêmico resolvido) (branch `feat/b3-ticker-unification`)

Fechado o follow-up registrado na sessão anterior: o padrão `^[A-Z]{4}\d{1,2}$`
estava duplicado em 9 pontos (8 Node + a guarda de filesystem `_TICKER_RE` do
Flask) e rejeitava tickers reais com dígito na raiz (`B3SA3`). Executado via
subagent-driven (brainstorm → spec → plano → 5 tasks TDD + review por task +
review final de branch). Spec/plano em `docs/superpowers/`.

### O que mudou

- **Fonte única (Node):** novo `src/lib/b3-ticker.ts` exporta o padrão canônico
  `[A-Z][A-Z0-9]{3}\d{1,2}` (raiz 1 letra + 3 alfanuméricos + 1-2 dígitos) e os
  helpers `B3_TICKER_EXACT`, `b3TickerGlobal()` (instância fresca p/ evitar
  `lastIndex`), `isB3Ticker`, `canonicalizeB3Ticker`. Aceita B3SA3, rejeita
  número puro (crucial p/ a extração de texto livre do agent-run), path-safe.
- **8 sites Node** migrados para o módulo: validação Zod (`train-job-port`,
  `training-runs/route`, `train/route`, `ml-hybrid/service`, mcp-pilot),
  canonicalização (`sanitize-text`, `predict/_dto`) e extração de texto livre
  (`agent-run/service`). Zero resíduo do regex antigo (verificado por `git grep`).
- **Python** (`ml_api.py` `_TICKER_RE`): cópia sincronizada do mesmo corpo, com
  comentário cruzado apontando o módulo Node. Guarda de segurança testada via
  `/ml/predict` (sem spawn): aceita B3SA3, rejeita path-traversal/lixo. O review
  final pegou que o `$` do Python casa antes de `\n` (JS não) — corrigido para
  `\Z` (`97186cc`) p/ semântica idêntica ao Node.

### Verificação

Review por task (5/5 Approved) + review final de branch (opus: Ready to merge
YES, zero Critical/Important). `tsc --noEmit` limpo; suítes afetadas verdes
(`b3-ticker` 25 asserts, ml-training-run, ml-hybrid, mcp-pilot, agent-run,
ml-unified-reads com B3SA3, `test_ml_api.py` OK). Commits `36547ea`, `f7dd4a7`,
`2d70fbe`, `05e0f6e`, `ade4961`, `97186cc`.

### Follow-ups registrados (não feitos)

- ~~**Sincronia manual Node↔Python:** hoje travada só por comentário cruzado +
  suítes paralelas.~~ **RESOLVIDO** (`27e2cb3`): o suíte `b3-ticker` agora lê o
  `_TICKER_RE` de `python/ml_api.py` e asserta que o corpo é idêntico ao
  `B3_TICKER_PATTERN` do Node e que a ancoragem Python é `^…\Z`. Drift entre as
  duas cópias falha o teste apontando a divergência.
- **Import misto** `@/lib/b3-ticker` (2 rotas em `src/app`) vs relativo (demais):
  aceitável (cada um segue a convenção/limitação de harness do próprio arquivo).
- **Falha pré-existente e ambiental** em `test:ml-unified-reads` (`POST /ml/predict
  real ... 502` p/ score fora do domínio): existe desde antes deste branch,
  depende do estado do motor :5560 — não introduzida aqui.

## Sessão 2026-07-25 (cont.) — Treino falha após 17min: ticker `B3SA3` fora do regex do resultado (branch `main`)

Depois do fix do `orphan` (build regenerado, app reaberto), o treino
finalmente passou do primeiro poll, rodou a fase pesada DATASET (~17min,
TimesFM populando o cache do universo) e **falhou de novo com o mesmo
sintoma na UI** (`INTERNAL_ERROR: falha não detalhável`), agora ao
concluir. Causa **diferente** das duas anteriores.

### Causa raiz — ticker real fora do regex do `TrainResultSchema`

O job Python **SUCCEDEU**: escreveu `result.json` (514KB), progresso
TRAINING 95%, sem `error.json`. A rejeição foi no lado Node, ao validar o
resultado recebido:

- `TrainResultSchema.universe` (`train-job-port.ts`) validava cada ticker
  com `^[A-Z]{4}\d{1,2}$` (4 letras + 1-2 dígitos).
- O universo real (126 tickers, montado do banco com `symbols=null`)
  inclui **`B3SA3`** — a própria **B3 S.A.**, cuja raiz tem um dígito
  (`B-3-S-A-3`) e não casa com `[A-Z]{4}`.
- Um único ticker fora do regex → resultado INTEIRO rejeitado como
  `UPSTREAM_MALFORMED_RESPONSE` → `INTERNAL_ERROR` + mensagem redigida
  (contém `/ml/train-jobs/...`). ~17min de treino bem-sucedido descartados.

Evidência: `data/ml/training_jobs/<jobId>.result.json` existia e íntegro;
validação manual do payload contra o schema apontou só `B3SA3` fora do
`universe` (todo o resto — hashes, datas ISO, blocks, baselines, artifact
— OK).

### Correção (mesma classe do `orphan`: contrato estrito demais)

- `train-job-port.ts`: `universe` aceita `^[A-Z0-9]{4}\d{1,2}$` (raiz de 4
  chars alfanuméricos + 1-2 dígitos; ainda tight). Commit `542b6f4`.
- `ml-training-run-test.ts`: `fakeTrainResult.universe` ganhou `B3SA3`
  para exercitar o ticker pelo schema real no caminho SUCCEEDED.
- `test:ml-training-run` verde; `tsc --noEmit` limpo.

### Follow-up sistêmico registrado (NÃO feito — requer revisão)

O regex `^[A-Z]{4}\d{1,2}$` está **duplicado em ~10 pontos** (Node e
Python): validação de entrada de treino (`training-runs/route.ts`,
`train/route.ts`), `predict` DTO (`ml-hybrid/service.ts`,
`ml/predict/_dto.ts`), extração de ticker do agent-run
(`agent-run/service.ts`), MCP Pilot (`mcp/pilot/tools/agent-actions.ts`),
canonicalização (`_shared/sanitize-text.ts` → `B3SA3` vira `DESCONHECIDO`)
e o **`_TICKER_RE` do `python/ml_api.py`** que guarda acesso a filesystem
(`/ml/predict`, snapshots — segurança). B3SA3 é silenciosamente
rejeitado/mishandleiado nesses outros fluxos (ex.: prever B3SA3 ao vivo
falharia). Fix coordenado desejável — idealmente com o Guardião, por tocar
guarda de segurança. Padrão B3: raiz de 4 chars (quase sempre letras, mas
B3SA é a exceção com dígito) + 1-2 dígitos de tipo.

## Sessão 2026-07-25 — Treino assíncrono (Item C) quebrado: campo `orphan` fora do contrato (branch `main`)

Usuário reportou treino falhando em ~29ms com
`INTERNAL_ERROR: falha não detalhável (formato restrito)` (job
`cmrzm8xxg0001i1qk0opk17ci`). Debug sistemático (RED→GREEN).

### Causa raiz — divergência de contrato Python↔Node

O `ml_api.py`, no ramo RUNNING de `GET /ml/train-jobs/<id>`
(`python/ml_api.py:191`), emite um campo extra `orphan: boolean`
(distinção `ORPHAN_RUNNING`, Bloqueador 2 da revisão do Guardião). Mas o
`TrainJobStatusSchema` do port (`src/application/ml-training-run/train-job-port.ts`)
é `.strict()` e nunca foi atualizado para declarar esse campo. Cadeia da
falha:

1. RUNNING é o estado normal no **primeiro poll** logo após o start → a
   engine responde `{state:'RUNNING', phase, progress, orphan:false}`.
2. `.strict()` rejeita a chave desconhecida `orphan` →
   `ReadModelError('UPSTREAM_MALFORMED_RESPONSE', '...em /ml/train-jobs/<id>')`.
3. `UPSTREAM_MALFORMED_RESPONSE` **não está** na allowlist
   `KNOWN_ERROR_CODES` (`sanitize.ts`) → `toKnownErrorCode` mapeia para
   `INTERNAL_ERROR`.
4. A mensagem contém `/ml/train-jobs/...` (path) → `sanitizeErrorSummary`
   redige para o fallback `falha não detalhável (formato restrito)`.

Efeito: **todo treino assíncrono do Item C falhava em ~30ms**, sempre. O
happy path nunca funcionou ao vivo. O fake do harness
(`ml-training-run-test.ts`) emitia status RUNNING **sem** `orphan`, então
o gap teste-realidade passou despercebido nos testes verdes.

Reproduzido ao vivo capturando o payload cru: `POST /ml/train-jobs` +
`GET /ml/train-jobs/<id>` no motor real devolveu
`{"orphan":false,"phase":"SNAPSHOT","progress":0,"state":"RUNNING"}`.

### Correção (causa raiz, não sintoma)

O produtor (Python) emite `orphan` legitimamente; o consumidor (Node)
estava estrito demais. Fix = o schema Node **aceitar** o campo (não
remover a informação do Python, que perderia a distinção ORPHAN_RUNNING):

- `train-job-port.ts`: `orphan: z.boolean().optional()` adicionado ao
  `TrainJobStatusSchema`.
- `ml-training-run-test.ts`: interface `FakeJobStatus` ganhou `orphan?`;
  novo teste de regressão `realRunningPayloadWithOrphanFieldIsAccepted`
  (passa o payload real pelo port real e prova que `getStatus` não lança)
  registrado no `main()` — trava o gap teste-realidade.
- Verificação: teste falhava em RED (rejeição do `orphan`), passa em
  GREEN; suíte `test:ml-training-run` inteira verde; `tsc --noEmit` limpo.
  Commit `f64c32f`.

### Observação para o futuro

Sempre que a engine Python adicionar/mudar um campo de resposta, o schema
Zod correspondente no port precisa acompanhar — o fake do harness deve
espelhar o payload REAL (byte a byte), senão testes verdes escondem
divergências de contrato que só aparecem ao vivo. Padrão de erro:
`INTERNAL_ERROR: falha não detalhável` = código fora da allowlist de
`sanitize.ts` (provável `UPSTREAM_MALFORMED_RESPONSE`) + mensagem com
path/token redigida; para ver a causa, capturar o corpo cru do endpoint
Python direto via `curl`.

## Sessão 2026-07-20 (cont. 2) — UPSTREAM_ERROR: 500 ao Treinar (branch `main`)

Depois de ligar o ML Engine (sessão anterior corrigiu o `INTERNAL_ERROR`
genérico), o Treinar passou a mostrar `UPSTREAM_ERROR: 500` — melhor que
antes (não é mais opaco), mas ainda sem causa visível no toast porque o
Flask devolveu um 500 HTML puro (sem JSON, `debug=False`).

### Causa raiz

`data/ml/tfm_cache/BRSR6.parquet` estava truncado (4 bytes) — escrita
anterior interrompida no meio, provável efeito colateral do timeout de
600s conhecido no 1º treino do universo completo (nota da sessão
2026-07-18: "1º treino excede o timeout da rota governada"; se o
processo Node/Python foi cortado no meio de uma escrita de cache, o
parquet fica corrompido). `TimesFmFeatureProvider._load_symbol_cache`
lia o parquet sem tratar exceção; `pyarrow.lib.ArrowInvalid` subia cru
até o Flask → 500 sem corpo → `createHttpMlApiPort` só via o código HTTP
("500") como mensagem, sem detalhe.

Reproduzido chamando `create_app().test_client().post('/ml/train', ...)`
diretamente em Python (sem passar pelo Flask dev server) para capturar o
traceback completo — o service HTTP não expõe traceback por design.

### Correção

`python/ml/timesfm_adapter.py`:
- `_load_symbol_cache`: parquet corrompido vira `warnings.warn` + cache
  vazio pra aquele símbolo (recomputa TimesFM), não derruba o treino.
- `features_for`: escrita agora é atômica (`.tmp` + `os.replace`) — um
  processo morto no meio da escrita nunca mais deixa um parquet
  truncado no lugar do arquivo real. Resolve a causa raiz (não só o
  sintoma): mesmo se o timeout de 600s voltar a cortar um treino no
  meio, o cache não corrompe mais.
- `python/tests/test_ml_timesfm_adapter.py`: 2 testes novos (cache
  corrompido se autocura; escrita não deixa `.tmp` órfão).
- Removido manualmente o `BRSR6.parquet` corrompido do working tree
  (`data/ml/` não é versionado). Reproduzi `POST /ml/train
  {symbols:[BRSR6]}` via test_client após o fix: `200`, cache regravado
  normalmente.
- Commit `9da4d15`. Suíte Python completa de ML (`test_ml_dataset`,
  `test_ml_api`, `test_ml_timesfm_adapter`, `test_ml_candles`,
  `test_ml_features`, `test_ml_fundamentals`, `test_ml_walkforward`)
  rodada individualmente (não via `pytest` — plugin quebra em import
  não relacionado de `web3`/`eth_abi`, ver sessão anterior): todas `OK`.

### Observação para quem depurar erros parecidos no futuro

`UPSTREAM_ERROR: <status>` sem mensagem = o `ml_api.py` devolveu um erro
HTTP sem corpo JSON (geralmente uma exceção Python não tratada virando
500 padrão do Flask). Para ver o traceback real, rodar em Python direto
(não pelo Flask dev server nem pela UI):
```python
from ml_api import create_app
c = create_app().test_client()
r = c.post('/ml/train', json={'symbols': ['<TICKER>']})
```

## Sessão 2026-07-20 (cont.) — diagnóstico do INTERNAL_ERROR ao Treinar (branch `main`)

Usuário reportou `INTERNAL_ERROR: erro interno inesperado` ao clicar
"Treinar (walk-forward)" na aba Previsões ML.

### Causa raiz

O serviço Python `python/ml_api.py` (Flask, porta 5560) estava desligado
(`curl 127.0.0.1:5560/ml/health` sem resposta). Quando `fetch` não
consegue conectar, `createHttpMlApiPort.call()` deixava a exceção crua
de rede (`TypeError: fetch failed`) subir; como não é `ReadModelError`,
a rota `/api/v1/ml/train` caía no catch genérico de `jsonError`
(`src/app/api/v1/_shared/http.ts`), que por design sanitiza qualquer
erro não tipado para `INTERNAL_ERROR` — sem pista nenhuma da causa real
no toast.

### Correção (não é bug de lógica de treino, é de superfície de erro)

- `src/application/ml-hybrid/service.ts` (`createHttpMlApiPort`): falha
  de conexão agora vira `ReadModelError('UPSTREAM_ERROR', ...)` com
  mensagem acionável ("ligue o card ML Engine na aba Admin"); timeout do
  `AbortSignal` vira `ReadModelError('UPSTREAM_TIMEOUT', ...)`. O toast
  em `HybridGovernedView` já renderiza `${code}: ${message}`, então a
  mensagem fica legível sem mudar UI.
- `scripts/ml-hybrid/ml-hybrid-test.ts`: 2 casos novos (conexão recusada
  → `UPSTREAM_ERROR`; timeout → `UPSTREAM_TIMEOUT`) em
  `httpMlApiPortTests`.
- Commit `a99656b`. `npm run test:ml-hybrid` (17 asserções) e
  `npx tsc --noEmit` passaram.

### Ação pendente do usuário

O erro original só some se o serviço `ml_api.py` estiver de fato
rodando. Duas formas: (1) manualmente, `python python/ml_api.py` (env
conda `IA_Day_Trading`) num dos 5 terminais do modo dev; (2) pelo
Electron, ligar o card **"ML Engine"** na aba Admin (o serviço não sobe
sozinho — é opt-in, diferente do MT5 bridge/spread/volatility que o
`electron/main.ts` inicia automaticamente). Depois de ligado, "Treinar"
deve funcionar — mas atenção ao limite conhecido: o 1º treino do
universo completo excede os 600s de timeout da rota governada (ver nota
"Operacional / limitações v1" na sessão 2026-07-18 acima); rodar
`/ml/train` direto uma vez para popular `data/ml/tfm_cache/` antes.

## Sessão 2026-07-20 — ML Híbrido v1.1: predict defasado (branch `main`)

Corrigido o item (1) do backlog v1.1 registrado na sessão 2026-07-18: a
rota `/ml/predict` usava `build_dataset()` + última linha, mas
`build_dataset()` descarta as últimas ~10 barras (o alvo `y` depende do
preço futuro), então a "previsão de hoje" na prática usava features de
~10 pregões atrás.

### Entrega

- `python/ml/dataset.py`: nova `build_inference_row(db_path, cvm_db_path,
  symbol, tfm_provider)` — monta a linha de features para a última barra
  de candle real, sem exigir `y`, preservando point-in-time (lag legal
  dos fundamentos, TimesFM só até a data).
- `python/ml_api.py`: `/ml/predict` passou a usar `build_inference_row`
  em vez de `build_dataset(sample_every=1)` + `iloc[-1]`.
- `python/tests/test_ml_dataset.py`: novo teste
  `test_inference_row_uses_last_candle_not_last_labeled_row` prova que a
  data da linha de inferência é a última barra de candle e é mais
  recente que a última linha rotulada do dataset de treino.
- Commit `a1ae7d4`. `test_ml_dataset.py` e `test_ml_api.py` rodados
  diretamente (script `__main__`, não via `pytest` — o plugin do pytest
  no ambiente conda quebra num import não relacionado de `web3`/`eth_abi`
  no `inspect.getargspec`, pré-existente, nada a ver com esta mudança):
  ambos `OK`.
- Lado Next (`src/application/ml-hybrid/service.ts`) não precisou de
  mudança: só repassa `prediction.date` para `barTime`/`knowledgeTime`
  do `Signal`, já correto com a data mais recente.

### Restante do backlog v1.1 (da sessão 2026-07-18)

2. Backtest real com custos parametrizados + `BacktestRun` governado
   (hoje é proxy direcional, desvio 5/6 do plano).
3. Mais features/horizontes.
4. Fine-tuning TimesFM sobre o mesmo harness.

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
