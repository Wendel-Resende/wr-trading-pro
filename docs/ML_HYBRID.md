# ML Híbrido v1 — TimesFM + Fundamentos CVM

Guia operacional. Fonte de verdade da decisão de produto/arquitetura:
`docs/superpowers/specs/2026-07-18-ml-hybrid-upgrade-design.md` e
`docs/superpowers/plans/2026-07-18-ml-hybrid-upgrade.md` (seção "Desvios
conscientes da spec").

## O que é

Modelo de **direção do preço a 10 pregões** (`close[t+10] > close[t]`), treinado
com LightGBM sobre três famílias de features, point-in-time por construção:

- **Preço:** retornos 1/5/10/21 pregões, volatilidade realizada 21, momentum
  63/126, distância da MM200, volume relativo 21d vs 126d.
- **Fundamentos CVM:** ROE, margem líquida, margem EBITDA, alavancagem
  (Dívida/PL), crescimento YoY de receita e lucro, payout, scores de saúde
  financeira e qualidade de dividendos — **defasados pelo prazo legal de
  publicação** (ITR/T1–T3: `data_ref + 45 dias`; DFP/T4: `data_ref + 90 dias`;
  nunca a data contábil).
- **TimesFM 2.5 200M zero-shot:** previsão do retorno acumulado a 10 pregões
  (mediana dos quantis) + incerteza (spread interquantil q90−q10), como
  feature de entrada do LightGBM — não como sinal isolado.

Universo: as 138 empresas com fundamentos CVM cadastrados (a carteira 12 da UI
é subconjunto). O modelo só é promovido a `ModelVersion` se superar **cada**
um de 4 baselines em walk-forward, com IC 95% por bootstrap. Reprovação no
gate é resultado válido — o `ResearchRun` fica registrado mesmo assim.

## Setup

### Dependências Python (conda `IA_Day_Trading`)

```bash
pip install lightgbm timesfm pyarrow
# Torch com CUDA (RTX 4060 / GPUs compatíveis):
pip install torch --index-url https://download.pytorch.org/whl/cu124
```

### Variáveis de ambiente

Já presentes em `.env.example`:

```bash
# Porta local do motor de ML (loopback-only)
WR_ML_API_PORT=5560
# URL usada pelo Next para falar com o motor
WR_ML_API_URL=http://127.0.0.1:5560
```

## Como rodar

### Serviço

```bash
python python/ml_api.py
```

Sobe um Flask em `127.0.0.1:5560` (loopback-only, sem exposição externa). No
Electron, o card **"ML Engine"** na aba Admin do desktop liga/desliga o
serviço (mesmo padrão do card MCP Pilot: spawn pelo processo main, status por
porta, erros fail-closed explicados na UI).

### Endpoints diretos do serviço (`python/ml_api.py`)

Uso para operação manual, debug e para o passo de aquecimento de cache
descrito abaixo.

```bash
# Saúde do serviço
curl http://127.0.0.1:5560/ml/health

# Backfill D1 via MT5 (universo completo ou lista de tickers)
curl -X POST http://127.0.0.1:5560/ml/backfill \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["PETR4", "VALE3", "WEGE3"]}'

# Treino: walk-forward completo + baselines, salva artefato com hash
curl -X POST http://127.0.0.1:5560/ml/train \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["PETR4", "VALE3", "WEGE3"]}'

# Previsão de hoje para um ticker (modelo já treinado)
curl -X POST http://127.0.0.1:5560/ml/predict \
  -H "Content-Type: application/json" \
  -d '{"symbol": "PETR4"}'
```

### Rotas governadas do Next (`/api/v1/ml/*`)

Autenticadas como as demais rotas da plataforma. Orquestram
`ResearchRun → ModelVersion → Signal` no trilho Fase 5 (`src/application/`) e
aplicam o gate determinístico contra os 4 baselines antes de promover um
modelo. É o caminho usado pela visão **"Híbrido governado"** na aba Previsões
ML.

- `POST /api/v1/ml/backfill`
- `POST /api/v1/ml/train`
- `POST /api/v1/ml/predict`

## Nota operacional — primeira execução do treino

A primeira execução de `/ml/train` para o universo completo (138 tickers)
excede o timeout de 600s da rota governada do Next, porque o TimesFM
zero-shot ainda não tem cache local. Fluxo recomendado:

1. Rodar **uma vez**, direto no serviço Python (sem timeout do Next):
   `POST http://127.0.0.1:5560/ml/train` com o universo completo.
2. Isso popula o cache TimesFM em `data/ml/tfm_cache/`.
3. Daqui em diante, chamadas via `POST /api/v1/ml/train` (rota governada)
   reusam o cache e terminam dentro do timeout.

## Artefatos

Tudo em `data/ml/` (gitignored — runtime, não versionado):

- `data/ml/models/<hash>/`
  - `model.txt` — modelo LightGBM serializado.
  - `walkforward_predictions.csv` — previsões do walk-forward (referenciadas
    por `trainingEvidenceJson`, não persistidas linha-a-linha em `Signal`;
    ver desvio consciente #2 do plano).
  - `metrics.json` — métricas agregadas e comparação contra os 4 baselines.
- `data/ml/tfm_cache/` — cache de inferência zero-shot do TimesFM.

Proveniência oficial via `ResearchRun`/`ModelVersion` do trilho Fase 5: o
hash do artefato é referenciado pela `ModelVersion`, tornando o treino
reproduzível e auditável a partir do banco.

## Gate e baselines

O híbrido só vira `ModelVersion` válida (visível na UI) se a acurácia
direcional agregada do walk-forward superar **cada um** dos 4 baselines, com
IC 95% por bootstrap em blocos (blocos por ticker-mês, ≥1000 reamostragens,
seed fixa 42):

1. **Sempre-alta** — prevalência histórica da classe positiva.
2. **TimesFM puro** — sinal = mediana da previsão zero-shot > 0.
3. **Filtro fundamentalista puro** — score de qualidade (z-score composto),
   corte na mediana cross-section.
4. **LightGBM só-preço** — sem fundamentos nem TimesFM; mede o valor
   incremental dos fundamentos, que é a hipótese central do projeto.

Walk-forward: janela expansiva anual, embargo de 21 pregões entre treino e
teste, amostragem a cada 5 pregões por ticker (reduz sobreposição das janelas
de 10 dias).

**Reprovar é um resultado válido.** Um `ResearchRun` reprovado fica
registrado com métricas completas, mas não gera `ModelVersion` — o modelo não
aparece na visão de previsões da UI, que mostra o estado honesto ("nenhum
modelo aprovado no gate") com link para os `ResearchRun` reprovados.

## Limitações da v1

- **Backtest é proxy direcional**, não retorno real: ±2% por acerto/erro,
  custo fixo de 25bps, rotulado como proxy nas métricas. Retorno real por
  posição com custos B3 parametrizados fica para a v1.1.
- **Sem `BacktestRun` governado na v1** (desvio consciente #6): o
  `BacktestRunService` da Fase 5 recalcula métricas a partir de bars/signals
  reais; persistir o proxy lá falsificaria proveniência. O proxy fica em
  `trainingEvidenceJson.backtestProxy`.
- **Sem fine-tuning do TimesFM** — só zero-shot; fine-tuning é trilha de
  pesquisa futura sobre o mesmo harness.
- **Universo CVM-only** — só os 138 tickers com fundamentos cadastrados;
  intraday e ativos sem fundamentos CVM (índices, dólar, BDRs) ficam de fora.
- **Histórico MT5/XP raso** — na prática ~5 anos (2021+), não os 2016+
  desejados; o walk-forward se adapta ao span real disponível por ticker.
- **`/ml/predict` recompila features a cada chamada** — sem cache de
  features para inferência do dia; custo computacional por chamada.
- **Tickers ausentes na XP** são reportados individualmente no relatório de
  `/ml/backfill` (chave `failed`), nunca silenciados.
