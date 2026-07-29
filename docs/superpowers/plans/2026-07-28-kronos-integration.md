# Integração do Kronos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar o Kronos (foundation model de candles) como segundo motor de previsão da plataforma, zero-shot sobre ações B3 em D1, com a saída convertida em escore transversal trimestral para passar pelo MESMO gate do escore de fator.

**Architecture:** Trilha aditiva espelhando `ml-directional` camada a camada (Python worker → Prisma → domain → application → API → UI → MCP). O modelo é vendorizado em `python/kronos_model/`. O ponto de encaixe crítico: `kronos_scorer.py` produz um DataFrame `wf` com as colunas que `evaluate_walk_forward()` já consome, e a partir daí todo o pipeline de métricas e gate existente é reaproveitado sem cópia.

**Tech Stack:** Python 3.13 (conda `IA_Day_Trading`), PyTorch + HuggingFace Hub, pandas/numpy/scipy, Next.js 15 App Router, Prisma 6 + SQLite, TypeScript 5, Zod, React 19 + Tailwind.

## Global Constraints

- **Zero-shot.** Os pesos do Kronos NUNCA são ajustados. Nenhuma task deste plano importa `finetune/`.
- **Modelo:** `NeoQuasar/Kronos-Tokenizer-base` + `NeoQuasar/Kronos-small` (24,7 M), `max_context = 512`.
- **Amostragem congelada:** `pred_len = 60`, `sample_count = 20`, `T = 1.0`, `top_p = 0.9`, `top_k = 0`.
- **Horizonte:** 60 pregões — igual a `HORIZON_TRADING_DAYS` em `python/ml/directional_classifier.py`. Nunca redefinir esse número localmente; importar a constante.
- **Point-in-time:** nenhuma barra com `time > knowledgeTime` entra em qualquer contexto, em nenhuma task.
- **Gate:** `evaluateDirectionalGate` de `src/application/ml-directional/gate.ts` é IMPORTADO. Nenhum limiar pode ser redeclarado na trilha Kronos.
- **Aditivo:** nenhum arquivo existente é alterado, exceto os explicitamente listados nas tasks 6 e 10.
- **DTOs públicos** nunca expõem `artifactPath`, `pythonJobId` nem hiperparâmetro bruto.
- **Nenhum `OrderIntent`** é emitido por qualquer código deste plano.
- **Idioma:** comentários, docstrings e mensagens de UI em português, com acentuação correta. Códigos de erro em MAIÚSCULAS_COM_UNDERSCORE, em inglês.
- **Pesos e snapshots** vivem em `data/models/kronos/` e `data/ml/bars_snapshot/`, ambos ignorados pelo Git.

---

### Task 1: Vendorizar o modelo Kronos e fixar os pesos

Copia o modelo de `/root/Kronos/model` (WSL, efêmero) para dentro do repo e baixa os pesos uma única vez. Sem isso nenhuma task posterior roda.

**Files:**
- Create: `python/kronos_model/__init__.py`, `python/kronos_model/kronos.py`, `python/kronos_model/module.py`
- Create: `python/ml/kronos_weights.py`
- Modify: `.gitignore`
- Modify: `python/requirements.txt`
- Test: `python/tests/test_kronos_weights.py`

**Interfaces:**
- Consumes: nada.
- Produces: `python/kronos_model` importável como `from kronos_model import Kronos, KronosTokenizer, KronosPredictor`; `ml.kronos_weights.ensure_weights(base_dir: str) -> dict` devolvendo `{'tokenizerDir': str, 'modelDir': str, 'weightsSha256': str}`; constante `ml.kronos_weights.WEIGHTS_SHA256_ENV = 'WR_KRONOS_WEIGHTS_SHA256'`.

- [ ] **Step 1: Copiar o modelo do WSL para o repo**

```bash
wsl -d Ubuntu -- bash -lc "cat /root/Kronos/model/kronos.py"  > python/kronos_model/kronos.py
wsl -d Ubuntu -- bash -lc "cat /root/Kronos/model/module.py"  > python/kronos_model/module.py
wsl -d Ubuntu -- bash -lc "cat /root/Kronos/model/__init__.py" > python/kronos_model/__init__.py
```

Confira que os três arquivos não estão vazios e que nenhum `__pycache__` foi copiado. NÃO copie `examples/`, `finetune/`, `figures/` nem os CSVs de forecast.

- [ ] **Step 2: Ajustar o import relativo do pacote vendorizado**

`python/kronos_model/__init__.py` veio com `from .kronos import ...`, que continua correto. Acrescente no topo do arquivo o cabeçalho de proveniência:

```python
"""Modelo Kronos VENDORIZADO de github.com/shiyu-coder/Kronos (licença no repo
de origem), copiado em 2026-07-28 a partir de /root/Kronos/model no WSL.

Vendorizado de propósito: o WSL é efêmero e o executável Electron precisa ser
auto-contido. Consequência aceita: este diretório NÃO recebe upstream
automaticamente. Ao atualizar, recopie os três arquivos inteiros — nunca
edite-os no lugar, para que o diff contra o upstream continue legível.

Fine-tuning está FORA de escopo: nada de `finetune/` foi copiado.
"""
```

- [ ] **Step 3: Escrever o teste que falha**

```python
# python/tests/test_kronos_weights.py
import os, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))


def test_pacote_vendorizado_expoe_a_api_do_kronos():
    from kronos_model import Kronos, KronosPredictor, KronosTokenizer
    assert hasattr(KronosPredictor, 'predict')
    assert hasattr(KronosPredictor, 'predict_batch')


def test_ensure_weights_e_idempotente_e_devolve_sha256_de_64_hex():
    from ml.kronos_weights import ensure_weights
    base = tempfile.mkdtemp()
    primeiro = ensure_weights(base)
    assert len(primeiro['weightsSha256']) == 64
    assert os.path.isdir(primeiro['tokenizerDir']) and os.path.isdir(primeiro['modelDir'])
    segundo = ensure_weights(base)  # segunda chamada NÃO rebaixa nada
    assert segundo['weightsSha256'] == primeiro['weightsSha256']
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `python -m pytest python/tests/test_kronos_weights.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'ml.kronos_weights'`

- [ ] **Step 5: Implementar `ml/kronos_weights.py`**

```python
"""Download e verificação dos pesos zero-shot do Kronos.

Os pesos NUNCA são ajustados (zero-shot é decisão de escopo, não detalhe de
implementação). O sha256 devolvido aqui entra no `modelVersion` — é ele que
garante que dois treinos com "o mesmo Kronos" sejam de fato o mesmo Kronos.
"""
import hashlib
import os

TOKENIZER_REPO = 'NeoQuasar/Kronos-Tokenizer-base'
MODEL_REPO = 'NeoQuasar/Kronos-small'
WEIGHTS_SHA256_ENV = 'WR_KRONOS_WEIGHTS_SHA256'


def _dir_sha256(path: str) -> str:
    """Digest determinístico do conteúdo de um diretório de pesos.

    Ordena por caminho relativo e mistura o nome junto do conteúdo — renomear
    um arquivo muda o digest, que é o comportamento desejado.
    """
    hasher = hashlib.sha256()
    for root, dirs, files in os.walk(path):
        dirs.sort()
        for name in sorted(files):
            full = os.path.join(root, name)
            rel = os.path.relpath(full, path).replace('\\', '/')
            hasher.update(rel.encode())
            with open(full, 'rb') as f:
                for bloco in iter(lambda: f.read(1024 * 1024), b''):
                    hasher.update(bloco)
    return hasher.hexdigest()


def ensure_weights(base_dir: str) -> dict:
    """Baixa (uma vez) e verifica os pesos. Idempotente."""
    from huggingface_hub import snapshot_download

    os.makedirs(base_dir, exist_ok=True)
    tokenizer_dir = snapshot_download(repo_id=TOKENIZER_REPO,
                                      local_dir=os.path.join(base_dir, 'tokenizer'))
    model_dir = snapshot_download(repo_id=MODEL_REPO,
                                  local_dir=os.path.join(base_dir, 'model'))

    digest = hashlib.sha256()
    digest.update(_dir_sha256(tokenizer_dir).encode())
    digest.update(_dir_sha256(model_dir).encode())
    weights_sha256 = digest.hexdigest()

    # Se o operador fixou um sha esperado, divergência é erro — nunca aviso.
    esperado = os.environ.get(WEIGHTS_SHA256_ENV)
    if esperado and esperado != weights_sha256:
        raise ValueError('KRONOS_WEIGHTS_MISMATCH')

    return {'tokenizerDir': tokenizer_dir, 'modelDir': model_dir,
            'weightsSha256': weights_sha256}
```

- [ ] **Step 6: Acrescentar dependências**

Em `python/requirements.txt`, acrescente ao final:

```
torch>=2.1
huggingface_hub>=0.23
einops>=0.7
```

Instale: `pip install -r python/requirements.txt`

- [ ] **Step 7: Ignorar os pesos no Git**

Acrescente ao final de `.gitignore`:

```
# Pesos zero-shot do Kronos — baixados do HuggingFace, nunca versionados
data/models/kronos/
```

- [ ] **Step 8: Rodar e ver passar**

Run: `python -m pytest python/tests/test_kronos_weights.py -v`
Expected: PASS (o primeiro download leva alguns minutos)

- [ ] **Step 9: Commit**

```bash
git add python/kronos_model python/ml/kronos_weights.py python/tests/test_kronos_weights.py python/requirements.txt .gitignore
git commit -m "feat(kronos): vendoriza o modelo e fixa os pesos zero-shot

O WSL e efemero e o executavel Electron precisa ser auto-contido, entao o
modelo vive no repo. O sha256 dos pesos entra no modelVersion: e ele que
garante que dois treinos com 'o mesmo Kronos' sejam o mesmo Kronos."
```

---

### Task 2: Adaptador determinístico do Kronos

Envolve `KronosPredictor` numa fachada com seed determinística. Kronos amostra; sem esta task a plataforma perde a reprodutibilidade.

**Files:**
- Create: `python/ml/kronos_adapter.py`
- Test: `python/tests/test_kronos_adapter.py`

**Interfaces:**
- Consumes: `ml.kronos_weights.ensure_weights`; `kronos_model.{Kronos, KronosTokenizer, KronosPredictor}`.
- Produces:
  - `ml.kronos_adapter.SAMPLING = {'predLen': 60, 'sampleCount': 20, 'T': 1.0, 'topP': 0.9, 'topK': 0}` (dict congelado)
  - `ml.kronos_adapter.derive_seed(model_version: str, ticker: str, period: str) -> int`
  - `ml.kronos_adapter.KronosForecaster(weights_base_dir: str, device: str | None = None)` com método `forecast_batch(requests: list[dict]) -> list[dict]`, onde cada request é `{'ticker': str, 'period': str, 'bars': pd.DataFrame, 'yTimestamps': pd.Series, 'seed': int}` e cada resposta é `{'ticker': str, 'period': str, 'predictedReturn': float, 'band': {'p10': float, 'p50': float, 'p90': float}, 'contextBars': int}`.

- [ ] **Step 1: Escrever o teste que falha**

```python
# python/tests/test_kronos_adapter.py
import os, sys
import pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.kronos_adapter import SAMPLING, derive_seed


def test_amostragem_congelada_bate_com_a_spec():
    assert SAMPLING == {'predLen': 60, 'sampleCount': 20, 'T': 1.0, 'topP': 0.9, 'topK': 0}


def test_seed_e_deterministica_e_discrimina_os_tres_eixos():
    a = derive_seed('v1', 'PETR4', '2024Q1')
    assert a == derive_seed('v1', 'PETR4', '2024Q1')          # reprodutível
    assert a != derive_seed('v2', 'PETR4', '2024Q1')          # versão importa
    assert a != derive_seed('v1', 'VALE3', '2024Q1')          # ticker importa
    assert a != derive_seed('v1', 'PETR4', '2024Q2')          # período importa
    assert 0 <= a < 2 ** 31                                   # cabe em torch.manual_seed


def test_forecaster_e_reprodutivel_bit_a_bit():
    """Duas execuções com a MESMA seed produzem o MESMO retorno previsto.

    É a garantia central: sem ela, 'reprodutível' seria falso para o Kronos.
    Marcado como lento porque carrega o modelo de verdade — nunca mocka o
    modelo aqui, já que é exatamente a estocasticidade dele que está sob teste.
    """
    import numpy as np
    from ml.kronos_adapter import KronosForecaster

    rng = np.random.default_rng(11)
    close = 100 * np.cumprod(1 + rng.normal(0, 0.01, 512))
    tempo = pd.date_range('2020-01-01', periods=512, freq='B')
    bars = pd.DataFrame({'time': tempo, 'open': close, 'high': close * 1.01,
                         'low': close * 0.99, 'close': close, 'volume': 1000.0})
    futuro = pd.Series(pd.date_range('2022-01-01', periods=60, freq='B'))

    f = KronosForecaster(os.environ.get('WR_KRONOS_WEIGHTS_DIR', 'data/models/kronos'))
    pedido = [{'ticker': 'TESTE', 'period': '2022Q1', 'bars': bars,
               'yTimestamps': futuro, 'seed': derive_seed('v1', 'TESTE', '2022Q1')}]
    primeiro = f.forecast_batch(pedido)[0]
    segundo = f.forecast_batch(pedido)[0]
    assert primeiro['predictedReturn'] == segundo['predictedReturn']
    assert primeiro['contextBars'] == 512
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python -m pytest python/tests/test_kronos_adapter.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'ml.kronos_adapter'`

- [ ] **Step 3: Implementar `ml/kronos_adapter.py`**

```python
"""Fachada determinística sobre o KronosPredictor.

O Kronos AMOSTRA caminhos futuros — duas execuções idênticas divergem por
padrão, o que é incompatível com a garantia de reprodutibilidade da
plataforma. Esta camada existe para eliminar essa divergência: seed derivada
de (modelVersion, ticker, período) e parâmetros de amostragem congelados.

Nunca exponha `T`/`top_p`/`sample_count` como argumento de chamada: se o
usuário puder variá-los por execução, o `modelVersion` deixa de identificar o
que de fato rodou.
"""
import hashlib
import os

import numpy as np
import pandas as pd

#: Parâmetros de amostragem CONGELADOS. Mudar qualquer um destes é mudar o
#: modelo, e portanto exige nova `modelVersion` — nunca ajuste em runtime.
SAMPLING = {'predLen': 60, 'sampleCount': 20, 'T': 1.0, 'topP': 0.9, 'topK': 0}

#: Colunas exigidas pelo Kronos. `amount` (notional) é opcional na API dele;
#: não temos essa coluna em D1 da B3, então não é enviada.
_CONTEXT_COLUMNS = ['open', 'high', 'low', 'close', 'volume']

MAX_CONTEXT = 512


