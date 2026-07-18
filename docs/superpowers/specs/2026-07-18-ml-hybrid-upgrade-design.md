# ML Híbrido v1 — TimesFM + Fundamentos CVM (design)

Data: 2026-07-18
Status: aprovado pelo usuário (brainstorm em sessão Claude Code)
Execução: subagentes (superpowers:subagent-driven-development), decisão do usuário

## Problema

Os modelos de ML atuais da plataforma (`src/services/mlModels.ts`: MA Crossover e
Regressão Linear sobre closes) são heurísticas sem validação honesta — confiança
arbitrária, sem walk-forward, sem baseline. OHLC puro não basta para direção de
ativos. A plataforma tem fundamentos CVM de 138 empresas em
`data/cvm/cvm_fundamentos.db` e o experimento do Guardião com TimesFM 2.5 200M
(`google/timesfm-2.5-200m-pytorch`) mediu 54,7% de acerto direcional zero-shot;
o híbrido ingênuo (média de sinais) não superou o filtro fundamentalista puro.
Hipótese central desta v1: um modelo que **aprende** a combinação
(preço + TimesFM + fundamentos defasados) supera cada camada isolada.

## Decisões do usuário

| Decisão | Escolha |
|---|---|
| Horizonte | Swing: direção do retorno em 10 pregões (janela de interesse 5–20) |
| Universo | 138 empresas CVM (carteira 12 é subconjunto na UI) |
| Runtime | Serviço Python na plataforma (`python/ml_api.py`, conda `IA_Day_Trading`, RTX 4060) |
| Gate | Híbrido só é promovido se bater os 4 baselines em walk-forward com IC 95% |
| Modelagem | Stacking tabular: LightGBM com TimesFM zero-shot como feature |
| Execução | Implementação por subagentes |

## Expectativa calibrada

Direção de ativos líquidos vive perto de 50%. 54,7% zero-shot já é sinal real;
sucesso sustentável em walk-forward significa 55–60%. O produto não promete
número: promete que só publica modelo que **provou** superar os baselines sem
vazamento de futuro. Reprovação no gate é resultado válido e fica registrado.

## Arquitetura

```text
UI (aba Previsões ML — visão "Híbrido governado")
    ↓ read models
Next.js — rotas /api/v1/ml/* (server-side)
    ├── orquestra: ResearchRun → ModelVersion → Signal → BacktestRun (trilho Fase 5)
    ├── gate de promoção (determinístico, testável, roda no Next)
    └── proxy → serviço Python (loopback)
python/ml_api.py (Flask :5560, loopback-only, conda IA_Day_Trading)
    ├── backfill D1 via lib MetaTrader5 (mesmo padrão do volatility_api.py)
    ├── dataset builder point-in-time (candles + cvm_fundamentos.db)
    ├── TimesFM 2.5 200M zero-shot (lazy-load, GPU) → features
    └── LightGBM treino/inferência (artefato com hash)
Dados
    ├── prisma/dev.db → HistoricalCandle (D1, dedupe por symbol+timeframe+time)
    ├── data/cvm/cvm_fundamentos.db (read-only)
    └── data/ml/models/<hash>/ (artefatos LightGBM; gitignored)
```

O trilho governado da Fase 5 (`research-run`, `model-version`, `signal`,
`backtest-run` em `src/application/`) já existe e está ocioso — esta v1 é seu
primeiro consumidor real. `VersionedMarketBar` NÃO é usado na v1: promover o
backfill ao trilho SCD-2 da Fase 2 exige o gate de reconstrução atômica de
cadeia (registrado no vault) e fica explicitamente fora de escopo.

## Dados e features (point-in-time por construção)

### Backfill D1 (pré-requisito)

- `ml_api.py` conecta à lib `MetaTrader5` (read-only, `copy_rates_*`) e puxa o
  máximo de histórico D1 disponível dos 138 tickers (alvo: 2016+; na prática, o
  que a XP entregar — o walk-forward se adapta ao span real).
- Grava em `HistoricalCandle` com dedupe por `(symbol, timeframe, time)`. O
  estoque atual tem duplicatas (ex.: PETR4 com 9.172 linhas "D1" em 5 anos) e só
  5 tickers: a v1 inclui limpeza das duplicatas existentes e índice único
  Prisma nessa tripla (migração aditiva + dedupe prévio).
- Fonte única MT5, identificada; sem mistura de fontes.
- MT5 indisponível → falha explícita `MT5_DISCONNECTED`; nunca dado sintético.
- Decisão consciente: o Python escreve em `prisma/dev.db` via sqlite3 (WAL,
  transação por lote), apenas linhas em `HistoricalCandle` — nunca DDL; o
  schema continua exclusivo do Prisma. Precedente: o Electron já escreve
  direto no banco de opções via better-sqlite3.

### Features de preço (por ticker/dia)

Retornos 1/5/10/21 pregões; volatilidade realizada 21; momentum 63/126;
distância percentual da MM200; volume relativo (21d vs 126d).

### Features fundamentalistas (defasadas pelo prazo legal)

ROE, margem líquida, margem EBITDA, alavancagem (Dívida/PL), crescimento YoY de
receita e lucro, payout, scores existentes de saúde financeira e qualidade de
dividendos (tabelas `fundamental_indicators`, `indicadores`, exports de score).

Regra anti-vazamento: o trimestre fiscal T só entra no dataset a partir de
`fim_do_trimestre + prazo legal de publicação` — **ITR +45 dias corridos, DFP
(T4) +90 dias corridos**. Nunca a data contábil. Se houver data de publicação
real no banco, ela prevalece quando posterior ao prazo legal.

### Features TimesFM

Previsão zero-shot do retorno acumulado a 10 pregões (mediana dos quantis) +
incerteza (spread interquantil q90−q10), com contexto de até 512 barras D1.
O LightGBM aprende quando confiar no TimesFM — não há média fixa de sinais.

### Outras

Setor (tabela `empresas`) como categórica nativa do LightGBM.

### Alvo

Binário: `close[t+10] > close[t]` (retorno simples a 10 pregões). Relatórios
também mostram retorno médio por decil de score para leitura econômica.

## Modelo e avaliação

### LightGBM

Classificador binário; hiperparâmetros fixos e modestos na v1 (sem busca):
`max_depth ≤ 6`, `num_leaves ≤ 63`, `learning_rate 0.05`, early stopping em
split temporal interno do treino. O inimigo é overfit, não capacidade.

### Walk-forward

- Janela expansiva anual: treina até dez/X, testa jan–dez/X+1, rolando do
  primeiro ano com dados suficientes até hoje.
- **Embargo de 21 pregões** entre fim do treino e início do teste.
- Amostragem a cada 5 pregões por ticker (reduz sobreposição das janelas de
  10d, que infla significância).

### Baselines (mesmo protocolo, mesmas janelas, mesmos dias avaliados)

1. Sempre-alta (prevalência).
2. TimesFM puro (sinal = mediana da previsão > 0).
3. Filtro fundamentalista puro (score de qualidade existente, corte na mediana).
4. LightGBM só-preço (sem features fundamentalistas nem TimesFM) — mede o valor
   incremental dos fundamentos, que é a hipótese central.

### Gate de promoção (roda no Next, determinístico)

O híbrido vira `ModelVersion` válida somente se a acurácia direcional agregada
do walk-forward superar **cada um** dos 4 baselines com IC 95% por bootstrap em
blocos (blocos por ticker-mês; ≥1000 reamostragens). Reprovou → `ResearchRun`
registrado com métricas completas, sem `ModelVersion` promovida e invisível na
visão de previsões da UI.

### BacktestRun com custos

Estratégia long-only por decil superior de score, rebalanceio a cada 10
pregões. Persistido como `BacktestRun` do trilho Fase 5. Acurácia sem retorno
líquido não paga corretagem — as duas métricas aparecem.

*Ajuste v1 (decisão do usuário, pré-voo 2026-07-18):* na v1 o backtest é um
proxy direcional (±2% por acerto/erro, custo fixo 25bps), rotulado como proxy
nas métricas. Retorno real por posição com custos B3 parametrizados fica para
a v1.1, com os preços já no banco.

## Contratos do serviço Python (`ml_api.py`, Flask :5560)

| Endpoint | Função | Erros explícitos |
|---|---|---|
| `POST /ml/backfill` | Backfill D1 dos 138 (ou lista) via MT5; dedupe | `MT5_DISCONNECTED`, por-ticker no relatório |
| `POST /ml/dataset/build` | Monta dataset point-in-time; retorna hash + contagens | `INSUFFICIENT_DATA` |
| `POST /ml/train` | Walk-forward completo + baselines; salva artefato com hash | `INSUFFICIENT_DATA` |
| `POST /ml/predict` | Features de hoje → direção, score, top features | `MODEL_NOT_FOUND`, `INSUFFICIENT_DATA` |