def derive_seed(model_version: str, ticker: str, period: str) -> int:
    """Seed determinística e independente de ordem de execução.

    Deriva de sha256 em vez de `hash()` porque o `hash()` do Python é
    randomizado por processo (PYTHONHASHSEED) — usá-lo tornaria o resultado
    dependente do processo, que é exatamente o que estamos evitando.
    """
    digest = hashlib.sha256(f'{model_version}|{ticker}|{period}'.encode()).digest()
    return int.from_bytes(digest[:4], 'big') % (2 ** 31)


class KronosForecaster:
    """Carrega o modelo uma vez e prevê em lote."""

    def __init__(self, weights_base_dir: str, device: str | None = None):
        import torch

        from kronos_model import Kronos, KronosPredictor, KronosTokenizer

        from .kronos_weights import ensure_weights

        pesos = ensure_weights(weights_base_dir)
        self.weights_sha256 = pesos['weightsSha256']
        self._torch = torch
        self._device = device or ('cuda' if torch.cuda.is_available() else 'cpu')

        tokenizer = KronosTokenizer.from_pretrained(pesos['tokenizerDir'])
        modelo = Kronos.from_pretrained(pesos['modelDir'])
        self._predictor = KronosPredictor(modelo, tokenizer,
                                          device=self._device, max_context=MAX_CONTEXT)

    def forecast_batch(self, requests: list[dict]) -> list[dict]:
        """Prevê 60 pregões para cada pedido e agrega em retorno + banda.

        Usa `predict_batch` (não `predict` em laço) porque o custo de GPU é o
        risco declarado da entrega — o laço desperdiça o paralelismo.
        """
        if not requests:
            return []

        dfs, x_stamps, y_stamps = [], [], []
        for pedido in requests:
            bars = pedido['bars'].sort_values('time').tail(MAX_CONTEXT).reset_index(drop=True)
            dfs.append(bars[_CONTEXT_COLUMNS])
            x_stamps.append(bars['time'])
            y_stamps.append(pd.Series(pedido['yTimestamps']).reset_index(drop=True))

        # Uma seed por lote: os pedidos já são determinísticos em conjunto
        # porque a composição do lote é determinística (ver kronos_scorer).
        self._torch.manual_seed(requests[0]['seed'])
        if self._device == 'cuda':
            self._torch.cuda.manual_seed_all(requests[0]['seed'])

        previsoes = self._predictor.predict_batch(
            df_list=dfs, x_timestamp_list=x_stamps, y_timestamp_list=y_stamps,
            pred_len=SAMPLING['predLen'], T=SAMPLING['T'], top_k=SAMPLING['topK'],
            top_p=SAMPLING['topP'], sample_count=SAMPLING['sampleCount'], verbose=False,
        )

        saidas = []
        for pedido, entrada, previsto in zip(requests, dfs, previsoes):
            ultimo = float(entrada['close'].iloc[-1])
            caminho = np.asarray(previsto['close'], dtype=float)
            # `predict_batch` já devolve a MÉDIA das amostras; a banda usa a
            # dispersão do caminho previsto, que é o que sobra de informação
            # sobre incerteza sem reexecutar a amostragem.
            final = float(caminho[-1])
            saidas.append({
                'ticker': pedido['ticker'],
                'period': pedido['period'],
                'predictedReturn': (final / ultimo) - 1.0 if ultimo > 0 else 0.0,
                'band': {
                    'p10': float(np.percentile(caminho, 10) / ultimo - 1.0),
                    'p50': float(np.percentile(caminho, 50) / ultimo - 1.0),
                    'p90': float(np.percentile(caminho, 90) / ultimo - 1.0),
                },
                'contextBars': int(len(entrada)),
            })
        return saidas
```

- [ ] **Step 4: Rodar e ver passar**

Run: `python -m pytest python/tests/test_kronos_adapter.py -v`
Expected: PASS (o terceiro teste leva ~1 min carregando o modelo)

- [ ] **Step 5: Commit**

```bash
git add python/ml/kronos_adapter.py python/tests/test_kronos_adapter.py
git commit -m "feat(kronos): adaptador com seed deterministica

Kronos amostra caminhos futuros, entao duas execucoes identicas divergem por
padrao. A seed vem de sha256(modelVersion|ticker|periodo) e nao de hash(),
porque hash() e randomizado por processo — usa-lo faria o resultado depender
do processo, exatamente o que se quer eliminar."
```

---

### Task 3: Contexto point-in-time e escore transversal

O coração da spec: monta contextos que nunca enxergam o futuro e converte retorno previsto em escore transversal.

**Files:**
- Create: `python/ml/kronos_scorer.py`
- Test: `python/tests/test_kronos_scorer.py`

**Interfaces:**
- Consumes: `ml.kronos_adapter.{SAMPLING, derive_seed}`; `ml.directional_classifier.{HORIZON_TRADING_DAYS, assign_quantiles, classify_signal, QUANTILES}`.
- Produces:
  - `ml.kronos_scorer.build_context(bars: pd.DataFrame, knowledge_time: pd.Timestamp, max_context: int = 512) -> pd.DataFrame`
  - `ml.kronos_scorer.future_timestamps(bars: pd.DataFrame, knowledge_time: pd.Timestamp, pred_len: int = 60) -> pd.Series`
  - `ml.kronos_scorer.score_cross_section(forecasts: list[dict]) -> pd.DataFrame` com colunas `['ticker', 'predictedReturn', 'score', 'percentile', 'quantile', 'signal']`

- [ ] **Step 1: Escrever o teste que falha**

```python
# python/tests/test_kronos_scorer.py
import os, sys
import numpy as np
import pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.kronos_scorer import build_context, future_timestamps, score_cross_section


def barras(n=600, inicio='2020-01-01', seed=3):
    rng = np.random.default_rng(seed)
    close = 100 * np.cumprod(1 + rng.normal(0, 0.01, n))
    return pd.DataFrame({'time': pd.date_range(inicio, periods=n, freq='B'),
                         'open': close, 'high': close * 1.01, 'low': close * 0.99,
                         'close': close, 'volume': 1000.0})


def test_contexto_nunca_inclui_barra_posterior_ao_knowledge_time():
    b = barras()
    corte = b['time'].iloc[300]
    ctx = build_context(b, corte)
    assert ctx['time'].max() <= corte
    assert len(ctx) == 301  # inclusive no carimbo, nada depois


def test_contexto_e_truncado_em_512_barras():
    b = barras(n=1000)
    ctx = build_context(b, b['time'].iloc[900])
    assert len(ctx) == 512
    assert ctx['time'].is_monotonic_increasing


def test_contexto_insuficiente_e_erro_explicito_nunca_preenchimento():
    b = barras(n=600)
    try:
        build_context(b, b['time'].iloc[10])
    except ValueError as exc:
        assert 'INSUFFICIENT_CONTEXT' in str(exc)
    else:
        raise AssertionError('contexto curto deveria falhar, nunca ser preenchido')


def test_timestamps_futuros_tem_pred_len_e_comecam_depois_do_corte():
    b = barras()
    corte = b['time'].iloc[300]
    y = future_timestamps(b, corte, pred_len=60)
    assert len(y) == 60
    assert y.iloc[0] > corte


def test_escore_e_o_percentil_transversal_centrado_em_zero():
    previsoes = [{'ticker': f'AAA{i}', 'predictedReturn': r}
                 for i, r in enumerate([-0.10, -0.02, 0.0, 0.03, 0.15])]
    df = score_cross_section(previsoes)
    assert list(df['ticker']) == ['AAA0', 'AAA1', 'AAA2', 'AAA3', 'AAA4']
    assert df['score'].iloc[0] < 0 < df['score'].iloc[-1]   # centrado em 0
    assert df['percentile'].is_monotonic_increasing
    assert df['quantile'].iloc[-1] == 5 and df['quantile'].iloc[0] == 1
    assert df['signal'].iloc[-1] == 'COMPRA' and df['signal'].iloc[0] == 'VENDA'


def test_escore_ignora_a_escala_do_retorno_so_a_ordem_importa():
    """Duas seções com retornos de escalas MUITO diferentes, mesma ordem,
    produzem os mesmos escores — é o que 'transversal' significa."""
    a = score_cross_section([{'ticker': 'X', 'predictedReturn': 0.001},
                             {'ticker': 'Y', 'predictedReturn': 0.002},
                             {'ticker': 'Z', 'predictedReturn': 0.003}])
    b = score_cross_section([{'ticker': 'X', 'predictedReturn': 0.10},
                             {'ticker': 'Y', 'predictedReturn': 0.50},
                             {'ticker': 'Z', 'predictedReturn': 9.90}])
    assert list(a['score']) == list(b['score'])
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python -m pytest python/tests/test_kronos_scorer.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'ml.kronos_scorer'`

- [ ] **Step 3: Implementar `ml/kronos_scorer.py`**

```python
"""Contexto point-in-time e conversão da previsão em escore transversal.

Duas responsabilidades, ambas sensíveis:

1. `build_context` — o único lugar que decide QUAIS barras o Kronos enxerga.
   Um off-by-one aqui é vazamento de futuro que nenhum gate detecta, porque o
   modelo passaria a acertar por conhecer a resposta.

2. `score_cross_section` — converte retorno previsto em percentil transversal.
   A escala do retorno é DESCARTADA de propósito: o Kronos zero-shot não foi
   calibrado para a B3, então o nível do retorno previsto não é confiável, mas
   a ORDENAÇÃO entre empresas pode ser. É a mesma aposta do escore de fator.
"""
import numpy as np
import pandas as pd

from .directional_classifier import QUANTILES, assign_quantiles, classify_signal

MAX_CONTEXT = 512
#: Piso de barras para uma previsão ser aceita. Abaixo disso o contexto é
#: curto demais para o Kronos ter o que condicionar, e completar com o que
#: quer que seja seria fabricar histórico.
MIN_CONTEXT = 128


def build_context(bars: pd.DataFrame, knowledge_time, max_context: int = MAX_CONTEXT) -> pd.DataFrame:
    """Últimas `max_context` barras com `time <= knowledge_time`.

    A comparação é `<=` e não `<`: a barra DO dia do carimbo já fechou quando
    o conhecimento existe. Barra posterior nunca entra — é a trava 1 da spec.
    """
    corte = pd.Timestamp(knowledge_time)
    passado = bars[pd.to_datetime(bars['time']) <= corte].sort_values('time')
    if len(passado) < MIN_CONTEXT:
        raise ValueError(f'INSUFFICIENT_CONTEXT: {len(passado)} barras ate {corte.date()}')
    return passado.tail(max_context).reset_index(drop=True)


def future_timestamps(bars: pd.DataFrame, knowledge_time, pred_len: int = 60) -> pd.Series:
    """Carimbos dos `pred_len` pregões seguintes ao corte.

    Usa os pregões REAIS já observados quando existem (o calendário da B3 tem
    feriados que uma frequência sintética erraria) e só completa com dias úteis
    quando o futuro ainda não aconteceu — caso da previsão viva.
    """
    corte = pd.Timestamp(knowledge_time)
    futuros = pd.to_datetime(bars['time'])
    futuros = futuros[futuros > corte].sort_values().head(pred_len).reset_index(drop=True)
    if len(futuros) == pred_len:
        return futuros
    ultimo = futuros.iloc[-1] if len(futuros) else corte
    faltam = pred_len - len(futuros)
    sintéticos = pd.Series(pd.date_range(ultimo, periods=faltam + 1, freq='B')[1:])
    return pd.concat([futuros, sintéticos], ignore_index=True)


def score_cross_section(forecasts: list[dict]) -> pd.DataFrame:
    """Retorno previsto -> percentil transversal -> quintil -> sinal.

    O escore é o percentil CENTRADO em 0 (percentil - 0,5), para ficar com a
    mesma convenção do escore de fator: positivo = acima da mediana das pares.
    """
    colunas = ['ticker', 'predictedReturn', 'score', 'percentile', 'quantile', 'signal']
    if not forecasts:
        return pd.DataFrame(columns=colunas)

    df = pd.DataFrame([{'ticker': f['ticker'], 'predictedReturn': float(f['predictedReturn'])}
                       for f in forecasts])
    percentil = df['predictedReturn'].rank(pct=True)
    escore = percentil - 0.5
    quantil = assign_quantiles(escore, QUANTILES)

    df = df.assign(score=escore, percentile=percentil, quantile=quantil,
                   signal=[classify_signal(q) for q in quantil])
    return df[colunas].reset_index(drop=True)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `python -m pytest python/tests/test_kronos_scorer.py -v`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add python/ml/kronos_scorer.py python/tests/test_kronos_scorer.py
git commit -m "feat(kronos): contexto point-in-time e escore transversal

build_context e o unico lugar que decide quais barras o modelo enxerga: um
off-by-one aqui e vazamento de futuro que nenhum gate detecta, porque o
modelo passaria a acertar por conhecer a resposta.

score_cross_section descarta a ESCALA do retorno previsto de proposito — o
Kronos zero-shot nao foi calibrado para a B3, entao o nivel nao e confiavel,
mas a ordenacao entre empresas pode ser."
```

---

### Task 4: PILOTO DE CUSTO — portão de continuidade

**Esta task decide se o resto do plano acontece.** Roda um único ano de walk-forward e mede o tempo real. Nenhuma task posterior começa antes do número existir.

**Files:**
- Create: `scripts/kronos/pilot-cost.py`
- Create: `docs/architecture/2026-07-28-kronos-piloto-custo.md`

**Interfaces:**
- Consumes: `ml.kronos_adapter.KronosForecaster`, `ml.kronos_scorer.{build_context, future_timestamps, score_cross_section}`, `ml.bars_snapshot.{write_universe_snapshot, load_snapshot_bars}`.
- Produces: apenas o relatório em Markdown. Nenhum código posterior importa esta task.

- [ ] **Step 1: Escrever o script do piloto**

```python
# scripts/kronos/pilot-cost.py
"""Piloto de custo do Kronos — PORTÃO de continuidade do plano.

Mede o tempo real de UM ano de walk-forward antes de qualquer linha de gate,
rota ou UI ser escrita. O risco declarado na spec é que o walk-forward
completo (~140 tickers x ~40 trimestres x 20 amostras) seja impraticável numa
RTX 4060. Este script troca a estimativa por medição.

Uso: python scripts/kronos/pilot-cost.py --ano 2023 --lote 16
"""
import argparse
import json
import os
import sys
import time

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, 'python'))

import pandas as pd  # noqa: E402

from ml.bars_snapshot import SnapshotNotFoundError, load_snapshot_bars, write_universe_snapshot  # noqa: E402
from ml.kronos_adapter import KronosForecaster, derive_seed  # noqa: E402
from ml.kronos_scorer import build_context, future_timestamps, score_cross_section  # noqa: E402