- Loopback-only (`127.0.0.1`), sem segredos novos, sem escrita fora de
  `dev.db` (candles), `data/ml/` e leitura do banco CVM.
- TimesFM lazy-load na primeira chamada que precisar dele.
- Respostas incluem `sourceMeta` (span de candles usado, trimestres CVM,
  versão do TimesFM) para proveniência na UI.

## Integração Next / trilho Fase 5

- Rotas server-side `/api/v1/ml/*` (autenticadas como as demais): disparam
  backfill/treino via serviço Python e persistem no trilho Fase 5.
- Treino: cria `ResearchRun` (input: universo, janelas, hiperparâmetros, hash
  do dataset) → recebe métricas → aplica o gate → se aprovado, cria
  `ModelVersion` (kind `ml-hybrid-swing-v1`, evidência de treino = métricas
  walk-forward + comparação com baselines) e persiste os `Signal` do teste
  walk-forward com `knowledgeTime` correto.
- Inferência: previsões do dia viram `Signal` da `ModelVersion` ativa.
- Artefatos em `data/ml/models/<hash>/` (gitignored), referenciados por hash na
  `ModelVersion` — reproduzível e auditável.
- Previsão **nunca** gera `OrderIntent`. Sem ligação com o trilho de execução.

## UI

- Aba Previsões ML ganha visão **"Híbrido governado"**: previsão por ticker
  (direção + score + top features por importância), métricas walk-forward da
  `ModelVersion` ativa e tabela comparativa contra os 4 baselines. Proveniência
  visível (fonte, span, versão). Rotulado como pesquisa, nunca recomendação.
- Sem `ModelVersion` promovida → a visão mostra o estado honesto ("nenhum
  modelo aprovado no gate") com link para os `ResearchRun` reprovados.
- Heurísticas atuais permanecem, rotuladas "legado".
- Admin: card "ML Engine" com ligar/desligar, mesmo padrão do card MCP Pilot
  (spawn pelo Electron, status por porta, erros fail-closed explicados).

## Testes

- Suíte Node `test:ml-hybrid` (runner no padrão `scripts/*/run-*-tests.cjs`):
  - anti-vazamento: dataset sintético onde usar o futuro = acertar 100% — o
    builder point-in-time deve ficar em ~50%; fundamento com publicação
    posterior à data de decisão não pode aparecer em feature;
  - corretude dos splits walk-forward com embargo (nenhuma amostra de teste a
    <21 pregões do treino);
  - gate determinístico com métricas simuladas (aprova/reprova nos limiares);
  - persistência no trilho Fase 5 (ResearchRun/ModelVersion/Signal/BacktestRun).
- Python: testes de features com fixtures pequenas (candles + trimestres CVM
  sintéticos), dedupe do backfill, prazo legal de defasagem.
- E2E ao vivo antes de concluir: backfill real de alguns tickers, treino em
  subconjunto, previsão de um ticker da carteira 12, conferência dos números.

## Fora de escopo da v1 (registrado)

- Fine-tuning do TimesFM (trilha de pesquisa futura sobre o mesmo harness).
- Intraday e ativos sem fundamentos CVM (índices, dólar, BDRs).
- Promoção do backfill a `VersionedMarketBar`/SCD-2.
- Sinal → ordem automática (nunca nesta camada).
- Nova tool MCP de previsão híbrida.
- Multi-horizonte (só 10 pregões na v1).

## Riscos e mitigação

- **Histórico MT5 raso** (XP pode limitar D1): o walk-forward se adapta ao span
  real; com <4 anos úteis o gate dificilmente aprova — resultado honesto, e o
  backfill de fonte alternativa vira trabalho futuro.
- **VRAM 8GB**: TimesFM 200M em inferência cabe com folga; fine-tuning (fora de
  escopo) não caberia — decisão coerente.
- **Concorrência MT5**: precedente já existe (volatility_api + bridge
  simultâneos); backfill usa retry e reporta por ticker.
- **Sobreposição de alvos**: mitigada por amostragem 5d + embargo 21d +
  bootstrap em blocos; documentada como limitação residual.