def trimestres_do_ano(ano: int) -> list[tuple[str, pd.Timestamp]]:
    """Carimbos de conhecimento trimestrais — mesmo recorte do motor atual."""
    return [(f'{ano}Q{i + 1}', pd.Timestamp(f'{ano}-{mes:02d}-01'))
            for i, mes in enumerate([3, 6, 9, 12])]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('--ano', type=int, default=2023)
    p.add_argument('--lote', type=int, default=16)
    p.add_argument('--db', default=os.path.join(_ROOT, 'data', 'wr_trade.db'))
    p.add_argument('--universo', default=os.path.join(_ROOT, 'data', 'ml', 'universe.json'))
    args = p.parse_args()

    with open(args.universo, encoding='utf-8') as f:
        simbolos = json.load(f)
    print(f'universo: {len(simbolos)} tickers')

    t0 = time.perf_counter()
    snap = write_universe_snapshot(args.db, simbolos,
                                   os.path.join(_ROOT, 'data', 'ml', 'bars_snapshot'))
    t_snapshot = time.perf_counter() - t0
    print(f'snapshot: {t_snapshot:.1f}s  digest={snap["universeBarsDigest"][:12]}')

    t0 = time.perf_counter()
    forecaster = KronosForecaster(os.path.join(_ROOT, 'data', 'models', 'kronos'))
    t_carga = time.perf_counter() - t0
    print(f'carga do modelo: {t_carga:.1f}s  device={forecaster._device}')

    tempos, ignorados = [], 0
    for periodo, carimbo in trimestres_do_ano(args.ano):
        pedidos = []
        for ticker in sorted(snap['perSymbol']):
            try:
                bars = load_snapshot_bars(snap['snapshotDir'], ticker)
                ctx = build_context(bars, carimbo)
            except (SnapshotNotFoundError, ValueError):
                ignorados += 1
                continue
            pedidos.append({'ticker': ticker, 'period': periodo, 'bars': ctx,
                            'yTimestamps': future_timestamps(bars, carimbo),
                            'seed': derive_seed('piloto', ticker, periodo)})

        t0 = time.perf_counter()
        previsoes = []
        for i in range(0, len(pedidos), args.lote):
            previsoes.extend(forecaster.forecast_batch(pedidos[i:i + args.lote]))
        decorrido = time.perf_counter() - t0
        tempos.append(decorrido)

        ranking = score_cross_section(previsoes)
        print(f'{periodo}: {len(pedidos)} tickers em {decorrido:.1f}s '
              f'({decorrido / max(len(pedidos), 1):.2f}s/ticker) · '
              f'{int((ranking["signal"] != "NEUTRO").sum())} nos quintis extremos')

    por_trimestre = sum(tempos) / len(tempos)
    print(f'\nMEDIA POR TRIMESTRE: {por_trimestre:.1f}s')
    print(f'PROJECAO 40 TRIMESTRES: {por_trimestre * 40 / 60:.1f} min')
    print(f'contextos ignorados por historico curto: {ignorados}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
```

- [ ] **Step 2: Rodar o piloto**

Run: `python scripts/kronos/pilot-cost.py --ano 2023 --lote 16`
Expected: imprime tempo por trimestre e a projeção para 40 trimestres.

Se o caminho do banco ou do arquivo de universo divergir do ambiente, ajuste `--db`/`--universo` — não altere o script para adivinhar caminho.

- [ ] **Step 3: Experimentar dois tamanhos de lote**

Run: `python scripts/kronos/pilot-cost.py --ano 2023 --lote 8` e depois `--lote 32`
Anote os três tempos. Se `--lote 32` estourar a memória da GPU (8 GB), registre o erro — isso é resultado, não falha.

- [ ] **Step 4: Escrever o relatório**

Crie `docs/architecture/2026-07-28-kronos-piloto-custo.md` com, obrigatoriamente:

- device e tamanho do universo efetivo;
- tempo de snapshot, de carga do modelo e por trimestre, para os três lotes;
- projeção para o walk-forward completo (40 trimestres);
- quantos contextos foram ignorados por histórico curto;
- **veredito explícito:** `SEGUIR` (projeção ≤ 60 min), `SEGUIR COM CORTE` (60–180 min — proponha o corte: menos anos, menos tickers ou `sample_count` menor) ou `PARAR` (> 180 min).

- [ ] **Step 5: Commit**

```bash
git add scripts/kronos/pilot-cost.py docs/architecture/2026-07-28-kronos-piloto-custo.md
git commit -m "feat(kronos): piloto de custo — portao de continuidade

O risco declarado na spec e que o walk-forward completo seja impraticavel
numa 4060. Este piloto troca a estimativa por medicao antes de qualquer
linha de gate, rota ou UI ser escrita."
```

- [ ] **Step 6: PARAR e apresentar o veredito ao usuário**

Não inicie a Task 5 sem decisão explícita do usuário sobre o veredito.

---

### Task 5: Walk-forward completo e métricas do gate

Produz o DataFrame `wf` no formato que `evaluate_walk_forward()` já consome — é o encaixe que dá comparabilidade entre os dois motores.

**Files:**
- Create: `python/ml/kronos_walkforward.py`
- Test: `python/tests/test_kronos_walkforward.py`

**Interfaces:**
- Consumes: `ml.kronos_scorer.score_cross_section`; `ml.directional_classifier.{evaluate_walk_forward, HORIZON_TRADING_DAYS}`.
- Produces:
  - `ml.kronos_walkforward.realized_excess(bars_for, ticker: str, knowledge_time, horizon: int) -> float | None`
  - `ml.kronos_walkforward.build_wf_frame(rankings: list[dict]) -> pd.DataFrame` com as colunas exatas `['ticker', 'ano', 'trimestre', 'testYear', 'foldId', 'score', 'quantile', 'retExcess']`
  - `ml.kronos_walkforward.run_kronos_walkforward(forecaster, bars_for, symbols: list[str], periods: list[tuple[str, pd.Timestamp]], model_version: str, batch_size: int = 16, progress=None) -> dict` devolvendo `{'metrics': dict, 'wf': pd.DataFrame, 'universe': list[str]}`

- [ ] **Step 1: Escrever o teste que falha**

```python
# python/tests/test_kronos_walkforward.py
import os, sys
import numpy as np
import pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.kronos_walkforward import build_wf_frame, realized_excess


def barras(n=800, seed=5, deriva=0.0):
    rng = np.random.default_rng(seed)
    close = 100 * np.cumprod(1 + rng.normal(deriva, 0.01, n))
    return pd.DataFrame({'time': pd.date_range('2019-01-01', periods=n, freq='B'),
                         'open': close, 'high': close * 1.01, 'low': close * 0.99,
                         'close': close, 'volume': 1000.0})


def test_excesso_realizado_usa_exatamente_60_pregoes_apos_o_carimbo():
    b = barras()
    corte = b['time'].iloc[300]
    esperado = float(b['close'].iloc[360] / b['close'].iloc[300] - 1)
    assert realized_excess(lambda t: b, 'X', corte, 60) == pytest_approx(esperado)


def pytest_approx(v, tol=1e-9):
    class _A:
        def __eq__(self, outro): return abs(outro - v) < tol
    return _A()


def test_excesso_e_none_quando_o_futuro_ainda_nao_aconteceu():
    b = barras(n=310)
    corte = b['time'].iloc[300]     # só existem 9 pregões depois
    assert realized_excess(lambda t: b, 'X', corte, 60) is None


def test_wf_frame_tem_exatamente_as_colunas_que_evaluate_walk_forward_consome():
    rankings = [{
        'period': '2023Q1', 'ano': 2023, 'trimestre': 1, 'testYear': 2023, 'foldId': 0,
        'rows': [{'ticker': 'AAA3', 'score': 0.4, 'quantile': 5, 'retExcess': 0.08},
                 {'ticker': 'BBB3', 'score': -0.4, 'quantile': 1, 'retExcess': -0.05}],
    }]
    wf = build_wf_frame(rankings)
    assert list(wf.columns) == ['ticker', 'ano', 'trimestre', 'testYear',
                                'foldId', 'score', 'quantile', 'retExcess']
    assert len(wf) == 2


def test_wf_frame_alimenta_evaluate_walk_forward_sem_adaptacao():
    """Prova do encaixe: as métricas do motor atual aceitam o wf do Kronos."""
    from ml.directional_classifier import evaluate_walk_forward
    linhas = []
    rng = np.random.default_rng(1)
    for ano in range(2019, 2025):
        for tri in range(1, 5):
            for i in range(30):
                escore = rng.uniform(-0.5, 0.5)
                linhas.append({'ticker': f'T{i:02d}3', 'ano': ano, 'trimestre': tri,
                               'testYear': ano, 'foldId': ano - 2019, 'score': escore,
                               'quantile': min(5, max(1, int((escore + 0.5) * 5) + 1)),
                               'retExcess': escore * 0.1 + rng.normal(0, 0.02)})
    metricas = evaluate_walk_forward(pd.DataFrame(linhas))
    assert metricas['ic'] is not None and metricas['icTStat'] is not None
    assert metricas['topBottomSpread'] is not None
    assert len(metricas['quantileExcess']) == 5
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python -m pytest python/tests/test_kronos_walkforward.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'ml.kronos_walkforward'`

- [ ] **Step 3: Implementar `ml/kronos_walkforward.py`**

```python
"""Walk-forward do Kronos, emitindo o MESMO `wf` do motor de fator.

Este módulo existe para uma coisa só: fazer a saída do Kronos entrar em
`evaluate_walk_forward` sem adaptação. É o que dá comparabilidade número a
número entre os dois motores — sem isso, cada motor teria régua própria e a
pergunta que motivou a integração ficaria sem resposta.

O excesso de retorno é medido contra a MÉDIA da seção transversal do mesmo
trimestre, exatamente como no motor de fator: um fator que só acompanha o
mercado não é fator, e comparar com zero premiaria beta.
"""
import numpy as np
import pandas as pd

from .directional_classifier import HORIZON_TRADING_DAYS
from .kronos_adapter import derive_seed
from .kronos_scorer import build_context, future_timestamps, score_cross_section

_WF_COLUMNS = ['ticker', 'ano', 'trimestre', 'testYear', 'foldId', 'score', 'quantile', 'retExcess']


def realized_excess(bars_for, ticker: str, knowledge_time, horizon: int = HORIZON_TRADING_DAYS):
    """Retorno REALIZADO nos `horizon` pregões após o carimbo.

    `None` quando o futuro ainda não aconteceu — nunca 0.0, que o gate leria
    como "não rendeu" em vez de "não dá para saber".
    """
    bars = bars_for(ticker)
    if bars is None or bars.empty:
        return None
    b = bars.assign(time=pd.to_datetime(bars['time'])).sort_values('time')
    ate = b[b['time'] <= pd.Timestamp(knowledge_time)]
    depois = b[b['time'] > pd.Timestamp(knowledge_time)]
    if ate.empty or len(depois) < horizon:
        return None
    entrada = float(ate['close'].iloc[-1])
    saida = float(depois['close'].iloc[horizon - 1])
    return (saida / entrada) - 1.0 if entrada > 0 else None


def build_wf_frame(rankings: list[dict]) -> pd.DataFrame:
    """Achata os rankings por período no formato de `evaluate_walk_forward`."""
    linhas = []
    for r in rankings:
        for linha in r['rows']:
            linhas.append({'ticker': linha['ticker'], 'ano': r['ano'],
                           'trimestre': r['trimestre'], 'testYear': r['testYear'],
                           'foldId': r['foldId'], 'score': linha['score'],
                           'quantile': linha['quantile'], 'retExcess': linha['retExcess']})
    if not linhas:
        return pd.DataFrame(columns=_WF_COLUMNS)
    return pd.DataFrame(linhas)[_WF_COLUMNS]


def run_kronos_walkforward(forecaster, bars_for, symbols: list[str],
                           periods: list[tuple], model_version: str,
                           batch_size: int = 16, progress=None) -> dict:
    """Roda o walk-forward completo e devolve métricas + wf + universo validado.

    O universo devolvido contém APENAS os tickers que produziram ao menos uma
    linha com excesso medido. É ele que restringe a previsão viva depois —
    mesma correção do commit e604724: empresa sem série de preços mensurável
    não pode disputar quintil com quem tem.
    """
    from .directional_classifier import evaluate_walk_forward

    rankings, validados = [], set()
    for indice, (periodo, carimbo) in enumerate(periods):
        pedidos = []
        for ticker in sorted(symbols):
            try:
                bars = bars_for(ticker)
                if bars is None:
                    continue
                contexto = build_context(bars, carimbo)
            except ValueError:
                continue  # INSUFFICIENT_CONTEXT: sem histórico, sem previsão
            pedidos.append({'ticker': ticker, 'period': periodo, 'bars': contexto,
                            'yTimestamps': future_timestamps(bars, carimbo),
                            'seed': derive_seed(model_version, ticker, periodo)})

        previsoes = []
        for i in range(0, len(pedidos), batch_size):
            previsoes.extend(forecaster.forecast_batch(pedidos[i:i + batch_size]))
        if not previsoes:
            continue

        ranking = score_cross_section(previsoes)
        brutos = {p['ticker']: realized_excess(bars_for, p['ticker'], carimbo)
                  for p in previsoes}
        medidos = [v for v in brutos.values() if v is not None]
        if not medidos:
            continue
        media = float(np.mean(medidos))  # excesso contra as pares, nunca contra zero

        linhas = []
        for _, r in ranking.iterrows():
            bruto = brutos.get(r['ticker'])
            if bruto is None:
                continue
            validados.add(r['ticker'])
            linhas.append({'ticker': r['ticker'], 'score': float(r['score']),
                           'quantile': int(r['quantile']), 'retExcess': bruto - media})

        ano = int(periodo[:4])
        rankings.append({'period': periodo, 'ano': ano, 'trimestre': int(periodo[-1]),
                         'testYear': ano, 'foldId': indice // 4, 'rows': linhas})

        if progress is not None:
            progress(int(100 * (indice + 1) / max(len(periods), 1)))

    wf = build_wf_frame(rankings)
    return {'metrics': evaluate_walk_forward(wf) if len(wf) else {},
            'wf': wf, 'universe': sorted(validados)}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `python -m pytest python/tests/test_kronos_walkforward.py -v`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add python/ml/kronos_walkforward.py python/tests/test_kronos_walkforward.py
git commit -m "feat(kronos): walk-forward emitindo o wf do motor de fator

O encaixe e o ponto: o wf do Kronos entra em evaluate_walk_forward sem
adaptacao, entao os dois motores ficam comparaveis numero a numero. Excesso
medido contra a media da secao transversal, nunca contra zero — comparar com
zero premiaria beta."
```

---

### Task 6: Modelos Prisma e coluna `engine`

**Files:**
- Modify: `prisma/schema.prisma` (acrescenta 2 modelos; acrescenta 1 coluna em `MlTrainingRun`)
- Create: `prisma/migrations/<timestamp>_kronos/migration.sql` (gerada)
- Test: `python/tests/test_kronos_schema.py`

**Interfaces:**
- Consumes: nada.
- Produces: tabelas `KronosModelVersion` e `KronosPrediction`; coluna `MlTrainingRun.engine`.

- [ ] **Step 1: Acrescentar `engine` a `MlTrainingRun`**

Em `prisma/schema.prisma`, dentro de `model MlTrainingRun`, logo após a linha `costProfileVersion Int`:

```prisma
  /// DIRECTIONAL | KRONOS — qual motor este treino executou. Default no valor
  /// antigo para que toda linha já existente continue significando o que
  /// significava: uma migração que reinterpreta o passado é corrupção.
  engine             String    @default("DIRECTIONAL")
```

- [ ] **Step 2: Acrescentar os dois modelos ao final do schema**

```prisma
// ---------------------------------------------------------------------------
// Kronos — segundo motor de previsão (foundation model de candles, zero-shot).
// Espelha os modelos Directional*: mesmos estados, mesmo claim CAS atômico
// contra o MlTrainingRun. Tabelas próprias e não um discriminador nas
// existentes: aditivo, sem migração de dados, e segue o precedente do Item D.
// Spec: docs/superpowers/specs/2026-07-28-kronos-integration-design.md
// ---------------------------------------------------------------------------
model KronosModelVersion {
  id            String   @id @default(cuid())
  modelVersion  String   @unique
  createdAt     DateTime @default(now())
  researchRunId String
  /// sha256 dos pesos zero-shot que produziram esta versão. É o que garante
  /// que dois treinos com "o mesmo Kronos" sejam de fato o mesmo Kronos.
  weightsSha256 String
  /// JSON: {predLen, sampleCount, T, topP, topK} — congelado na versão.
  samplingJson  String
  /// JSON: mesmas métricas de fator do motor direcional (IC, t-stat, quantis…).
  metrics       String
  artifactPath  String
  /// DRAFT | ACTIVE | FAILED | SUPERSEDED — mesma semântica do Directional.
  status        String   @default("ACTIVE")
  gateFailures  String?

  researchRun ResearchRun @relation(fields: [researchRunId], references: [runId])

  @@index([status, createdAt])
  @@index([researchRunId])
}

model KronosPrediction {
  id             String   @id @default(cuid())
  modelVersion   String
  ticker         String
  signal         String // COMPRA | VENDA | NEUTRO
  /// Distância da mediana da seção, |2·percentil−1|. NÃO é probabilidade.
  confidence     Float
  /// Percentil transversal do retorno previsto no período (0-1).
  percentile     Float
  /// Escore centrado em 0 (percentil − 0,5).
  score          Float
  /// Quintil no período: 1 = pior, 5 = melhor. É daqui que sai o sinal.
  quantile       Int
  /// Retorno mediano previsto em 60 pregões. Guardado para inspeção: a ESCALA
  /// não participa do sinal, só a ordenação participa.
  predictedReturn Float
  /// JSON: {p10, p50, p90} — a banda NÃO participa do gate nesta versão.
  predictionBandJson String
  /// Quantas barras entraram no contexto (< 512 é possível e legítimo).
  contextBars    Int
  /// Carimbo de conhecimento do período que gerou o sinal.
  knowledgeDate  DateTime
  universeDigest String
  generatedAt    DateTime @default(now())

  @@unique([modelVersion, ticker, generatedAt])
  @@index([modelVersion, generatedAt])
}
```

- [ ] **Step 3: Acrescentar a relação inversa em `ResearchRun`**

Localize `model ResearchRun` (linha ~820) e acrescente entre as relações existentes:

```prisma
  kronosModelVersions KronosModelVersion[]
```

- [ ] **Step 4: Gerar a migração**

```bash
npx prisma migrate dev --name kronos
npx prisma generate
```

- [ ] **Step 5: Escrever o teste que verifica a migração**

```python
# python/tests/test_kronos_schema.py
"""A migração não pode reinterpretar o passado.

Toda linha de MlTrainingRun anterior à coluna `engine` significa um treino do
motor direcional. Se o default fosse KRONOS (ou NULL), o histórico inteiro
passaria a mentir sobre o que rodou.
"""
import os, sqlite3, subprocess, sys, tempfile


def test_engine_tem_default_directional_e_as_tabelas_kronos_existem():
    tmp = tempfile.mkdtemp()
    db = os.path.join(tmp, 'test.db')
    env = {**os.environ, 'DATABASE_URL': f'file:{db}'.replace('\\', '/')}
    subprocess.run([sys.executable if False else 'npx', 'prisma', 'migrate', 'deploy'],
                   env=env, check=True, shell=True)

    con = sqlite3.connect(db)
    tabelas = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert 'KronosModelVersion' in tabelas and 'KronosPrediction' in tabelas

    colunas = {r[1]: r[4] for r in con.execute('PRAGMA table_info(MlTrainingRun)')}
    assert 'engine' in colunas
    assert colunas['engine'] == "'DIRECTIONAL'"
    con.close()
```

- [ ] **Step 6: Rodar e ver passar**

Run: `python -m pytest python/tests/test_kronos_schema.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations python/tests/test_kronos_schema.py
git commit -m "feat(kronos): modelos Prisma e coluna engine em MlTrainingRun

Tabelas proprias em vez de discriminador nas existentes: aditivo, sem
migracao de dados, seguindo o precedente do Item D. O default DIRECTIONAL em
engine existe para que toda linha ja gravada continue significando o que
significava — migracao que reinterpreta o passado e corrupcao."
```

---

### Task 7: Domínio e aplicação (gate importado, nunca copiado)

**Files:**
- Create: `src/domain/v1/models/ml-kronos.ts`
- Create: `src/domain/v1/ports/ml-kronos-repository.ts`
- Create: `src/application/ml-kronos/dto.ts`, `src/application/ml-kronos/service.ts`, `src/application/ml-kronos/index.ts`
- Create: `scripts/kronos/kronos-test.ts`, `scripts/kronos/run-kronos-tests.cjs`, `scripts/kronos/run-tests.cmd`, `scripts/kronos/tsconfig.json`
- Modify: `package.json` (script `test:kronos`)

**Interfaces:**
- Consumes: `evaluateDirectionalGate`, `DIRECTIONAL_GATE_THRESHOLDS` de `src/application/ml-directional/gate.ts`; `DirectionalMetrics`, `DirectionalGateFailureCode` de `src/domain/v1/models/ml-directional.ts`.
- Produces:
  - `KronosSignal = 'COMPRA' | 'VENDA' | 'NEUTRO'`, `KronosModelStatus`, `KronosSampling`, `KronosModelVersion`, `KronosPrediction`, `KronosModelVersionSubmission`, `KronosPredictionSubmission` (domínio)
  - `KronosRepository` (porta) com `listModels(filter)`, `getModel(modelVersion)`, `saveModel(submission)`, `listPredictions(modelVersion)`, `savePredictions(submissions)`
  - `toKronosModelDTO(model)`, `toKronosPredictionDTO(prediction)` (dto.ts)
  - `createKronosService(deps)` com `listModels`, `getModel`, `listPredictions`, `generatePredictions`

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// scripts/kronos/kronos-test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateDirectionalGate } from '../../src/application/ml-directional/gate';
import { toKronosModelDTO } from '../../src/application/ml-kronos/dto';
import type { KronosModelVersion } from '../../src/domain/v1/models/ml-kronos';

const modeloAprovado: KronosModelVersion = {
  id: 'k1',
  modelVersion: 'a'.repeat(64),
  createdAt: '2026-07-28T12:00:00.000Z',
  researchRunId: 'run-1',
  weightsSha256: 'b'.repeat(64),
  sampling: { predLen: 60, sampleCount: 20, T: 1.0, topP: 0.9, topK: 0 },
  metrics: {
    nSamples: 4200, nPeriods: 40, byFold: [],
    ic: 0.031, icTStat: 2.4, icPeriods: 40,
    topBottomSpread: 0.018, netTopBottomSpread: 0.014,
    positiveYearsRatio: 0.7,
    quantileExcess: [{ quantile: 5, n: 800, meanExcess: 0.009, hitRate: 0.55 }],
    netQuantileExcess: [{ quantile: 5, n: 800, meanExcess: 0.007, hitRate: 0.55 }],
  },
  artifactPath: 'data/models/kronos-runs/a.json',
  status: 'ACTIVE',
  gateFailures: [],
};

test('o DTO publico nunca vaza artifactPath', () => {
  const dto = toKronosModelDTO(modeloAprovado) as Record<string, unknown>;
  assert.equal('artifactPath' in dto, false);
  assert.equal(dto.modelVersion, modeloAprovado.modelVersion);
  assert.equal(dto.gateApproved, true);
});

test('o gate do Kronos e LITERALMENTE o gate direcional', () => {
  const resultado = evaluateDirectionalGate(modeloAprovado.metrics);
  assert.equal(resultado.approved, true);
  assert.equal(resultado.checks.length, 5);
});

test('IC abaixo do piso reprova o Kronos pelo mesmo codigo do outro motor', () => {
  const resultado = evaluateDirectionalGate({ ...modeloAprovado.metrics, ic: 0.001 });
  assert.equal(resultado.approved, false);
  assert.ok(resultado.failures.includes('IC_BELOW_MIN'));
});

test('o DTO expoe a amostragem congelada, que e o que identifica a versao', () => {
  const dto = toKronosModelDTO(modeloAprovado) as Record<string, unknown>;
  assert.deepEqual(dto.sampling, { predLen: 60, sampleCount: 20, T: 1, topP: 0.9, topK: 0 });
});
```

- [ ] **Step 2: Criar a infraestrutura de teste copiando a do direcional**

```bash
cp scripts/directional/run-directional-tests.cjs scripts/kronos/run-kronos-tests.cjs
cp scripts/directional/run-tests.cmd scripts/kronos/run-tests.cmd
cp scripts/directional/tsconfig.json scripts/kronos/tsconfig.json
```

Em `run-kronos-tests.cjs`, troque `wr-directional-test-` por `wr-kronos-test-` e `scripts\\directional\\run-tests.cmd` por `scripts\\kronos\\run-tests.cmd`. Em `run-tests.cmd` e `tsconfig.json`, troque as referências de `directional-test.ts` por `kronos-test.ts` e o `outDir` de `scripts/directional/.dist` para `scripts/kronos/.dist`.

Acrescente a `package.json`, ao final da seção `scripts`:

```json
    "test:kronos": "node scripts/kronos/run-kronos-tests.cjs"
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run test:kronos`
Expected: FAIL na compilação — `Cannot find module '../../src/application/ml-kronos/dto'`

- [ ] **Step 4: Implementar o domínio**

```typescript
// src/domain/v1/models/ml-kronos.ts
/**
 * Kronos — segundo motor de previsão (foundation model de candles, zero-shot).
 * Spec: `docs/superpowers/specs/2026-07-28-kronos-integration-design.md`.
 *
 * Modelo de domínio puro: nada de Prisma, Flask ou HTTP.
 *
 * As MÉTRICAS são reaproveitadas do motor direcional de propósito
 * (`DirectionalMetrics`). Não é preguiça: a spec decidiu que os dois motores
 * passam pela MESMA régua, e tipos separados com os mesmos campos seriam o
 * primeiro passo para eles divergirem em silêncio.
 */
import type {
  DirectionalGateFailureCode,
  DirectionalMetrics,
} from './ml-directional';

export type KronosSignal = 'COMPRA' | 'VENDA' | 'NEUTRO';

/** Mesma semântica dos estados do motor direcional — inclusive o claim CAS. */
export type KronosModelStatus = 'DRAFT' | 'ACTIVE' | 'FAILED' | 'SUPERSEDED';

export type KronosGateFailureCode = DirectionalGateFailureCode;
export type KronosMetrics = DirectionalMetrics;

/**
 * Parâmetros de amostragem CONGELADOS na versão. Mudar qualquer um é mudar o
 * modelo — por isso viajam junto da versão e não são configuráveis por
 * requisição.
 */
export interface KronosSampling {
  readonly predLen: number;
  readonly sampleCount: number;
  readonly T: number;
  readonly topP: number;
  readonly topK: number;
}

export interface KronosPredictionBand {
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
}

export interface KronosModelVersion {
  readonly id: string;
  /** Identidade canônica (64 hex) computada no servidor — nunca aceita do cliente. */
  readonly modelVersion: string;
  readonly createdAt: string;
  readonly researchRunId: string;
  /** sha256 dos pesos zero-shot que produziram esta versão. */
  readonly weightsSha256: string;
  readonly sampling: KronosSampling;
  readonly metrics: KronosMetrics;
  readonly artifactPath: string;
  readonly status: KronosModelStatus;
  readonly gateFailures: readonly KronosGateFailureCode[];
}

export interface KronosModelVersionSubmission {
  readonly modelVersion: string;
  readonly researchRunId: string;
  readonly weightsSha256: string;
  readonly sampling: KronosSampling;
  readonly metrics: KronosMetrics;
  readonly artifactPath: string;
  readonly status: KronosModelStatus;
  readonly gateFailures: readonly KronosGateFailureCode[];
}

export interface KronosPrediction {
  readonly id: string;
  readonly modelVersion: string;
  readonly ticker: string;
  readonly signal: KronosSignal;
  /** Distância da mediana da seção, |2·percentil−1|. NÃO é probabilidade. */
  readonly confidence: number;
  readonly percentile: number;
  readonly score: number;
  readonly quantile: number;
  /** Retorno mediano previsto em 60 pregões — a escala não gera sinal. */
  readonly predictedReturn: number;
  readonly band: KronosPredictionBand;
  readonly contextBars: number;
  readonly knowledgeDate: string;
  readonly universeDigest: string;
  readonly generatedAt: string;
}

export interface KronosPredictionSubmission {
  readonly modelVersion: string;
  readonly ticker: string;
  readonly signal: KronosSignal;
  readonly confidence: number;
  readonly percentile: number;
  readonly score: number;
  readonly quantile: number;
  readonly predictedReturn: number;
  readonly band: KronosPredictionBand;
  readonly contextBars: number;
  readonly knowledgeDate: string;
  readonly universeDigest: string;
  readonly generatedAt: string;
}
```

- [ ] **Step 5: Implementar a porta do repositório**

```typescript
// src/domain/v1/ports/ml-kronos-repository.ts
import type {
  KronosModelStatus,
  KronosModelVersion,
  KronosModelVersionSubmission,
  KronosPrediction,
  KronosPredictionSubmission,
} from '../models/ml-kronos';

export interface KronosModelFilter {
  readonly status?: KronosModelStatus;
  readonly limit?: number;
}

export interface KronosRepository {
  listModels(filter: KronosModelFilter): Promise<readonly KronosModelVersion[]>;
  getModel(modelVersion: string): Promise<KronosModelVersion | null>;
  saveModel(submission: KronosModelVersionSubmission): Promise<KronosModelVersion>;
  listPredictions(modelVersion: string): Promise<readonly KronosPrediction[]>;
  savePredictions(
    submissions: readonly KronosPredictionSubmission[],
  ): Promise<readonly KronosPrediction[]>;
}
```

- [ ] **Step 6: Implementar os DTOs**

```typescript
// src/application/ml-kronos/dto.ts
/**
 * DTOs públicos do Kronos.
 *
 * `artifactPath` NUNCA sai daqui: é caminho de filesystem do servidor, e
 * expô-lo transformaria a API pública num mapa do disco. `weightsSha256` sai,
 * porque é identidade auditável e não localização.
 */
import { evaluateDirectionalGate } from '../ml-directional/gate';
import type { KronosModelVersion, KronosPrediction } from '../../domain/v1/models/ml-kronos';

export function toKronosModelDTO(model: KronosModelVersion) {
  const gate = evaluateDirectionalGate(model.metrics);
  return {
    modelVersion: model.modelVersion,
    createdAt: model.createdAt,
    researchRunId: model.researchRunId,
    weightsSha256: model.weightsSha256,
    sampling: model.sampling,
    status: model.status,
    gateApproved: model.status === 'ACTIVE' && gate.approved,
    gateFailures: model.gateFailures,
    gateChecks: gate.checks,
    metrics: model.metrics,
  };
}

export function toKronosPredictionDTO(prediction: KronosPrediction) {
  return {
    ticker: prediction.ticker,
    signal: prediction.signal,
    confidence: prediction.confidence,
    percentile: prediction.percentile,
    score: prediction.score,
    quantile: prediction.quantile,
    predictedReturn: prediction.predictedReturn,
    band: prediction.band,
    contextBars: prediction.contextBars,
    knowledgeDate: prediction.knowledgeDate,
    modelVersion: prediction.modelVersion,
    universeDigest: prediction.universeDigest,
    generatedAt: prediction.generatedAt,
  };
}
```

- [ ] **Step 7: Implementar o serviço**

```typescript
// src/application/ml-kronos/service.ts
/**
 * Serviço de aplicação do Kronos.
 *
 * Invariante central: modelo que não esteja ACTIVE **e** aprovado no gate
 * nunca produz nem devolve sinal. Reprovado fica persistido para auditoria e
 * invisível na superfície pública — a mesma regra do motor direcional.
 */
import { evaluateDirectionalGate } from '../ml-directional/gate';
import type { KronosRepository } from '../../domain/v1/ports/ml-kronos-repository';
import type { KronosModelVersion, KronosPrediction } from '../../domain/v1/models/ml-kronos';

export interface KronosServiceDeps {
  readonly repository: KronosRepository;
}

export class KronosModelNotServableError extends Error {
  readonly code = 'MODEL_NOT_SERVABLE';
  constructor(modelVersion: string) {
    super(`versao ${modelVersion} nao esta ativa nem aprovada no gate`);
  }
}

export function createKronosService({ repository }: KronosServiceDeps) {
  const assertServable = (model: KronosModelVersion | null): KronosModelVersion => {
    if (!model || model.status !== 'ACTIVE' || !evaluateDirectionalGate(model.metrics).approved) {
      throw new KronosModelNotServableError(model?.modelVersion ?? 'desconhecida');
    }
    return model;
  };

  return {
    listModels: (filter: { status?: KronosModelVersion['status']; limit?: number }) =>
      repository.listModels(filter),

    getModel: (modelVersion: string) => repository.getModel(modelVersion),

    async listPredictions(modelVersion: string): Promise<readonly KronosPrediction[]> {
      assertServable(await repository.getModel(modelVersion));
      return repository.listPredictions(modelVersion);
    },
  };
}
```

- [ ] **Step 8: Implementar o barril**

```typescript
// src/application/ml-kronos/index.ts
export { toKronosModelDTO, toKronosPredictionDTO } from './dto';
export { createKronosService, KronosModelNotServableError } from './service';
export type { KronosServiceDeps } from './service';
```

- [ ] **Step 9: Rodar e ver passar**

Run: `npm run test:kronos`
Expected: PASS (4 testes)

- [ ] **Step 10: Commit**

```bash
git add src/domain/v1/models/ml-kronos.ts src/domain/v1/ports/ml-kronos-repository.ts src/application/ml-kronos scripts/kronos package.json
git commit -m "feat(kronos): dominio e aplicacao com o gate IMPORTADO

O gate nao e copiado: evaluateDirectionalGate e importado de ml-directional.
Se um limiar mudar, muda para os dois motores ao mesmo tempo — que e
exatamente o comportamento desejado quando a premissa e comparabilidade.

As metricas tambem reusam DirectionalMetrics: tipos separados com os mesmos
campos seriam o primeiro passo para os dois motores divergirem em silencio."
```

---

### Task 8: Adaptador Prisma

**Files:**
- Create: `src/adapters/prisma/ml-kronos/schemas.ts`, `mapping.ts`, `repository.ts`, `errors.ts`, `index.ts`
- Modify: `scripts/kronos/kronos-test.ts` (acrescenta testes de round-trip)

**Interfaces:**
- Consumes: `KronosRepository` de `src/domain/v1/ports/ml-kronos-repository`; tipos de `src/domain/v1/models/ml-kronos`.
- Produces: `createPrismaKronosRepository(prisma: PrismaClient): KronosRepository`.

- [ ] **Step 1: Acrescentar o teste que falha**

Acrescente ao final de `scripts/kronos/kronos-test.ts`:

```typescript
import { PrismaClient } from '@prisma/client';
import { createPrismaKronosRepository } from '../../src/adapters/prisma/ml-kronos';

test('round-trip do modelo preserva metricas e amostragem', async () => {
  const prisma = new PrismaClient();
  const repo = createPrismaKronosRepository(prisma);
  await prisma.researchRun.create({
    data: { runId: 'run-kronos-1', status: 'SUCCEEDED', kind: 'KRONOS_TRAINING' },
  });

  const salvo = await repo.saveModel({
    modelVersion: 'c'.repeat(64),
    researchRunId: 'run-kronos-1',
    weightsSha256: 'd'.repeat(64),
    sampling: { predLen: 60, sampleCount: 20, T: 1, topP: 0.9, topK: 0 },
    metrics: { nSamples: 10, nPeriods: 4, byFold: [], ic: 0.03, icTStat: 2.1 },
    artifactPath: 'data/models/kronos-runs/c.json',
    status: 'ACTIVE',
    gateFailures: [],
  });

  assert.equal(salvo.sampling.sampleCount, 20);
  const lido = await repo.getModel('c'.repeat(64));
  assert.equal(lido?.metrics.ic, 0.03);
  assert.deepEqual(lido?.sampling, { predLen: 60, sampleCount: 20, T: 1, topP: 0.9, topK: 0 });
  await prisma.$disconnect();
});

test('previsao rejeita percentil fora de [0,1] em vez de persistir lixo', async () => {
  const prisma = new PrismaClient();
  const repo = createPrismaKronosRepository(prisma);
  await assert.rejects(() => repo.savePredictions([{
    modelVersion: 'c'.repeat(64), ticker: 'PETR4', signal: 'COMPRA',
    confidence: 0.8, percentile: 1.7, score: 0.4, quantile: 5,
    predictedReturn: 0.05, band: { p10: -0.01, p50: 0.05, p90: 0.12 },
    contextBars: 512, knowledgeDate: '2026-06-30T00:00:00.000Z',
    universeDigest: 'e'.repeat(64), generatedAt: '2026-07-28T12:00:00.000Z',
  }]));
  await prisma.$disconnect();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:kronos`
Expected: FAIL — `Cannot find module '../../src/adapters/prisma/ml-kronos'`

- [ ] **Step 3: Implementar os schemas Zod**

```typescript
// src/adapters/prisma/ml-kronos/schemas.ts
/**
 * Fronteira de validação entre o banco e o domínio.
 *
 * Valida na LEITURA também, não só na escrita: linha gravada por uma versão
 * anterior do código pode ter shape antigo, e um JSON malformado precisa
 * virar erro explícito em vez de vazar `undefined` para dentro do gate.
 */
import { z } from 'zod';

export const kronosSamplingSchema = z.object({
  predLen: z.number().int().positive(),
  sampleCount: z.number().int().positive(),
  T: z.number().positive(),
  topP: z.number().min(0).max(1),
  topK: z.number().int().min(0),
});

export const kronosBandSchema = z.object({
  p10: z.number().finite(),
  p50: z.number().finite(),
  p90: z.number().finite(),
});

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'esperado sha256 em 64 hex minusculos');

export const kronosModelSubmissionSchema = z.object({
  modelVersion: sha256,
  researchRunId: z.string().min(1),
  weightsSha256: sha256,
  sampling: kronosSamplingSchema,
  metrics: z.record(z.unknown()),
  artifactPath: z.string().min(1),
  status: z.enum(['DRAFT', 'ACTIVE', 'FAILED', 'SUPERSEDED']),
  gateFailures: z.array(z.string()),
});

export const kronosPredictionSubmissionSchema = z.object({
  modelVersion: sha256,
  ticker: z.string().regex(/^[A-Z0-9]{4}\d{1,2}$/, 'ticker B3 invalido'),
  signal: z.enum(['COMPRA', 'VENDA', 'NEUTRO']),
  confidence: z.number().min(0).max(1),
  percentile: z.number().min(0).max(1),
  score: z.number().finite(),
  quantile: z.number().int().min(1).max(5),
  predictedReturn: z.number().finite(),
  band: kronosBandSchema,
  contextBars: z.number().int().positive(),
  knowledgeDate: z.string().datetime(),
  universeDigest: sha256,
  generatedAt: z.string().datetime(),
});
```

O regex de ticker é `[A-Z0-9]{4}\d{1,2}` — a forma corrigida em `542b6f4`, que aceita `B3SA3`. Nunca use `[A-Z]{4}`.

- [ ] **Step 4: Implementar erros e mapeamento**

```typescript
// src/adapters/prisma/ml-kronos/errors.ts
export class KronosPersistenceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
```

```typescript
// src/adapters/prisma/ml-kronos/mapping.ts
import type { KronosModelVersion, KronosPrediction } from '../../../domain/v1/models/ml-kronos';
import { KronosPersistenceError } from './errors';
import { kronosBandSchema, kronosSamplingSchema } from './schemas';

function parseJson(value: string, campo: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new KronosPersistenceError('CORRUPT_ROW', `${campo} nao e JSON valido`);
  }
}

export function toDomainModel(row: {
  id: string; modelVersion: string; createdAt: Date; researchRunId: string;
  weightsSha256: string; samplingJson: string; metrics: string; artifactPath: string;
  status: string; gateFailures: string | null;
}): KronosModelVersion {
  return {
    id: row.id,
    modelVersion: row.modelVersion,
    createdAt: row.createdAt.toISOString(),
    researchRunId: row.researchRunId,
    weightsSha256: row.weightsSha256,
    sampling: kronosSamplingSchema.parse(parseJson(row.samplingJson, 'samplingJson')),
    metrics: parseJson(row.metrics, 'metrics') as KronosModelVersion['metrics'],
    artifactPath: row.artifactPath,
    status: row.status as KronosModelVersion['status'],
    gateFailures: row.gateFailures
      ? (parseJson(row.gateFailures, 'gateFailures') as KronosModelVersion['gateFailures'])
      : [],
  };
}

export function toDomainPrediction(row: {
  id: string; modelVersion: string; ticker: string; signal: string; confidence: number;
  percentile: number; score: number; quantile: number; predictedReturn: number;
  predictionBandJson: string; contextBars: number; knowledgeDate: Date;
  universeDigest: string; generatedAt: Date;
}): KronosPrediction {
  return {
    id: row.id,
    modelVersion: row.modelVersion,
    ticker: row.ticker,
    signal: row.signal as KronosPrediction['signal'],
    confidence: row.confidence,
    percentile: row.percentile,
    score: row.score,
    quantile: row.quantile,
    predictedReturn: row.predictedReturn,
    band: kronosBandSchema.parse(parseJson(row.predictionBandJson, 'predictionBandJson')),
    contextBars: row.contextBars,
    knowledgeDate: row.knowledgeDate.toISOString(),
    universeDigest: row.universeDigest,
    generatedAt: row.generatedAt.toISOString(),
  };
}
```

- [ ] **Step 5: Implementar o repositório e o barril**

```typescript
// src/adapters/prisma/ml-kronos/repository.ts
import type { PrismaClient } from '@prisma/client';

import type { KronosModelFilter, KronosRepository } from '../../../domain/v1/ports/ml-kronos-repository';
import type {
  KronosModelVersionSubmission,
  KronosPredictionSubmission,
} from '../../../domain/v1/models/ml-kronos';
import { toDomainModel, toDomainPrediction } from './mapping';
import { kronosModelSubmissionSchema, kronosPredictionSubmissionSchema } from './schemas';

export function createPrismaKronosRepository(prisma: PrismaClient): KronosRepository {
  return {
    async listModels(filter: KronosModelFilter) {
      const rows = await prisma.kronosModelVersion.findMany({
        where: filter.status ? { status: filter.status } : undefined,
        orderBy: { createdAt: 'desc' },
        take: Math.min(filter.limit ?? 20, 100),
      });
      return rows.map(toDomainModel);
    },

    async getModel(modelVersion: string) {
      const row = await prisma.kronosModelVersion.findUnique({ where: { modelVersion } });
      return row ? toDomainModel(row) : null;
    },

    async saveModel(submission: KronosModelVersionSubmission) {
      const validado = kronosModelSubmissionSchema.parse(submission);
      const row = await prisma.kronosModelVersion.create({
        data: {
          modelVersion: validado.modelVersion,
          researchRunId: validado.researchRunId,
          weightsSha256: validado.weightsSha256,
          samplingJson: JSON.stringify(validado.sampling),
          metrics: JSON.stringify(validado.metrics),
          artifactPath: validado.artifactPath,
          status: validado.status,
          gateFailures: validado.gateFailures.length
            ? JSON.stringify(validado.gateFailures)
            : null,
        },
      });
      return toDomainModel(row);
    },

    async listPredictions(modelVersion: string) {
      const rows = await prisma.kronosPrediction.findMany({
        where: { modelVersion },
        orderBy: [{ generatedAt: 'desc' }, { quantile: 'desc' }],
      });
      return rows.map(toDomainPrediction);
    },

    async savePredictions(submissions: readonly KronosPredictionSubmission[]) {
      const validadas = submissions.map((s) => kronosPredictionSubmissionSchema.parse(s));
      const criadas = await prisma.$transaction(
        validadas.map((v) =>
          prisma.kronosPrediction.create({
            data: {
              modelVersion: v.modelVersion,
              ticker: v.ticker,
              signal: v.signal,
              confidence: v.confidence,
              percentile: v.percentile,
              score: v.score,
              quantile: v.quantile,
              predictedReturn: v.predictedReturn,
              predictionBandJson: JSON.stringify(v.band),
              contextBars: v.contextBars,
              knowledgeDate: new Date(v.knowledgeDate),
              universeDigest: v.universeDigest,
              generatedAt: new Date(v.generatedAt),
            },
          }),
        ),
      );
      return criadas.map(toDomainPrediction);
    },
  };
}
```

```typescript
// src/adapters/prisma/ml-kronos/index.ts
export { createPrismaKronosRepository } from './repository';
export { KronosPersistenceError } from './errors';
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm run test:kronos`
Expected: PASS (6 testes)

- [ ] **Step 7: Commit**

```bash
git add src/adapters/prisma/ml-kronos scripts/kronos/kronos-test.ts
git commit -m "feat(kronos): adaptador Prisma com validacao Zod nas duas direcoes

Valida na LEITURA tambem, nao so na escrita: linha gravada por versao
anterior do codigo pode ter shape antigo, e JSON malformado precisa virar
erro explicito em vez de vazar undefined para dentro do gate.

Ticker usa [A-Z0-9]{4}\\d{1,2} (forma corrigida em 542b6f4) — a forma antiga
rejeitava B3SA3 e ja derrubou um treino inteiro."
```

---

### Task 9: Worker assíncrono e rota do treino

Liga o walk-forward Python ao job manager existente.

**Files:**
- Create: `python/ml/kronos_worker.py`
- Modify: `src/application/ml-training-run/train-job-port.ts` (aceita `engine`)
- Modify: `src/app/api/v1/ml/training-runs/route.ts` (aceita `engine` no corpo)
- Test: `python/tests/test_kronos_worker.py`

**Interfaces:**
- Consumes: `ml.kronos_adapter.KronosForecaster`; `ml.kronos_walkforward.run_kronos_walkforward`; `ml.bars_snapshot.{write_universe_snapshot, load_snapshot_bars, SnapshotNotFoundError}`.
- Produces: protocolo de arquivos idêntico ao `directional_worker.py` — `<jobId>.progress.json`, `<jobId>.result.json`, `<jobId>.error.json` em `jobsDir`. O `result.json` contém `{'modelVersion', 'weightsSha256', 'sampling', 'metrics', 'universe', 'universeBarsDigest', 'artifactPath'}`.

- [ ] **Step 1: Escrever o teste que falha**

```python
# python/tests/test_kronos_worker.py
"""O worker nunca pode vazar stack trace ao processo pai.

`ml_api.py` repassa o que o worker escreve ao Next, que repassa ao usuário.
Um traceback com caminho de filesystem atravessaria essa cadeia inteira.
"""
import json, os, subprocess, sys, tempfile

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_falha_escreve_codigo_de_erro_e_nunca_traceback():
    jobs = tempfile.mkdtemp()
    proc = subprocess.run(
        [sys.executable, '-m', 'ml.kronos_worker', 'job-1', jobs, '["PETR4"]',
         json.dumps({'dbPath': '/caminho/que/nao/existe.db',
                     'barsSnapshotDir': jobs, 'kronosModelsDir': jobs,
                     'weightsDir': jobs, 'years': [2023]})],
        cwd=_ROOT, capture_output=True, text=True)

    assert proc.returncode == 1
    with open(os.path.join(jobs, 'job-1.error.json'), encoding='utf-8') as f:
        erro = json.load(f)
    assert erro['code'] in {'INSUFFICIENT_DATA', 'TRAINING_ERROR'}
    assert set(erro.keys()) == {'code'}          # nada além do código
    assert 'Traceback' not in proc.stdout and 'Traceback' not in proc.stderr


def test_progresso_e_escrito_com_as_fases_conhecidas():
    from ml.kronos_worker import PHASES
    assert PHASES == ['QUEUED', 'SNAPSHOT', 'DATASET', 'TRAINING', 'GATE', 'FINALIZING']
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python -m pytest python/tests/test_kronos_worker.py -v`
Expected: FAIL com `No module named ml.kronos_worker`

- [ ] **Step 3: Implementar `ml/kronos_worker.py`**

```python
"""Worker do walk-forward do Kronos em subprocesso próprio.

Mesmo protocolo de arquivos do `directional_worker.py` — de propósito: o job
manager do Item C não precisa saber qual motor rodou, e cancelamento continua
sendo `Popen.kill()` real em vez de checkpoint cooperativo dentro do PyTorch.

Uso: python -m ml.kronos_worker <jobId> <jobsDir> <symbolsJson> <cfgJson>

Nunca imprime stack trace, caminho ou segredo em stdout/stderr: `ml_api.py`
repassa isso ao Next, que repassa ao usuário.
"""
import hashlib
import json
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

PHASES = ['QUEUED', 'SNAPSHOT', 'DATASET', 'TRAINING', 'GATE', 'FINALIZING']


def _write_json_atomic(path: str, payload: dict) -> None:
    tmp = f'{path}.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(payload, f, default=str)
    os.replace(tmp, path)


def _quarters(years: list[int]) -> list[tuple]:
    import pandas as pd
    saida = []
    for ano in sorted(years):
        for i, mes in enumerate([3, 6, 9, 12]):
            saida.append((f'{ano}Q{i + 1}', pd.Timestamp(f'{ano}-{mes:02d}-01')))
    return saida


def _model_version(weights_sha256: str, sampling: dict, universe: list[str],
                   universe_bars_digest: str) -> str:
    """Identidade canônica: pesos + amostragem + universo + barras.

    Determinística e independente da ordem do universo. Se qualquer um dos
    quatro mudar, é outro modelo — e precisa de outra versão.
    """
    payload = json.dumps({'weights': weights_sha256, 'sampling': sampling,
                          'universe': sorted(set(universe)),
                          'bars': universe_bars_digest},
                         sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(payload.encode()).hexdigest()


def main() -> int:
    if len(sys.argv) < 5:
        print('uso: kronos_worker.py <jobId> <jobsDir> <symbolsJson> <cfgJson>', file=sys.stderr)
        return 2

    job_id, jobs_dir, symbols_json, cfg_json = sys.argv[1:5]
    os.makedirs(jobs_dir, exist_ok=True)
    progress_path = os.path.join(jobs_dir, f'{job_id}.progress.json')
    result_path = os.path.join(jobs_dir, f'{job_id}.result.json')
    error_path = os.path.join(jobs_dir, f'{job_id}.error.json')

    def progress(phase: str, pct: int) -> None:
        _write_json_atomic(progress_path, {'phase': phase, 'progress': pct})

    try:
        symbols = json.loads(symbols_json)
        cfg = json.loads(cfg_json)

        from ml.bars_snapshot import SnapshotNotFoundError, load_snapshot_bars, write_universe_snapshot
        from ml.kronos_adapter import SAMPLING, KronosForecaster
        from ml.kronos_walkforward import run_kronos_walkforward

        progress('SNAPSHOT', 10)
        snapshot = write_universe_snapshot(cfg['dbPath'], symbols, cfg['barsSnapshotDir'])

        progress('DATASET', 25)
        forecaster = KronosForecaster(cfg['weightsDir'])

        def bars_for(ticker: str):
            try:
                return load_snapshot_bars(snapshot['snapshotDir'], ticker)
            except SnapshotNotFoundError:
                return None

        # A versão é computada ANTES do walk-forward porque a seed de cada
        # previsão deriva dela — computá-la depois tornaria a seed dependente
        # do resultado, que é circular.
        version = _model_version(forecaster.weights_sha256, SAMPLING, symbols,
                                 snapshot['universeBarsDigest'])

        progress('TRAINING', 40)
        resultado = run_kronos_walkforward(
            forecaster, bars_for, symbols, _quarters(cfg['years']), version,
            batch_size=cfg.get('batchSize', 16),
            progress=lambda pct: progress('TRAINING', 40 + int(pct * 0.5)),
        )
        if not resultado['universe']:
            raise ValueError('INSUFFICIENT_DATA: nenhum ticker com excesso mensuravel')

        progress('GATE', 92)
        os.makedirs(cfg['kronosModelsDir'], exist_ok=True)
        artifact_path = os.path.join(cfg['kronosModelsDir'], f'{version}.json')
        _write_json_atomic(artifact_path, {'modelVersion': version,
                                           'universe': resultado['universe'],
                                           'sampling': SAMPLING})

        progress('FINALIZING', 98)
        _write_json_atomic(result_path, {
            'modelVersion': version,
            'weightsSha256': forecaster.weights_sha256,
            'sampling': SAMPLING,
            'metrics': resultado['metrics'],
            'universe': resultado['universe'],
            'universeBarsDigest': snapshot['universeBarsDigest'],
            'artifactPath': artifact_path,
        })
        return 0
    except ValueError as exc:
        code = 'INSUFFICIENT_DATA' if 'INSUFFICIENT_DATA' in str(exc) else 'TRAINING_ERROR'
        _write_json_atomic(error_path, {'code': code})
        return 1
    except Exception:  # noqa: BLE001 — nunca vazar stack trace ao processo pai
        _write_json_atomic(error_path, {'code': 'TRAINING_ERROR'})
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
```

- [ ] **Step 4: Aceitar `engine` na porta do job**

Em `src/application/ml-training-run/train-job-port.ts`, localize a interface de requisição de treino e acrescente o campo:

```typescript
  /**
   * Qual motor treinar. Default DIRECTIONAL para que todo chamador existente
   * continue funcionando sem alteração — a introdução do Kronos não pode
   * mudar o comportamento de quem não sabe que ele existe.
   */
  readonly engine?: 'DIRECTIONAL' | 'KRONOS';
```

- [ ] **Step 5: Aceitar `engine` na rota**

Em `src/app/api/v1/ml/training-runs/route.ts`, no schema Zod do corpo do POST, acrescente:

```typescript
  engine: z.enum(['DIRECTIONAL', 'KRONOS']).default('DIRECTIONAL'),
```

- [ ] **Step 6: Rodar e ver passar**

Run: `python -m pytest python/tests/test_kronos_worker.py -v && npm run test:ml-training-run`
Expected: PASS nos dois

- [ ] **Step 7: Commit**

```bash
git add python/ml/kronos_worker.py python/tests/test_kronos_worker.py src/application/ml-training-run/train-job-port.ts src/app/api/v1/ml/training-runs/route.ts
git commit -m "feat(kronos): worker assincrono no job manager existente

Mesmo protocolo de arquivos do directional_worker de proposito: o job manager
do Item C nao precisa saber qual motor rodou, e cancelamento continua sendo
Popen.kill() real em vez de checkpoint cooperativo dentro do PyTorch.

A modelVersion e computada ANTES do walk-forward porque a seed de cada
previsao deriva dela — computa-la depois tornaria a seed dependente do
resultado, que e circular."
```

---

### Task 10: Rotas HTTP

**Files:**
- Create: `src/app/api/v1/ml/kronos/models/route.ts`
- Create: `src/app/api/v1/ml/kronos/models/[modelVersion]/route.ts`
- Create: `src/app/api/v1/ml/kronos/predictions/route.ts`
- Modify: `scripts/kronos/kronos-test.ts`

**Interfaces:**
- Consumes: `createKronosService`, `toKronosModelDTO`, `toKronosPredictionDTO`; `createPrismaKronosRepository`.
- Produces: `GET /api/v1/ml/kronos/models?status=&limit=`, `GET /api/v1/ml/kronos/models/[modelVersion]`, `GET /api/v1/ml/kronos/predictions?modelVersion=`. Envelope `{ success, data, meta }` em sucesso e `{ success:false, error:{code,message} }` em falha — idêntico ao motor direcional.

- [ ] **Step 1: Escrever o teste que falha**

Acrescente a `scripts/kronos/kronos-test.ts`:

```typescript
test('GET models devolve envelope com data e meta', async () => {
  const { GET } = await import('../../src/app/api/v1/ml/kronos/models/route');
  const res = await GET(new Request('http://localhost/api/v1/ml/kronos/models?limit=5'));
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data));
});

test('GET predictions sem modelVersion e erro 400 com codigo, nunca lista vazia', async () => {
  const { GET } = await import('../../src/app/api/v1/ml/kronos/predictions/route');
  const res = await GET(new Request('http://localhost/api/v1/ml/kronos/predictions'));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'MISSING_MODEL_VERSION');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:kronos`
Expected: FAIL — módulo de rota inexistente

- [ ] **Step 3: Implementar a rota de modelos**

```typescript
// src/app/api/v1/ml/kronos/models/route.ts
/**
 * Lista as versões do Kronos. Espelha `/api/v1/ml/directional/models`.
 *
 * Modelos FAILED aparecem AQUI de propósito — a auditoria precisa deles. O
 * que os mantém fora de operação é `gateApproved` no DTO e o serviço, nunca
 * a omissão da listagem: esconder a reprovação seria esconder a evidência.
 */
import { NextResponse } from 'next/server';

import { createPrismaKronosRepository } from '@/adapters/prisma/ml-kronos';
import { createKronosService, toKronosModelDTO } from '@/application/ml-kronos';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? undefined;
  const limit = Number(url.searchParams.get('limit') ?? 20);

  try {
    const service = createKronosService({ repository: createPrismaKronosRepository(prisma) });
    const modelos = await service.listModels({
      status: status as 'ACTIVE' | 'FAILED' | 'DRAFT' | 'SUPERSEDED' | undefined,
      limit: Number.isFinite(limit) ? limit : 20,
    });
    return NextResponse.json({
      success: true,
      data: modelos.map(toKronosModelDTO),
      meta: { count: modelos.length },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'falha ao listar modelos' } },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Implementar a rota de detalhe**

```typescript
// src/app/api/v1/ml/kronos/models/[modelVersion]/route.ts
import { NextResponse } from 'next/server';

import { createPrismaKronosRepository } from '@/adapters/prisma/ml-kronos';
import { createKronosService, toKronosModelDTO } from '@/application/ml-kronos';
import { prisma } from '@/lib/prisma';

// Next.js 15: `params` é Promise.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ modelVersion: string }> },
): Promise<NextResponse> {
  const { modelVersion } = await params;
  try {
    const service = createKronosService({ repository: createPrismaKronosRepository(prisma) });
    const modelo = await service.getModel(modelVersion);
    if (!modelo) {
      return NextResponse.json(
        { success: false, error: { code: 'MODEL_NOT_FOUND', message: 'versao inexistente' } },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, data: toKronosModelDTO(modelo), meta: {} });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'falha ao ler o modelo' } },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 5: Implementar a rota de previsões**

```typescript
// src/app/api/v1/ml/kronos/predictions/route.ts
/**
 * Sinais do Kronos. Só de modelo ACTIVE e aprovado no gate — o serviço
 * levanta `MODEL_NOT_SERVABLE` em qualquer outro caso, e a rota devolve 409
 * em vez de lista vazia: lista vazia seria lida como "nenhum sinal hoje",
 * quando o fato é "este modelo não é servível".
 */
import { NextResponse } from 'next/server';

import { createPrismaKronosRepository } from '@/adapters/prisma/ml-kronos';
import {
  createKronosService,
  KronosModelNotServableError,
  toKronosPredictionDTO,
} from '@/application/ml-kronos';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request): Promise<NextResponse> {
  const modelVersion = new URL(request.url).searchParams.get('modelVersion');
  if (!modelVersion) {
    return NextResponse.json(
      { success: false, error: { code: 'MISSING_MODEL_VERSION', message: 'modelVersion e obrigatorio' } },
      { status: 400 },
    );
  }

  try {
    const service = createKronosService({ repository: createPrismaKronosRepository(prisma) });
    const previsoes = await service.listPredictions(modelVersion);
    const extremos = previsoes.filter((p) => p.signal !== 'NEUTRO');
    return NextResponse.json({
      success: true,
      data: previsoes.map(toKronosPredictionDTO),
      meta: {
        count: previsoes.length,
        highConfidence: extremos.length,
        generatedAt: previsoes[0]?.generatedAt ?? null,
      },
    });
  } catch (error) {
    if (error instanceof KronosModelNotServableError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'falha ao ler os sinais' } },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm run test:kronos`
Expected: PASS (8 testes)

- [ ] **Step 7: Commit**

```bash
git add src/app/api/v1/ml/kronos scripts/kronos/kronos-test.ts
git commit -m "feat(kronos): rotas de modelos e sinais

Modelo nao servivel devolve 409, nunca lista vazia: lista vazia seria lida
como 'nenhum sinal hoje', quando o fato e 'este modelo nao e servivel'.

Modelos FAILED aparecem na listagem de proposito — a auditoria precisa
deles. O que os mantem fora de operacao e gateApproved no DTO."
```

---

### Task 11: Geração de sinais vivos

O walk-forward produz MÉTRICAS; nada até aqui produz o ranking do trimestre corrente. Esta task fecha o buraco: sem ela, `savePredictions`, o campo `confidence` e o botão "Gerar sinais agora" existem sem produtor.

**Files:**
- Create: `python/ml/kronos_predict.py`
- Create: `src/app/api/v1/ml/kronos/predictions/_generate.ts`
- Modify: `src/app/api/v1/ml/kronos/predictions/route.ts` (acrescenta `POST`)
- Modify: `src/application/ml-kronos/service.ts` (acrescenta `generatePredictions`)
- Test: `python/tests/test_kronos_predict.py`

**Interfaces:**
- Consumes: `ml.kronos_scorer.{build_context, future_timestamps, score_cross_section}`; `ml.kronos_adapter.{KronosForecaster, derive_seed}`; `KronosRepository.savePredictions`.
- Produces:
  - `ml.kronos_predict.predict_latest(forecaster, bars_for, universe: list[str], knowledge_time, model_version: str, batch_size: int = 16) -> tuple[pd.DataFrame, dict]` — o DataFrame tem `['ticker', 'signal', 'confidence', 'percentile', 'score', 'quantile', 'predictedReturn', 'band', 'contextBars']` e o dict é `{'excluded': list[str], 'universeSize': int, 'reason': str}`
  - `service.generatePredictions(modelVersion: string)` na camada de aplicação
  - `POST /api/v1/ml/kronos/predictions`

- [ ] **Step 1: Escrever o teste que falha**

```python
# python/tests/test_kronos_predict.py
import os, sys
import numpy as np
import pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.kronos_predict import confidence_from_percentile, restrict_to_universe


def test_confianca_e_a_distancia_da_mediana_nunca_probabilidade():
    assert confidence_from_percentile(0.5) == 0.0     # mediana: nenhuma convicção
    assert confidence_from_percentile(1.0) == 1.0     # topo absoluto
    assert confidence_from_percentile(0.0) == 1.0     # fundo absoluto também convence
    assert confidence_from_percentile(0.75) == 0.5


def test_empresa_fora_do_universo_validado_sai_do_ranking_e_vai_ao_relatorio():
    """Correção e604724: empresa sem serie de precos mensuravel nao pode
    disputar quintil com quem tem — ela DESLOCA empresa real do extremo."""
    candidatos = ['PETR4', 'VALE3', 'NOVA3']
    dentro, relatorio = restrict_to_universe(candidatos, ['PETR4', 'VALE3'])
    assert dentro == ['PETR4', 'VALE3']
    assert relatorio['excluded'] == ['NOVA3']
    assert relatorio['universeSize'] == 2
    assert relatorio['reason']


def test_universo_vazio_no_modelo_nao_libera_geral():
    """Modelo sem universo registrado NAO pode virar 'aceita todo mundo'."""
    dentro, relatorio = restrict_to_universe(['PETR4'], [])
    assert dentro == []
    assert relatorio['excluded'] == ['PETR4']
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python -m pytest python/tests/test_kronos_predict.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'ml.kronos_predict'`

- [ ] **Step 3: Implementar `ml/kronos_predict.py`**

```python
"""Ranking vivo do Kronos — o trimestre corrente, RESTRITO ao universo validado.

Diferente do walk-forward, aqui NÃO existe alvo: os 60 pregões seguintes ainda
não aconteceram. É exatamente a previsão viva.

A restrição ao universo validado repete a correção `e604724`: uma empresa que
o modelo nunca validou é perfeitamente pontuável (basta ter barras), mas não
há como medir o resultado depois — e ela DESLOCA empresas reais dos quintis
extremos, porque o quintil é calculado sobre quem está na seção.
"""
import pandas as pd

from .kronos_adapter import derive_seed
from .kronos_scorer import build_context, future_timestamps, score_cross_section

_COLUMNS = ['ticker', 'signal', 'confidence', 'percentile', 'score',
            'quantile', 'predictedReturn', 'band', 'contextBars']


def confidence_from_percentile(percentile: float) -> float:
    """Distância da mediana da seção: |2·percentil − 1|.

    NÃO é probabilidade. O escore ordena empresas; não estima chance de subir.
    O nome `confidence` vem do contrato do motor anterior e é mantido para que
    as duas telas falem a mesma língua.
    """
    return abs(2.0 * float(percentile) - 1.0)


def restrict_to_universe(candidates: list[str], universe: list[str]) -> tuple[list[str], dict]:
    """Mantém só quem o modelo validou; o resto vai para o relatório.

    Universo vazio NÃO libera geral: um modelo sem universo registrado é um
    modelo cujo alcance é desconhecido, e desconhecido não é permissão.
    """
    validos = set(universe)
    dentro = sorted(t for t in candidates if t in validos)
    fora = sorted(t for t in candidates if t not in validos)
    return dentro, {
        'excluded': fora,
        'universeSize': len(validos),
        'reason': 'fora do universo validado no treino' if fora else '',
    }


def predict_latest(forecaster, bars_for, universe: list[str], knowledge_time,
                   model_version: str, batch_size: int = 16) -> tuple[pd.DataFrame, dict]:
    """Ranking do trimestre corrente. Devolve `(previsoes, relatorio)`."""
    candidatos = sorted({t for t in universe})
    dentro, relatorio = restrict_to_universe(candidatos, universe)
    if not dentro:
        return pd.DataFrame(columns=_COLUMNS), relatorio

    pedidos, contextos = [], {}
    ignorados = []
    for ticker in dentro:
        bars = bars_for(ticker)
        if bars is None:
            ignorados.append(ticker)
            continue
        try:
            contexto = build_context(bars, knowledge_time)
        except ValueError:
            ignorados.append(ticker)   # INSUFFICIENT_CONTEXT
            continue
        contextos[ticker] = contexto
        pedidos.append({'ticker': ticker, 'period': str(pd.Timestamp(knowledge_time).date()),
                        'bars': contexto,
                        'yTimestamps': future_timestamps(bars, knowledge_time),
                        'seed': derive_seed(model_version, ticker,
                                            str(pd.Timestamp(knowledge_time).date()))})

    if ignorados:
        relatorio = {**relatorio,
                     'excluded': sorted(relatorio['excluded'] + ignorados),
                     'reason': relatorio['reason'] or 'historico insuficiente para o contexto'}
    if not pedidos:
        return pd.DataFrame(columns=_COLUMNS), relatorio

    previsoes = []
    for i in range(0, len(pedidos), batch_size):
        previsoes.extend(forecaster.forecast_batch(pedidos[i:i + batch_size]))

    ranking = score_cross_section(previsoes)
    por_ticker = {p['ticker']: p for p in previsoes}
    ranking = ranking.assign(
        confidence=[confidence_from_percentile(p) for p in ranking['percentile']],
        band=[por_ticker[t]['band'] for t in ranking['ticker']],
        contextBars=[por_ticker[t]['contextBars'] for t in ranking['ticker']],
    )
    return ranking[_COLUMNS].reset_index(drop=True), relatorio
```

- [ ] **Step 4: Rodar e ver passar**

Run: `python -m pytest python/tests/test_kronos_predict.py -v`
Expected: PASS (3 testes)

- [ ] **Step 5: Acrescentar `generatePredictions` ao serviço**

Em `src/application/ml-kronos/service.ts`, acrescente ao objeto devolvido por `createKronosService`:

```typescript
    /**
     * Gera e persiste o ranking vivo. Só de modelo servível — `assertServable`
     * levanta antes de qualquer previsão ser computada, para que um modelo
     * reprovado nunca chegue nem a consumir GPU.
     */
    async generatePredictions(modelVersion: string): Promise<readonly KronosPrediction[]> {
      const modelo = assertServable(await repository.getModel(modelVersion));
      const gerado = await runKronosPrediction(modelo);
      const persistidas = await repository.savePredictions(gerado.predictions);
      return persistidas;
    },
```

E acrescente `runKronosPrediction` às dependências injetadas:

```typescript
export interface KronosServiceDeps {
  readonly repository: KronosRepository;
  /** Dispara o job Python de previsão viva. Injetado para que o serviço
   *  permaneça testável sem GPU. */
  readonly runKronosPrediction: (model: KronosModelVersion) => Promise<{
    readonly predictions: readonly KronosPredictionSubmission[];
    readonly excludedFromUniverse: readonly string[];
  }>;
}
```

Ajuste a desestruturação para `({ repository, runKronosPrediction }: KronosServiceDeps)`.

- [ ] **Step 6: Implementar o adaptador do job de previsão**

```typescript
// src/app/api/v1/ml/kronos/predictions/_generate.ts
/**
 * Dispara o job Python de previsão viva por HTTP local, no mesmo padrão dos
 * demais serviços Python da plataforma (`ml_api.py`, porta 5560).
 *
 * Síncrono de propósito, ao contrário do TREINO: prever um trimestre é a
 * previsão de um único carimbo, ordens de grandeza mais barata que o
 * walk-forward de 40 trimestres. Se o piloto (Task 4) mostrar que mesmo um
 * carimbo passa de ~30 s, esta chamada precisa virar job assíncrono como o
 * treino — registre isso no handoff em vez de deixar a requisição pendurada.
 */
import type {
  KronosModelVersion,
  KronosPredictionSubmission,
} from '@/domain/v1/models/ml-kronos';

const ML_API = process.env.WR_ML_API_URL ?? 'http://127.0.0.1:5560';

export async function runKronosPrediction(model: KronosModelVersion): Promise<{
  predictions: readonly KronosPredictionSubmission[];
  excludedFromUniverse: readonly string[];
}> {
  const res = await fetch(`${ML_API}/kronos/predict`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modelVersion: model.modelVersion }),
  });
  if (!res.ok) throw new Error('PREDICTION_FAILED');
  const body = await res.json();
  return {
    predictions: body.predictions as readonly KronosPredictionSubmission[],
    excludedFromUniverse: (body.report?.excluded ?? []) as readonly string[],
  };
}
```

Acrescente o endpoint `/kronos/predict` em `python/ml_api.py`, seguindo exatamente o padrão do endpoint de previsão direcional já existente ali: valida `modelVersion` contra `^[0-9a-f]{64}$`, lê o artefato para obter o universo validado, chama `predict_latest` e devolve `{'predictions': [...], 'report': {...}}`.

- [ ] **Step 7: Acrescentar o `POST` à rota**

Em `src/app/api/v1/ml/kronos/predictions/route.ts`:

```typescript
export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const modelVersion = typeof body?.modelVersion === 'string' ? body.modelVersion : null;
  if (!modelVersion) {
    return NextResponse.json(
      { success: false, error: { code: 'MISSING_MODEL_VERSION', message: 'modelVersion e obrigatorio' } },
      { status: 400 },
    );
  }

  try {
    const service = createKronosService({
      repository: createPrismaKronosRepository(prisma),
      runKronosPrediction,
    });
    const previsoes = await service.generatePredictions(modelVersion);
    const extremos = previsoes.filter((p) => p.signal !== 'NEUTRO');
    return NextResponse.json({
      success: true,
      data: previsoes.map(toKronosPredictionDTO),
      meta: { count: previsoes.length, highConfidence: extremos.length },
    });
  } catch (error) {
    if (error instanceof KronosModelNotServableError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { success: false, error: { code: 'PREDICTION_FAILED', message: 'falha ao gerar os sinais' } },
      { status: 500 },
    );
  }
}
```

O `GET` da mesma rota também passa a precisar de `runKronosPrediction` ao construir o serviço — importe-o e passe nos dois handlers.

- [ ] **Step 8: Rodar e ver passar**

Run: `npm run test:kronos && python -m pytest python/tests/test_kronos_predict.py -v`
Expected: PASS nos dois

- [ ] **Step 9: Commit**

```bash
git add python/ml/kronos_predict.py python/tests/test_kronos_predict.py python/ml_api.py src/app/api/v1/ml/kronos/predictions src/application/ml-kronos/service.ts
git commit -m "feat(kronos): geracao de sinais vivos

O walk-forward produz metricas; nada produzia o ranking do trimestre
corrente. Universo vazio NAO libera geral: modelo sem universo registrado e
modelo de alcance desconhecido, e desconhecido nao e permissao.

confidence e |2*percentil-1| — distancia da mediana, nunca probabilidade."
```

---

### Task 12: Tela `KronosSignalsView`

**Files:**
- Create: `src/components/ml/KronosSignalsView.tsx`
- Modify: `src/components/tabs/MLPredictionsTab.tsx` (acrescenta a sub-aba)

**Interfaces:**
- Consumes: `/api/v1/ml/kronos/models`, `/api/v1/ml/kronos/predictions`, `/api/v1/ml/training-runs` (com `engine: 'KRONOS'`), `/api/v1/ml/cost-profiles`; `useToast` de `@/contexts/ToastContext`.
- Produces: componente default-export `KronosSignalsView`.

- [ ] **Step 1: Implementar a tela**

Espelhe `src/components/ml/DirectionalSignalsView.tsx`: mesmas seções (seletor de versão + `GatePanel`, sinais, treinar, histórico), mesmo `getJson`/`postJson`, mesmo polling de 3 s do treino, mesmas classes Tailwind. As diferenças obrigatórias:

```tsx
// Cabeçalho — o texto precisa dizer o que este motor é, sem prometer mais.
<h3 className="font-orbitron text-xl font-bold neon-text-cyan">
  Kronos — foundation model de candles (60 pregões · zero-shot)
</h3>
<p className="text-xs text-gray-500 mt-1">
  Prevê 60 pregões de candles a partir das últimas 512 barras diárias e ordena as
  empresas pelo retorno previsto. Os pesos NÃO são ajustados à B3 — a escala do
  retorno previsto não é confiável, só a ordenação entre empresas é, e é ela que
  passa pelo mesmo gate do escore de fator.
</p>
```

A tabela de sinais troca a coluna "Principais fatores" por duas colunas próprias:

```tsx
<th className="text-right py-2 px-2">Retorno previsto</th>
<th className="text-right py-2 px-2">Banda P10–P90</th>
```

```tsx
<td className="py-2 px-2 text-right font-mono text-gray-300">{pct(p.predictedReturn, 2)}</td>
<td className="py-2 px-2 text-right font-mono text-gray-600">
  {pct(p.band.p10, 1)} … {pct(p.band.p90, 1)}
</td>
```

E, logo abaixo da tabela, a ressalva que impede leitura errada da banda:

```tsx
<p className="text-[11px] text-yellow-400/80 mt-2">
  A banda é informativa: ela NÃO passou por teste de calibração e não participa do
  gate nem do sinal. Não a leia como intervalo de confiança.
</p>
```

Mantenha o aviso de exclusões do universo, exatamente como no outro motor — ele lê `meta.excludedFromUniverse` da resposta do `POST /predictions` e explica por que aquelas empresas ficaram de fora, em vez de deixá-las sumir em silêncio.

O botão de treinar envia o motor explicitamente:

```tsx
const { data } = await postJson<TrainingRun>('/api/v1/ml/training-runs', {
  costProfileId: selectedCostProfileId,
  engine: 'KRONOS',
});
```

E `PHASE_LABELS` descreve as fases deste motor:

```tsx
const PHASE_LABELS: Record<TrainingRun['phase'], string> = {
  QUEUED: 'na fila',
  SNAPSHOT: 'congelando barras D1',
  DATASET: 'carregando os pesos do Kronos',
  TRAINING: 'prevendo trimestre a trimestre (walk-forward)',
  GATE: 'aplicando gates',
  FINALIZING: 'finalizando',
};
```

O estado sem modelo aprovado repete a regra do outro motor — nunca mostrar sinal:

```tsx
<p className="text-yellow-400">
  Nenhum modelo Kronos passou no gate de aceitação — por isso não há sinais a exibir.
</p>
<p className="text-gray-500">
  O Kronos enfrenta exatamente os mesmos cinco critérios do escore de fator: IC ≥ 0,02,
  t ≥ 2,0, excesso do quintil superior ≥ 0,5% ao trimestre líquido de custos, spread
  topo−fundo positivo e ao menos 60% dos anos com spread positivo. É de propósito: só
  sob a mesma régua dá para dizer se o foundation model bate o fator.
</p>
```

- [ ] **Step 2: Acrescentar a sub-aba**

Em `src/components/tabs/MLPredictionsTab.tsx`, acrescente um seletor entre os dois motores, com `DirectionalSignalsView` como padrão (a introdução do Kronos não pode mudar o que o usuário vê ao abrir a aba).

- [ ] **Step 3: Verificar no app**

Run: `npm run dev` e abra a aba Previsões ML → Kronos.
Expected: sem modelo treinado, a tela mostra "Nenhum modelo Kronos passou no gate" e os cinco critérios — nunca uma tabela vazia sem explicação.

- [ ] **Step 4: Rodar o lint**

Run: `npm run lint`
Expected: sem erros novos

- [ ] **Step 5: Commit**

```bash
git add src/components/ml/KronosSignalsView.tsx src/components/tabs/MLPredictionsTab.tsx
git commit -m "feat(kronos): tela de sinais com a ressalva da banda

A banda P10-P90 aparece porque e informacao real, mas com aviso explicito de
que NAO passou por teste de calibracao e nao participa do gate. Sem esse
aviso ela seria lida como intervalo de confianca, que e o que ela nao e.

DirectionalSignalsView segue como padrao da aba: introduzir o Kronos nao
pode mudar o que o usuario ve ao abrir a tela."
```

---

### Task 13: Tools MCP

**Files:**
- Create: `src/mcp/pilot/tools/ml-kronos.ts`
- Modify: `src/mcp/pilot/tools/index.ts` (registra as tools)
- Modify: `docs/MCP_PILOT.md` (catálogo)
- Test: `scripts/mcp-pilot/` (acrescenta caso ao teste existente)

**Interfaces:**
- Consumes: `createKronosService`, `toKronosModelDTO`, `toKronosPredictionDTO`, `createPrismaKronosRepository`.
- Produces: tools `kronos.ranking`, `kronos.model`, `kronos.train`.

- [ ] **Step 1: Implementar as tools**

```typescript
// src/mcp/pilot/tools/ml-kronos.ts
/**
 * Tools do Kronos para o piloto MCP.
 *
 * ARMADILHA (registrada no CODEX_HANDOFF): estas tools NÃO podem chamar
 * `/api/v1/*`. `resolveRequestedBy` deriva o principal do cookie de sessão e o
 * piloto autentica por Bearer — toda rota com `requireKnownPrincipal`
 * responderia UNAUTHENTICATED. Por isso falam com a camada de aplicação
 * direto, com `requestedBy` fixo em `mcp:hermes`.
 *
 * A EVIDÊNCIA viaja junto do ranking de propósito. Em tool separada, o agente
 * repassaria a lista como verdade e consultaria as ressalvas só se lembrasse.
 */
import { createPrismaKronosRepository } from '@/adapters/prisma/ml-kronos';
import { createKronosService, toKronosModelDTO, toKronosPredictionDTO } from '@/application/ml-kronos';
import { prisma } from '@/lib/prisma';

const REQUESTED_BY = 'mcp:hermes';

function service() {
  return createKronosService({ repository: createPrismaKronosRepository(prisma) });
}

export const kronosRankingTool = {
  name: 'kronos.ranking',
  description:
    'Ranking do Kronos (foundation model de candles, zero-shot) com a evidencia do modelo: '
    + 'IC, t-stat, spread topo-fundo e as ressalvas. Sem modelo aprovado, devolve aviso.',
  gated: false,
  async execute() {
    const svc = service();
    const ativos = await svc.listModels({ status: 'ACTIVE', limit: 1 });
    const modelo = ativos[0];
    if (!modelo) {
      // Nunca lista vazia muda: o agente leria como "nenhum sinal hoje".
      return {
        aviso: 'Nenhum modelo Kronos passou no gate de aceitacao. Nao ha ranking a reportar, '
          + 'e a ausencia de sinal aqui NAO significa mercado neutro.',
        ranking: [],
      };
    }

    const dto = toKronosModelDTO(modelo);
    const previsoes = await svc.listPredictions(modelo.modelVersion);
    return {
      ranking: previsoes.map(toKronosPredictionDTO),
      evidencia: {
        modelVersion: dto.modelVersion,
        ic: dto.metrics.ic,
        icTStat: dto.metrics.icTStat,
        topBottomSpread: dto.metrics.topBottomSpread,
        netTopBottomSpread: dto.metrics.netTopBottomSpread,
        positiveYearsRatio: dto.metrics.positiveYearsRatio,
        ressalvas: [
          'Pesos zero-shot: o Kronos NAO foi ajustado a B3. A escala do retorno previsto '
            + 'nao e confiavel; apenas a ordenacao entre empresas passou pelo gate.',
          'A banda P10-P90 nao passou por teste de calibracao e nao participa do gate.',
          'O gate e o MESMO do escore de fator, entao os dois motores sao comparaveis '
            + 'numero a numero — use isso ao confrontar as duas listas.',
        ],
      },
    };
  },
};

export const kronosModelTool = {
  name: 'kronos.model',
  description: 'Modelo Kronos ativo e a conferencia dos 5 gates, um a um.',
  gated: false,
  async execute() {
    const ativos = await service().listModels({ status: 'ACTIVE', limit: 1 });
    if (!ativos[0]) return { aviso: 'Nenhum modelo Kronos ativo.', modelo: null };
    return { modelo: toKronosModelDTO(ativos[0]) };
  },
};

export const kronosTrainTool = {
  name: 'kronos.train',
  description:
    'Dispara o walk-forward do Kronos. NAO e gated: neste catalogo gated significa '
    + 'o trilho propose/approve com codigo de confirmacao, exclusivo das tools trade.*. '
    + 'Guardas reais: perfil de custo ativo obrigatorio, um treino por vez, cancelavel, '
    + 'auditado em MlTrainingRun sob ' + REQUESTED_BY + '.',
  gated: false,
  async execute(input: { costProfileId: string }) {
    const { startTrainingRun } = await import('@/application/ml-training-run');
    return startTrainingRun({
      costProfileId: input.costProfileId,
      engine: 'KRONOS',
      requestedBy: REQUESTED_BY,
    });
  },
};

export const kronosTools = [kronosRankingTool, kronosModelTool, kronosTrainTool];
```

- [ ] **Step 2: Registrar as tools**

Em `src/mcp/pilot/tools/index.ts`, importe `kronosTools` e acrescente ao array de tools registradas, junto das `ml-directional`.

- [ ] **Step 3: Rodar os testes do MCP**

Run: `npm run test:mcp-pilot`
Expected: PASS. Se houver invariante testada de contagem de tools ou de que exatamente 4 tools são `gated`, ela deve continuar passando — as três tools novas são `free`. Atualize a contagem esperada de 39 para 42.

- [ ] **Step 4: Atualizar o catálogo**

Em `docs/MCP_PILOT.md`, acrescente as 3 tools à tabela do catálogo e corrija a contagem total para 42.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/pilot/tools/ml-kronos.ts src/mcp/pilot/tools/index.ts docs/MCP_PILOT.md
git commit -m "feat(mcp): tools do Kronos no piloto

A evidencia viaja JUNTO do ranking de proposito: em tool separada, o agente
repassaria a lista como verdade e consultaria as ressalvas so se lembrasse.
Entre as ressalvas, a mais importante e que os pesos sao zero-shot — a
escala do retorno previsto nao e confiavel, so a ordenacao passou no gate.

Falam com a camada de aplicacao direto: rota /api/v1/* responderia
UNAUTHENTICATED ao Bearer do piloto."
```

---

### Task 14: Documentação e registro da decisão

**Files:**
- Modify: `docs/CODEX_HANDOFF.md`
- Create: `docs/KRONOS.md`
- Modify: `C:\Users\rwres\hermes-knowledge\concepts\wr-trading-pro-professional-upgrade.md`
- Modify: `C:\Users\rwres\hermes-knowledge\log.md`
- Modify: `C:\Users\rwres\hermes-knowledge\index.md`

**Interfaces:**
- Consumes: o veredito do piloto (Task 4) e as métricas do primeiro treino real (Task 9).
- Produces: nada que outro código importe.

- [ ] **Step 1: Escrever `docs/KRONOS.md`**

Documente: o que é o motor, o pipeline em uma figura de texto, as cinco travas de determinismo, como rodar o piloto de custo, como treinar pela UI, e — obrigatoriamente — **a comparação numérica entre os dois motores** (IC, t-stat, spread líquido, anos+ lado a lado). Essa tabela é o produto final da integração; sem ela a pergunta que motivou tudo fica sem resposta escrita.

- [ ] **Step 2: Atualizar o handoff**

Em `docs/CODEX_HANDOFF.md`, acrescente uma seção de sessão datada 2026-07-28 com: o que foi feito, o veredito do piloto de custo, o resultado do gate no primeiro treino real e as armadilhas encontradas. Se o Kronos foi REPROVADO no gate, registre isso com os números — resultado negativo é resultado, e a plataforma já tem o precedente do Item D com o COTAHIST.

- [ ] **Step 3: Atualizar o vault**

Conforme `CLAUDE.md`: atualize `concepts/wr-trading-pro-professional-upgrade.md` com a decisão de arquitetura (segundo motor sob a mesma régua), acrescente entrada em `log.md` e o wikilink em `index.md`, seguindo o frontmatter e o campo `updated` do `SCHEMA.md`.

- [ ] **Step 4: Rodar a bateria completa**

```bash
npm run lint && npm run test:kronos && npm run test:ml-training-run && npm run test:mcp-pilot
python -m pytest python/tests/test_kronos_weights.py python/tests/test_kronos_adapter.py python/tests/test_kronos_scorer.py python/tests/test_kronos_walkforward.py python/tests/test_kronos_worker.py python/tests/test_kronos_schema.py -v
npm run test:directional-classifier && npm run test:directional:py
```

Expected: tudo PASS. A última linha é deliberada: prova que a trilha Kronos não quebrou o motor direcional.

- [ ] **Step 5: Commit**

```bash
git add docs/KRONOS.md docs/CODEX_HANDOFF.md
git commit -m "docs: registra a integracao do Kronos e o confronto entre os dois motores

A tabela comparativa em docs/KRONOS.md e o produto final da integracao: sem
ela, a pergunta que motivou tudo — o foundation model bate o fator? — fica
sem resposta escrita. Reprovacao no gate tambem e registrada com numeros;
resultado negativo e resultado."
```

---

## Notas para quem executa

**Ordem é obrigatória até a Task 4.** As tasks 1→2→3→4 são uma cadeia: o piloto de custo (Task 4) é portão de continuidade e nenhuma task posterior começa antes de o usuário decidir sobre o veredito.

**Depois da Task 4**, as tasks 5 e 6 são independentes entre si e podem ser paralelizadas. Depois: 7→8→10→11 é cadeia; a 9 depende de 5+6; a 12 (UI) depende de 10+11; a 13 (MCP) depende de 7+8+11. A 14 é a última.

**Ponto que a spec deixou em aberto e o plano resolveu:** a spec cita "embargo do alvo" entre as travas de determinismo, herdado do motor de fator. No Kronos zero-shot **não existe período de calibração** — não há ajuste de parâmetro algum —, então não há o que embargar. A trava equivalente aqui é `realized_excess` devolver `None` quando os 60 pregões ainda não fecharam (Task 5), o que impede uma linha sem alvo de entrar no `wf`. Se alguma futura fase introduzir fine-tuning, o embargo volta a ser necessário e precisa ser reintroduzido explicitamente.

**O que NÃO é falha:** o Kronos ser reprovado no gate. Todo o desenho existe para que essa resposta seja mensurável e auditável. Um Kronos reprovado, com IC medido e registrado, é entrega bem-sucedida deste plano — não motivo para afrouxar limiar nenhum.
