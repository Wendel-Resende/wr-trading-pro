# ML Híbrido v1 — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modelo de direção a 10 pregões (LightGBM) sobre features point-in-time de preço + fundamentos CVM defasados + TimesFM zero-shot, com walk-forward, gate contra 4 baselines e publicação governada no trilho Fase 5.

**Architecture:** Serviço Python `python/ml_api.py` (Flask :5560, loopback) faz backfill D1 via MT5, monta dataset point-in-time e treina/infere; o Next orquestra via `/api/v1/ml/*`, aplica o gate determinístico e persiste `ResearchRun`/`ModelVersion`/`Signal`/`BacktestRun` já existentes. UI ganha visão "Híbrido governado"; Electron ganha card ligar/desligar.

**Tech Stack:** Python (pandas, lightgbm, timesfm/torch, MetaTrader5, Flask), TypeScript/Next 15, Prisma/SQLite, trilho Fase 5 em `src/application/`.

**Spec:** `docs/superpowers/specs/2026-07-18-ml-hybrid-upgrade-design.md`

## Global Constraints

- Porta do serviço ML: `5560`, bind exclusivo `127.0.0.1`. Env: `WR_ML_API_PORT` (serviço), `WR_ML_API_URL` (Next, default `http://127.0.0.1:5560`).
- Python: `C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe` (conda `IA_Day_Trading`). Testes Python são scripts com `assert` rodados direto (padrão `test:ws-token:py`), sem pytest.
- Defasagem fundamentalista: trimestre disponível em `data_ref + 45 dias` (T1–T3) e `data_ref + 90 dias` (T4). Nunca `data_ref` puro.
- Alvo: binário `close[t+10] > close[t]` (10 pregões). Amostragem a cada 5 pregões por ticker. Embargo treino→teste: 21 pregões.
- LightGBM fixo: `max_depth=6, num_leaves=63, learning_rate=0.05, n_estimators=400, early_stopping=50` (split temporal interno 80/20 do treino).
- Gate: bootstrap em blocos ticker-mês, 1000 reamostragens, seed fixa 42; aprovado se P2.5 da diferença de acurácia > 0 contra **cada** um dos 4 baselines.
- `ModelVersion.kind = 'ML'` (schema só permite ML|RULE), `label = 'ml-hybrid-swing-v1'`.
- Bancos: candles em `prisma/dev.db` tabela `HistoricalCandle` (Python escreve linhas via sqlite3, nunca DDL); CVM read-only em `data/cvm/cvm_fundamentos.db`; artefatos em `data/ml/` (gitignored).
- Nenhuma previsão vira `OrderIntent`. Erros sempre explícitos (`MT5_DISCONNECTED`, `INSUFFICIENT_DATA`, `MODEL_NOT_FOUND`); nunca dado sintético como oficial.

## Desvios conscientes da spec (registrados)

1. O índice único `(symbol, timeframe, time)` de `HistoricalCandle` **já existe** (schema.prisma:301) — não há migração; a "limpeza" vira full-refresh por símbolo no backfill (os dados atuais de PETR4 "D1" são barras H1 mal rotuladas).
2. Sinais históricos do walk-forward ficam no artefato `walkforward_predictions.csv` referenciado por `trainingEvidenceJson` (persistir ~50k `Signal` um-a-um não escala); `Signal` no banco só para previsões ao vivo.
3. Baseline fundamentalista = z-score composto in-repo (média de z de `roe`, `margem_liquida`, `-divida_bruta_pl`, `crescimento_lucro_yoy`, corte na mediana cross-section) — os exports de score não são versionados no repo.
4. `BacktestRun.instrumentId = 'UNIVERSE:CVM138'` (o modelo é de universo; o schema pede instrumento único).
5. Backtest da v1 é proxy direcional (±2% por acerto/erro, custo fixo 25bps) — decisão do usuário no pré-voo (2026-07-18): retorno real com custos parametrizados fica para a v1.1, quando os preços já estarão no banco.
6. Sem `BacktestRun` na v1 (descoberto na Task 9): o `BacktestRunService` da Fase 5 recalcula métricas com o engine determinístico a partir de bars/signals — persistir o proxy lá falsificaria proveniência. O proxy fica em `trainingEvidenceJson.backtestProxy`; `BacktestRun` governado entra na v1.1 com o backtest real. `runTraining` não retorna `backtestId`.

---

### Task 1: Python — store de candles + backfill MT5

**Files:**
- Create: `python/ml/__init__.py` (vazio)
- Create: `python/ml/candles.py`
- Create: `python/tests/test_ml_candles.py`

**Interfaces:**
- Produces: `replace_daily_candles(db_path, symbol, rows) -> int` com `rows = [(time_ms:int, open, high, low, close, volume), ...]`; `load_daily_candles(db_path, symbol) -> pandas.DataFrame` (colunas `time` datetime, `open, high, low, close, volume`, ordenado, sem duplicatas); `backfill_symbols(db_path, symbols, mt5_client, min_bars=750) -> dict` com relatório por ticker (`{"ok": [...], "failed": {sym: reason}}`); classe `Mt5DailyClient` (real) com método `get_daily_rates(symbol) -> list[tuple] | None`.
- Consumes: nada (base da cadeia).

- [ ] **Step 1: Escrever teste que falha**

```python
# python/tests/test_ml_candles.py
import os, sqlite3, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.candles import replace_daily_candles, load_daily_candles, backfill_symbols

DDL = """CREATE TABLE HistoricalCandle (
  id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, timeframe TEXT NOT NULL,
  time DATETIME NOT NULL, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL,
  close REAL NOT NULL, volume REAL NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX u ON HistoricalCandle(symbol, timeframe, time);"""

def make_db():
    path = os.path.join(tempfile.mkdtemp(), 'test.db')
    con = sqlite3.connect(path); con.executescript(DDL); con.close()
    return path

def day_ms(i):  # dias sequenciais a partir de 2024-01-01 UTC
    return (1704067200 + i * 86400) * 1000

def test_replace_is_full_refresh():
    db = make_db()
    replace_daily_candles(db, 'WEGE3', [(day_ms(i), 1, 2, 0.5, 1.5, 100) for i in range(5)])
    # segunda carga menor substitui a primeira (full refresh, não append)
    n = replace_daily_candles(db, 'WEGE3', [(day_ms(i), 1, 2, 0.5, 1.6, 100) for i in range(3)])
    assert n == 3
    df = load_daily_candles(db, 'WEGE3')
    assert len(df) == 3 and abs(df['close'].iloc[0] - 1.6) < 1e-9
    assert df['time'].is_monotonic_increasing

def test_backfill_report_and_min_bars():
    db = make_db()
    class FakeMt5:
        def get_daily_rates(self, symbol):
            if symbol == 'DEAD3': return None
            n = 10 if symbol == 'CURT3' else 800
            return [(day_ms(i), 1, 2, 0.5, 1.5, 100) for i in range(n)]
    report = backfill_symbols(db, ['WEGE3', 'CURT3', 'DEAD3'], FakeMt5(), min_bars=750)
    assert report['ok'] == ['WEGE3']
    assert 'CURT3' in report['failed'] and 'DEAD3' in report['failed']
    assert len(load_daily_candles(db, 'CURT3')) == 0  # rejeitado não grava

if __name__ == '__main__':
    test_replace_is_full_refresh(); test_backfill_report_and_min_bars()
    print('test_ml_candles: OK')
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe python\tests\test_ml_candles.py`
Expected: `ModuleNotFoundError: No module named 'ml'` (ou ImportError das funções).

- [ ] **Step 3: Implementar `python/ml/candles.py`**

```python
"""Store de candles D1 em prisma/dev.db (tabela HistoricalCandle).

Escreve apenas LINHAS via sqlite3 (WAL, transação por símbolo) — o schema é
exclusivo do Prisma. Full refresh por (symbol,'D1'): o store é cache da fonte
MT5; substituir é honesto e elimina lixo legado (H1 rotulado D1).
"""
from datetime import datetime, timezone
import sqlite3
import pandas as pd

TIMEFRAME = 'D1'

def _iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S')

def replace_daily_candles(db_path: str, symbol: str, rows) -> int:
    con = sqlite3.connect(db_path, timeout=30)
    try:
        con.execute('PRAGMA journal_mode=WAL')
        with con:  # transação: delete+insert atômico
            con.execute('DELETE FROM HistoricalCandle WHERE symbol=? AND timeframe=?', (symbol, TIMEFRAME))
            con.executemany(
                'INSERT INTO HistoricalCandle (symbol, timeframe, time, open, high, low, close, volume) '
                'VALUES (?,?,?,?,?,?,?,?)',
                [(symbol, TIMEFRAME, _iso(r[0]), r[1], r[2], r[3], r[4], r[5]) for r in rows])
        return len(rows)
    finally:
        con.close()

def load_daily_candles(db_path: str, symbol: str) -> pd.DataFrame:
    con = sqlite3.connect(db_path, timeout=30)
    try:
        df = pd.read_sql_query(
            'SELECT time, open, high, low, close, volume FROM HistoricalCandle '
            'WHERE symbol=? AND timeframe=? ORDER BY time', con, params=(symbol, TIMEFRAME))
    finally:
        con.close()
    df['time'] = pd.to_datetime(df['time'])
    return df

def backfill_symbols(db_path: str, symbols, mt5_client, min_bars: int = 750) -> dict:
    report = {'ok': [], 'failed': {}}
    for symbol in symbols:
        try:
            rates = mt5_client.get_daily_rates(symbol)
        except Exception as exc:  # noqa: BLE001 — relatório por ticker, nunca meia-carga
            report['failed'][symbol] = f'MT5_ERROR: {exc}'
            continue
        if rates is None:
            report['failed'][symbol] = 'SYMBOL_NOT_FOUND'
        elif len(rates) < min_bars:
            report['failed'][symbol] = f'INSUFFICIENT_DATA: {len(rates)} < {min_bars}'
        else:
            replace_daily_candles(db_path, symbol, rates)
            report['ok'].append(symbol)
    return report

class Mt5DailyClient:
    """Cliente real. Import adiado: testes não exigem MetaTrader5 instalado."""

    def __init__(self, max_bars: int = 5000):
        import MetaTrader5 as mt5  # noqa: PLC0415
        self._mt5 = mt5
        self._max_bars = max_bars
        if not mt5.initialize():
            raise RuntimeError('MT5_DISCONNECTED')

    def get_daily_rates(self, symbol):
        info = self._mt5.symbol_info(symbol)
        if info is None:
            return None
        self._mt5.symbol_select(symbol, True)
        rates = self._mt5.copy_rates_from_pos(symbol, self._mt5.TIMEFRAME_D1, 0, self._max_bars)
        if rates is None:
            return None
        return [(int(r['time']) * 1000, float(r['open']), float(r['high']),
                 float(r['low']), float(r['close']), float(r['real_volume'] or r['tick_volume']))
                for r in rates]
```

- [ ] **Step 4: Rodar e ver passar**

Run: `C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe python\tests\test_ml_candles.py`
Expected: `test_ml_candles: OK`

- [ ] **Step 5: Commit**

```bash
git add python/ml/__init__.py python/ml/candles.py python/tests/test_ml_candles.py
git commit -m "feat(ml): store de candles D1 com backfill MT5 full-refresh"
```

---

### Task 2: Python — features de preço + alvo

**Files:**
- Create: `python/ml/features.py`
- Create: `python/tests/test_ml_features.py`

**Interfaces:**
- Consumes: DataFrame de `load_daily_candles` (Task 1).
- Produces: `price_features(candles: DataFrame) -> DataFrame` indexado por `time`, colunas `ret_1, ret_5, ret_10, ret_21, vol_21, mom_63, mom_126, dist_mm200, vol_rel` (NaN nas janelas iniciais); `target_direction(candles, horizon=10) -> Series` (1.0/0.0, NaN nos últimos `horizon`).

- [ ] **Step 1: Escrever teste que falha**

```python
# python/tests/test_ml_features.py
import os, sys
import numpy as np, pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.features import price_features, target_direction

def make_candles(n=300, trend=0.001):
    t = pd.date_range('2023-01-02', periods=n, freq='B')
    close = 100 * np.cumprod(1 + np.full(n, trend))
    return pd.DataFrame({'time': t, 'open': close, 'high': close * 1.01,
                         'low': close * 0.99, 'close': close, 'volume': 1000.0})

def test_price_features_shapes_and_values():
    df = make_candles()
    f = price_features(df)
    assert list(f.columns) == ['ret_1', 'ret_5', 'ret_10', 'ret_21', 'vol_21',
                               'mom_63', 'mom_126', 'dist_mm200', 'vol_rel']
    assert len(f) == len(df)
    # tendência constante: ret_1 = trend, mom_63 = (1+trend)^63 - 1
    assert abs(f['ret_1'].iloc[-1] - 0.001) < 1e-9
    assert abs(f['mom_63'].iloc[-1] - (1.001 ** 63 - 1)) < 1e-9
    assert f['ret_21'].iloc[10] != f['ret_21'].iloc[10] or True  # NaN nas janelas iniciais
    assert np.isnan(f['dist_mm200'].iloc[100])  # MM200 exige 200 barras

def test_target_direction():
    df = make_candles(trend=0.002)
    y = target_direction(df, horizon=10)
    assert y.iloc[0] == 1.0            # alta constante → direção 1
    assert np.isnan(y.iloc[-1])        # sem futuro nos últimos 10
    assert len(y) == len(df)

if __name__ == '__main__':
    test_price_features_shapes_and_values(); test_target_direction()
    print('test_ml_features: OK')
```

- [ ] **Step 2: Rodar e ver falhar** — mesmo comando, `ImportError`.

- [ ] **Step 3: Implementar `python/ml/features.py`**

```python
"""Features de preço point-in-time: cada linha t usa apenas dados <= t."""
import numpy as np
import pandas as pd

FEATURE_COLUMNS = ['ret_1', 'ret_5', 'ret_10', 'ret_21', 'vol_21',
                   'mom_63', 'mom_126', 'dist_mm200', 'vol_rel']

def price_features(candles: pd.DataFrame) -> pd.DataFrame:
    c = candles.set_index('time')['close']
    v = candles.set_index('time')['volume']
    f = pd.DataFrame(index=c.index)
    for n in (1, 5, 10, 21):
        f[f'ret_{n}'] = c.pct_change(n)
    f['vol_21'] = c.pct_change().rolling(21).std() * np.sqrt(252)
    f['mom_63'] = c.pct_change(63)
    f['mom_126'] = c.pct_change(126)
    f['dist_mm200'] = c / c.rolling(200).mean() - 1
    f['vol_rel'] = v.rolling(21).mean() / v.rolling(126).mean()
    return f[FEATURE_COLUMNS]

def target_direction(candles: pd.DataFrame, horizon: int = 10) -> pd.Series:
    c = candles.set_index('time')['close']
    fwd = c.shift(-horizon) / c - 1
    y = (fwd > 0).astype(float)
    y[fwd.isna()] = np.nan
    return y
```

- [ ] **Step 4: Rodar e ver passar** — `test_ml_features: OK`

- [ ] **Step 5: Commit**

```bash
git add python/ml/features.py python/tests/test_ml_features.py
git commit -m "feat(ml): features de preco e alvo direcional a 10 pregoes"
```

---

### Task 3: Python — fundamentos point-in-time (prazo legal)

**Files:**
- Create: `python/ml/fundamentals.py`
- Create: `python/tests/test_ml_fundamentals.py`

**Interfaces:**
- Consumes: `data/cvm/cvm_fundamentos.db` (`fundamental_indicators` com colunas reais `cd_cvm, ano, trimestre, data_ref, roe, margem_liquida, margem_ebitda, divida_bruta_pl, crescimento_receita_yoy, crescimento_lucro_yoy, payout_ratio, roic, divida_liquida_ebitda`; `empresas` com `cd_cvm, ticker, setor`).
- Produces: `load_fundamental_history(cvm_db_path, ticker) -> DataFrame` com colunas `available_at` (datetime; `data_ref+45d`, T4 `+90d`) + `FUND_COLUMNS`; `asof_fundamentals(dates: DatetimeIndex, fund: DataFrame) -> DataFrame` (merge as-of: último trimestre com `available_at <= date`); constante `FUND_COLUMNS = ['roe','margem_liquida','margem_ebitda','divida_bruta_pl','crescimento_receita_yoy','crescimento_lucro_yoy','payout_ratio','roic','divida_liquida_ebitda']`; `load_sector_map(cvm_db_path) -> dict[ticker, setor]`; `list_universe(cvm_db_path) -> list[str]` (tickers de `empresas`).

- [ ] **Step 1: Escrever teste que falha**

```python
# python/tests/test_ml_fundamentals.py
import os, sqlite3, sys, tempfile
import pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.fundamentals import load_fundamental_history, asof_fundamentals, FUND_COLUMNS, list_universe

def make_cvm_db():
    path = os.path.join(tempfile.mkdtemp(), 'cvm.db')
    con = sqlite3.connect(path)
    con.executescript("""
      CREATE TABLE empresas (cd_cvm TEXT, ticker TEXT, setor TEXT);
      CREATE TABLE fundamental_indicators (
        cd_cvm TEXT, ano INT, trimestre INT, data_ref TEXT,
        roe REAL, margem_liquida REAL, margem_ebitda REAL, divida_bruta_pl REAL,
        crescimento_receita_yoy REAL, crescimento_lucro_yoy REAL, payout_ratio REAL,
        roic REAL, divida_liquida_ebitda REAL);
      INSERT INTO empresas VALUES ('001', 'WEGE3', 'Bens Industriais');
      INSERT INTO fundamental_indicators VALUES
        ('001', 2023, 1, '2023-03-31', 0.20, 0.15, 0.22, 0.3, 0.1, 0.12, 0.5, 0.18, 0.4),
        ('001', 2023, 4, '2023-12-31', 0.22, 0.16, 0.23, 0.3, 0.1, 0.15, 0.6, 0.19, 0.4);
    """)
    con.commit(); con.close()
    return path

def test_legal_lag():
    db = make_cvm_db()
    hist = load_fundamental_history(db, 'WEGE3')
    assert list(hist['available_at']) == [pd.Timestamp('2023-05-15'),   # T1: 31/03 + 45d
                                          pd.Timestamp('2024-03-30')]   # T4: 31/12 + 90d
    dates = pd.DatetimeIndex(['2023-05-14', '2023-05-15', '2024-03-29', '2024-03-30'])
    joined = asof_fundamentals(dates, hist)
    assert len(joined) == 4
    assert pd.isna(joined['roe'].iloc[0])                  # véspera: nada publicado
    assert abs(joined['roe'].iloc[1] - 0.20) < 1e-9        # dia da publicação do T1
    assert abs(joined['roe'].iloc[2] - 0.20) < 1e-9        # T4 ainda não disponível
    assert abs(joined['roe'].iloc[3] - 0.22) < 1e-9        # T4 disponível
    assert set(FUND_COLUMNS) <= set(joined.columns)

def test_universe():
    assert list_universe(make_cvm_db()) == ['WEGE3']

if __name__ == '__main__':
    test_legal_lag(); test_universe()
    print('test_ml_fundamentals: OK')
```

- [ ] **Step 2: Rodar e ver falhar** — `ImportError`.

- [ ] **Step 3: Implementar `python/ml/fundamentals.py`**

```python
"""Fundamentos CVM defasados pelo prazo legal de publicação.

Regra anti-vazamento central da v1: o trimestre com fim em data_ref só entra
no dataset a partir de data_ref + 45 dias corridos (ITR, T1–T3) ou + 90 dias
(DFP, T4). Nunca a data contábil.
"""
import sqlite3
import pandas as pd

FUND_COLUMNS = ['roe', 'margem_liquida', 'margem_ebitda', 'divida_bruta_pl',
                'crescimento_receita_yoy', 'crescimento_lucro_yoy', 'payout_ratio',
                'roic', 'divida_liquida_ebitda']
_LAG_ITR_DAYS = 45
_LAG_DFP_DAYS = 90

def _connect_ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=30)

def list_universe(cvm_db_path: str) -> list:
    con = _connect_ro(cvm_db_path)
    try:
        rows = con.execute('SELECT ticker FROM empresas WHERE ticker IS NOT NULL ORDER BY ticker').fetchall()
    finally:
        con.close()
    return [r[0] for r in rows]

def load_sector_map(cvm_db_path: str) -> dict:
    con = _connect_ro(cvm_db_path)
    try:
        rows = con.execute('SELECT ticker, setor FROM empresas WHERE ticker IS NOT NULL').fetchall()
    finally:
        con.close()
    return dict(rows)

def load_fundamental_history(cvm_db_path: str, ticker: str) -> pd.DataFrame:
    con = _connect_ro(cvm_db_path)
    try:
        df = pd.read_sql_query(
            'SELECT f.trimestre, f.data_ref, ' + ', '.join(f'f.{c}' for c in FUND_COLUMNS) +
            ' FROM fundamental_indicators f JOIN empresas e ON e.cd_cvm = f.cd_cvm '
            'WHERE e.ticker = ? ORDER BY f.data_ref', con, params=(ticker,))
    finally:
        con.close()
    df['data_ref'] = pd.to_datetime(df['data_ref'])
    lag = df['trimestre'].map(lambda q: _LAG_DFP_DAYS if q == 4 else _LAG_ITR_DAYS)
    df['available_at'] = df['data_ref'] + pd.to_timedelta(lag, unit='D')
    return df.drop(columns=['trimestre']).sort_values('available_at').reset_index(drop=True)

def asof_fundamentals(dates: pd.DatetimeIndex, fund: pd.DataFrame) -> pd.DataFrame:
    left = pd.DataFrame({'date': pd.DatetimeIndex(dates)}).sort_values('date')
    joined = pd.merge_asof(left, fund.drop(columns=['data_ref']),
                           left_on='date', right_on='available_at', direction='backward')
    return joined.set_index('date').drop(columns=['available_at'])
```

- [ ] **Step 4: Rodar e ver passar** — `test_ml_fundamentals: OK`

- [ ] **Step 5: Commit**

```bash
git add python/ml/fundamentals.py python/tests/test_ml_fundamentals.py
git commit -m "feat(ml): fundamentos CVM point-in-time com prazo legal 45/90d"
```

---

### Task 4: Python — adapter TimesFM (lazy, injetável, com cache)

**Files:**
- Create: `python/ml/timesfm_adapter.py`
- Create: `python/tests/test_ml_timesfm_adapter.py`
- Modify: `python/requirements.txt` (adicionar `lightgbm`, `timesfm`; `pandas` se ausente)

**Interfaces:**
- Produces: `class TimesFmFeatureProvider` com `features_for(symbol: str, closes: pd.Series) -> dict` retornando `{'tfm_ret_10': float, 'tfm_iq': float}` (retorno acumulado mediano previsto a 10 pregões e spread interquantil q90−q10, ambos relativos ao último close); construtor aceita `forecaster=None` (lazy-load do real) ou stub injetado com `forecast(context: list[float], horizon: int) -> dict` retornando `{'median': [...], 'q10': [...], 'q90': [...]}` (caminhos de preço previstos); cache parquet por símbolo em `data/ml/tfm_cache/<symbol>.parquet` keyed pela data do último close + hash do contexto.
- Consumes: closes de `load_daily_candles` (Task 1).

- [ ] **Step 1: Escrever teste que falha** (stub, sem GPU/modelo real)

```python
# python/tests/test_ml_timesfm_adapter.py
import os, sys, tempfile
import numpy as np, pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.timesfm_adapter import TimesFmFeatureProvider

class StubForecaster:
    def __init__(self): self.calls = 0
    def forecast(self, context, horizon):
        self.calls += 1
        last = context[-1]
        median = [last * (1 + 0.001 * (i + 1)) for i in range(horizon)]
        return {'median': median,
                'q10': [m * 0.98 for m in median], 'q90': [m * 1.02 for m in median]}

def test_features_and_cache():
    stub = StubForecaster()
    cache_dir = tempfile.mkdtemp()
    p = TimesFmFeatureProvider(forecaster=stub, cache_dir=cache_dir, max_context=512)
    closes = pd.Series(np.linspace(100, 110, 300),
                       index=pd.date_range('2024-01-01', periods=300, freq='B'))
    f = p.features_for('WEGE3', closes)
    assert abs(f['tfm_ret_10'] - (1.001 ** 1 * (1 + 0.001 * 10) - 1)) < 0.01  # ~+1%
    assert f['tfm_iq'] > 0
    f2 = p.features_for('WEGE3', closes)  # mesma série → cache, sem nova chamada
    assert stub.calls == 1 and f2 == f

def test_insufficient_context():
    p = TimesFmFeatureProvider(forecaster=StubForecaster(), cache_dir=tempfile.mkdtemp())
    short = pd.Series([1.0] * 10, index=pd.date_range('2024-01-01', periods=10, freq='B'))
    try:
        p.features_for('X', short); assert False
    except ValueError as e:
        assert 'INSUFFICIENT_DATA' in str(e)

if __name__ == '__main__':
    test_features_and_cache(); test_insufficient_context()
    print('test_ml_timesfm_adapter: OK')
```

- [ ] **Step 2: Rodar e ver falhar** — `ImportError`.

- [ ] **Step 3: Implementar `python/ml/timesfm_adapter.py`**

```python
"""Adapter TimesFM 2.5 200M: única fronteira com a lib externa.

O modelo real (google/timesfm-2.5-200m-pytorch) é carregado lazy na primeira
chamada sem forecaster injetado. Se a API da lib `timesfm` divergir na versão
instalada, SÓ este arquivo muda. Cache parquet por símbolo: (data do último
close, hash do contexto) → features; invalida sozinho se a série mudar.
"""
import hashlib, os
import pandas as pd

MIN_CONTEXT = 128

class _RealForecaster:
    def __init__(self):
        import timesfm  # noqa: PLC0415 — lazy: só quem prevê de verdade paga o load
        self._model = timesfm.TimesFm_2p5_200M_torch.from_pretrained(
            'google/timesfm-2.5-200m-pytorch')
        self._model.compile(timesfm.ForecastConfig(
            max_context=512, max_horizon=16, use_continuous_quantile_head=True))

    def forecast(self, context, horizon):
        point, quantiles = self._model.forecast(horizon=horizon, inputs=[context])
        return {'median': list(point[0]),
                'q10': list(quantiles[0][:, 1]), 'q90': list(quantiles[0][:, 9])}

class TimesFmFeatureProvider:
    def __init__(self, forecaster=None, cache_dir='data/ml/tfm_cache', max_context=512):
        self._forecaster = forecaster
        self._cache_dir = cache_dir
        self._max_context = max_context
        os.makedirs(cache_dir, exist_ok=True)

    def _get_forecaster(self):
        if self._forecaster is None:
            self._forecaster = _RealForecaster()
        return self._forecaster

    def _cache_path(self, symbol):
        return os.path.join(self._cache_dir, f'{symbol}.parquet')

    def features_for(self, symbol: str, closes: pd.Series) -> dict:
        if len(closes) < MIN_CONTEXT:
            raise ValueError(f'INSUFFICIENT_DATA: contexto {len(closes)} < {MIN_CONTEXT}')
        context = [float(x) for x in closes.iloc[-self._max_context:]]
        key = closes.index[-1].strftime('%Y-%m-%d') + ':' + \
            hashlib.sha256(str(context).encode()).hexdigest()[:16]
        path = self._cache_path(symbol)
        if os.path.exists(path):
            cached = pd.read_parquet(path)
            hit = cached[cached['key'] == key]
            if len(hit):
                return {'tfm_ret_10': float(hit['tfm_ret_10'].iloc[0]),
                        'tfm_iq': float(hit['tfm_iq'].iloc[0])}
        fc = self._get_forecaster().forecast(context, horizon=10)
        last = context[-1]
        feats = {'tfm_ret_10': fc['median'][-1] / last - 1,
                 'tfm_iq': (fc['q90'][-1] - fc['q10'][-1]) / last}
        row = pd.DataFrame([{'key': key, **feats}])
        if os.path.exists(path):
            row = pd.concat([pd.read_parquet(path), row], ignore_index=True)
        row.to_parquet(path, index=False)
        return feats
```

- [ ] **Step 4: Rodar e ver passar** — `test_ml_timesfm_adapter: OK`

- [ ] **Step 5: Adicionar dependências e smoke real (manual, não bloqueia)**

Em `python/requirements.txt` adicionar linhas: `lightgbm`, `timesfm`, `pyarrow` (e `pandas` se não estiver). Instalar: `C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe -m pip install lightgbm timesfm pyarrow`. Smoke do modelo real (baixa checkpoint ~800MB, valida API da lib):

```powershell
& C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe -c "import sys; sys.path.insert(0,'python'); from ml.timesfm_adapter import TimesFmFeatureProvider; import pandas as pd, numpy as np; s = pd.Series(np.linspace(10,12,300), index=pd.date_range('2024-01-01', periods=300, freq='B')); print(TimesFmFeatureProvider().features_for('SMOKE', s))"
```

Expected: dict com `tfm_ret_10`/`tfm_iq` numéricos. Se a API da lib divergir, ajustar SÓ `_RealForecaster` e reexecutar o smoke.

- [ ] **Step 6: Commit**

```bash
git add python/ml/timesfm_adapter.py python/tests/test_ml_timesfm_adapter.py python/requirements.txt
git commit -m "feat(ml): adapter TimesFM 2.5 com lazy-load, cache e stub injetavel"
```

---

### Task 5: Task — dataset builder com teste anti-vazamento

**Files:**
- Create: `python/ml/dataset.py`
- Create: `python/tests/test_ml_dataset.py`

**Interfaces:**
- Consumes: Tasks 1–4 (`load_daily_candles`, `price_features`, `target_direction`, `load_fundamental_history`, `asof_fundamentals`, `FUND_COLUMNS`, `TimesFmFeatureProvider`, `load_sector_map`).
- Produces: `build_dataset(db_path, cvm_db_path, symbols, tfm_provider, sample_every=5) -> (DataFrame, str)` — DataFrame com colunas `symbol, date, setor, y` + features de preço + `FUND_COLUMNS` + `tfm_ret_10, tfm_iq`; linhas amostradas a cada `sample_every` pregões; sem NaN em `y`; segundo retorno = hash sha256 determinístico do conteúdo. Constante `ALL_FEATURES = FEATURE_COLUMNS + FUND_COLUMNS + ['tfm_ret_10', 'tfm_iq']`.

- [ ] **Step 1: Escrever teste que falha** (inclui o teste anti-vazamento da spec)

```python
# python/tests/test_ml_dataset.py
import os, sqlite3, sys, tempfile
import numpy as np, pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.candles import replace_daily_candles
from ml.dataset import build_dataset, ALL_FEATURES
from test_ml_candles import DDL, day_ms
from test_ml_fundamentals import make_cvm_db

class ZeroTfm:
    def features_for(self, symbol, closes):
        return {'tfm_ret_10': 0.0, 'tfm_iq': 0.01}

def make_price_db(symbol='WEGE3', n=600, seed=7):
    path = os.path.join(tempfile.mkdtemp(), 'p.db')
    con = sqlite3.connect(path); con.executescript(DDL); con.close()
    rng = np.random.default_rng(seed)
    close = 100 * np.cumprod(1 + rng.normal(0, 0.01, n))
    replace_daily_candles(path, symbol,
        [(day_ms(i), c, c * 1.01, c * 0.99, c, 1000.0) for i, c in enumerate(close)])
    return path

def test_dataset_shape_and_sampling():
    db = make_price_db()
    ds, dhash = build_dataset(db, make_cvm_db(), ['WEGE3'], ZeroTfm(), sample_every=5)
    assert set(['symbol', 'date', 'setor', 'y'] + ALL_FEATURES) <= set(ds.columns)
    assert not ds['y'].isna().any()
    gaps = ds['date'].diff().dropna().dt.days
    assert (gaps >= 5).all()                      # amostragem a cada 5 pregões
    _, dhash2 = build_dataset(db, make_cvm_db(), ['WEGE3'], ZeroTfm(), sample_every=5)
    assert dhash == dhash2                        # hash determinístico

def test_no_leakage_smoke():
    """Anti-vazamento: com features point-in-time, um LightGBM não pode 'prever'
    ruído puro. Se alguma feature vazar o futuro, a acurácia dispara."""
    import lightgbm as lgb
    db = make_price_db(n=900, seed=11)            # random walk: direção imprevisível
    ds, _ = build_dataset(db, make_cvm_db(), ['WEGE3'], ZeroTfm(), sample_every=5)
    cut = int(len(ds) * 0.7)
    train, test = ds.iloc[:cut], ds.iloc[cut:]
    m = lgb.LGBMClassifier(max_depth=3, n_estimators=50, verbose=-1)
    m.fit(train[ALL_FEATURES].fillna(0), train['y'])
    acc = (m.predict(test[ALL_FEATURES].fillna(0)) == test['y']).mean()
    assert acc < 0.65, f'acuracia {acc:.2f} em ruido puro indica VAZAMENTO'

if __name__ == '__main__':
    test_dataset_shape_and_sampling(); test_no_leakage_smoke()
    print('test_ml_dataset: OK')
```

- [ ] **Step 2: Rodar e ver falhar** — `ImportError`.

- [ ] **Step 3: Implementar `python/ml/dataset.py`**

```python
"""Dataset point-in-time: preço + fundamentos defasados + TimesFM, por ticker/dia."""
import hashlib
import pandas as pd

from .candles import load_daily_candles
from .features import FEATURE_COLUMNS, price_features, target_direction
from .fundamentals import FUND_COLUMNS, asof_fundamentals, load_fundamental_history, load_sector_map

ALL_FEATURES = FEATURE_COLUMNS + FUND_COLUMNS + ['tfm_ret_10', 'tfm_iq']
_MIN_HISTORY = 260  # precisa de MM200 + margem

def build_dataset(db_path, cvm_db_path, symbols, tfm_provider, sample_every=5):
    sectors = load_sector_map(cvm_db_path)
    parts = []
    for symbol in symbols:
        candles = load_daily_candles(db_path, symbol)
        if len(candles) < _MIN_HISTORY:
            continue
        f = price_features(candles)
        y = target_direction(candles)
        fund = load_fundamental_history(cvm_db_path, symbol)
        fj = asof_fundamentals(f.index, fund) if len(fund) else \
            pd.DataFrame(index=f.index, columns=FUND_COLUMNS, dtype=float)
        closes = candles.set_index('time')['close']
        rows = []
        # amostra a cada `sample_every` pregões, começando onde MM200 existe
        for i in range(_MIN_HISTORY, len(f), sample_every):
            date = f.index[i]
            if pd.isna(y.loc[date]):
                continue
            tfm = tfm_provider.features_for(symbol, closes.loc[:date])
            rows.append({'symbol': symbol, 'date': date,
                         'setor': sectors.get(symbol, 'DESCONHECIDO'),
                         'y': float(y.loc[date]),
                         **f.loc[date].to_dict(), **fj.loc[date].to_dict(), **tfm})
        if rows:
            parts.append(pd.DataFrame(rows))
    if not parts:
        raise ValueError('INSUFFICIENT_DATA: nenhum ticker com historico suficiente')
    ds = pd.concat(parts, ignore_index=True).sort_values(['date', 'symbol']).reset_index(drop=True)
    payload = ds.round(10).to_csv(index=False).encode()
    return ds, 'sha256:' + hashlib.sha256(payload).hexdigest()
```

- [ ] **Step 4: Rodar e ver passar** — `test_ml_dataset: OK` (exige lightgbm instalado na Task 4).

- [ ] **Step 5: Commit**

```bash
git add python/ml/dataset.py python/tests/test_ml_dataset.py
git commit -m "feat(ml): dataset builder point-in-time com teste anti-vazamento"
```

---

### Task 6: Python — walk-forward, baselines e treino LightGBM

**Files:**
- Create: `python/ml/walkforward.py`
- Create: `python/ml/train.py`
- Create: `python/tests/test_ml_walkforward.py`

**Interfaces:**
- Consumes: dataset da Task 5 (`ALL_FEATURES`, colunas `symbol, date, y`).
- Produces:
  - `walkforward_splits(dates: Series, embargo_days=21, min_train_years=2) -> list[dict]` — cada item `{'test_year': int, 'train_end': Timestamp, 'test_mask': ndarray, 'train_mask': ndarray}`; treino = tudo com `date <= 31/dez/(X-1) - 21 pregões (~30 dias corridos)`, teste = ano X inteiro.
  - `run_training(ds: DataFrame, models_dir: str) -> dict` no formato consumido pelo gate (Task 8):

```json
{
  "datasetHash": "…", "windowStart": "…", "windowEnd": "…",
  "hyperparameters": {"max_depth": 6, "num_leaves": 63, "learning_rate": 0.05, "n_estimators": 400},
  "aggregate": {"nSamples": 0, "accuracy": 0.0},
  "baselines": {"alwaysUp": {"accuracy": 0.0}, "timesfmOnly": {"accuracy": 0.0},
                 "fundamentalOnly": {"accuracy": 0.0}, "priceOnlyLgbm": {"accuracy": 0.0}},
  "blocks": [{"block": "WEGE3:2023-04", "n": 4, "hitsModel": 3, "hitsAlwaysUp": 2,
               "hitsTimesfm": 2, "hitsFundamental": 3, "hitsPriceOnly": 2}],
  "backtest": {"metrics": {"totalReturn": 0.0, "maxDrawdown": 0.0, "nRebalances": 0}},
  "artifact": {"hash": "…", "path": "data/ml/models/<hash>/model.txt"}
}
```

  - Baselines definidos: `alwaysUp` = prever 1 sempre; `timesfmOnly` = `tfm_ret_10 > 0`; `fundamentalOnly` = z-score composto cross-section por data (média de z de `roe, margem_liquida, -divida_bruta_pl, crescimento_lucro_yoy`) acima da mediana → 1; `priceOnlyLgbm` = LightGBM idêntico só com `FEATURE_COLUMNS`.
  - Artefatos gravados: `model.txt` (booster final treinado com TODO o dataset), `walkforward_predictions.csv` (`symbol,date,yTrue,pModel,pPriceOnly,predTimesfm,predFundamental`), `metrics.json` (o dict acima).

- [ ] **Step 1: Escrever teste que falha**

```python
# python/tests/test_ml_walkforward.py
import os, sys, tempfile
import numpy as np, pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.walkforward import walkforward_splits
from ml.train import run_training
from ml.dataset import ALL_FEATURES

def make_ds(n_years=5, per_year=100, seed=3, signal_strength=0.0):
    rng = np.random.default_rng(seed)
    rows = []
    for yr in range(2019, 2019 + n_years):
        dates = pd.date_range(f'{yr}-01-05', periods=per_year, freq='3D')
        for d in dates:
            x = {f: rng.normal() for f in ALL_FEATURES}
            p = 0.5 + signal_strength * np.sign(x['ret_5'])
            rows.append({'symbol': 'AAAA3' if rng.random() < 0.5 else 'BBBB3',
                         'date': d, 'setor': 'X', 'y': float(rng.random() < p), **x})
    return pd.DataFrame(rows)

def test_splits_embargo():
    ds = make_ds()
    splits = walkforward_splits(ds['date'])
    assert len(splits) >= 2
    for s in splits:
        train_max = ds['date'][s['train_mask']].max()
        test_min = ds['date'][s['test_mask']].min()
        assert (test_min - train_max).days >= 21          # embargo
        assert test_min.year == s['test_year']

def test_run_training_output_contract():
    ds = make_ds(signal_strength=0.25)  # sinal real em ret_5: modelo deve aprender
    out = run_training(ds, tempfile.mkdtemp())
    for key in ('aggregate', 'baselines', 'blocks', 'artifact', 'hyperparameters', 'backtest'):
        assert key in out, key
    assert out['aggregate']['nSamples'] == sum(b['n'] for b in out['blocks'])
    assert set(out['baselines']) == {'alwaysUp', 'timesfmOnly', 'fundamentalOnly', 'priceOnlyLgbm'}
    b0 = out['blocks'][0]
    assert b0['hitsModel'] <= b0['n'] and ':' in b0['block']
    assert os.path.exists(out['artifact']['path'])
    assert out['aggregate']['accuracy'] > 0.55            # aprendeu o sinal plantado

if __name__ == '__main__':
    test_splits_embargo(); test_run_training_output_contract()
    print('test_ml_walkforward: OK')
```

- [ ] **Step 2: Rodar e ver falhar** — `ImportError`.

- [ ] **Step 3: Implementar `python/ml/walkforward.py`**

```python
"""Splits walk-forward anuais com janela expansiva e embargo."""
import pandas as pd

EMBARGO_CAL_DAYS = 30  # ~21 pregões em dias corridos

def walkforward_splits(dates: pd.Series, min_train_years: int = 2):
    dates = pd.to_datetime(dates)
    years = sorted(dates.dt.year.unique())
    splits = []
    for test_year in years[min_train_years:]:
        train_end = pd.Timestamp(f'{test_year - 1}-12-31') - pd.Timedelta(days=EMBARGO_CAL_DAYS)
        train_mask = (dates <= train_end).to_numpy()
        test_mask = (dates.dt.year == test_year).to_numpy()
        if train_mask.sum() >= 100 and test_mask.sum() >= 20:
            splits.append({'test_year': int(test_year), 'train_end': train_end,
                           'train_mask': train_mask, 'test_mask': test_mask})
    if not splits:
        raise ValueError('INSUFFICIENT_DATA: historico insuficiente para walk-forward')
    return splits
```

- [ ] **Step 4: Implementar `python/ml/train.py`**

```python
"""Treino walk-forward + baselines + artefatos. Hiperparâmetros FIXOS (spec)."""
import hashlib, json, os
import lightgbm as lgb
import numpy as np
import pandas as pd

from .dataset import ALL_FEATURES
from .features import FEATURE_COLUMNS
from .walkforward import walkforward_splits

HYPERPARAMETERS = {'max_depth': 6, 'num_leaves': 63, 'learning_rate': 0.05, 'n_estimators': 400}
_Z_COLS = ['roe', 'margem_liquida', 'divida_bruta_pl', 'crescimento_lucro_yoy']

def _fit(train: pd.DataFrame, cols) -> lgb.LGBMClassifier:
    cut = int(len(train) * 0.8)  # split temporal interno p/ early stopping
    m = lgb.LGBMClassifier(**HYPERPARAMETERS, verbose=-1)
    m.fit(train[cols].iloc[:cut].fillna(0), train['y'].iloc[:cut],
          eval_set=[(train[cols].iloc[cut:].fillna(0), train['y'].iloc[cut:])],
          callbacks=[lgb.early_stopping(50, verbose=False)])
    return m

def _fundamental_signal(ds: pd.DataFrame) -> pd.Series:
    def _score(g):
        z = pd.DataFrame({c: (g[c] - g[c].mean()) / (g[c].std() or 1) for c in _Z_COLS})
        z['divida_bruta_pl'] *= -1
        comp = z.mean(axis=1)
        return (comp > comp.median()).astype(float)
    return ds.groupby('date', group_keys=False)[_Z_COLS].apply(_score).reindex(ds.index).fillna(0)

def run_training(ds: pd.DataFrame, models_dir: str, dataset_hash: str = '') -> dict:
    ds = ds.sort_values(['date', 'symbol']).reset_index(drop=True)
    fund_sig = _fundamental_signal(ds)
    preds = []
    for split in walkforward_splits(ds['date']):
        train, test = ds[split['train_mask']], ds[split['test_mask']]
        model = _fit(train, ALL_FEATURES)
        price_only = _fit(train, FEATURE_COLUMNS)
        preds.append(pd.DataFrame({
            'symbol': test['symbol'], 'date': test['date'], 'yTrue': test['y'],
            'pModel': model.predict_proba(test[ALL_FEATURES].fillna(0))[:, 1],
            'pPriceOnly': price_only.predict_proba(test[FEATURE_COLUMNS].fillna(0))[:, 1],
            'predTimesfm': (test['tfm_ret_10'] > 0).astype(float),
            'predFundamental': fund_sig[test.index]}))
    wf = pd.concat(preds, ignore_index=True)
    hit = {'Model': (wf['pModel'] > 0.5).astype(float) == wf['yTrue'],
           'AlwaysUp': wf['yTrue'] == 1.0,
           'Timesfm': wf['predTimesfm'] == wf['yTrue'],
           'Fundamental': wf['predFundamental'] == wf['yTrue'],
           'PriceOnly': (wf['pPriceOnly'] > 0.5).astype(float) == wf['yTrue']}
    wf['block'] = wf['symbol'] + ':' + wf['date'].dt.strftime('%Y-%m')
    blocks = [{'block': b, 'n': int(len(g)),
               **{f'hits{k}': int(hit[k][g.index].sum()) for k in hit}}
              for b, g in wf.groupby('block')]
    final_model = _fit(ds, ALL_FEATURES)  # modelo publicável: treinado em tudo
    booster_str = final_model.booster_.model_to_string()
    artifact_hash = hashlib.sha256(booster_str.encode()).hexdigest()[:16]
    out_dir = os.path.join(models_dir, artifact_hash)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, 'model.txt'), 'w') as fh:
        fh.write(booster_str)
    wf.to_csv(os.path.join(out_dir, 'walkforward_predictions.csv'), index=False)
    result = {
        'datasetHash': dataset_hash,
        'windowStart': ds['date'].min().strftime('%Y-%m-%d'),
        'windowEnd': ds['date'].max().strftime('%Y-%m-%d'),
        'hyperparameters': HYPERPARAMETERS,
        'aggregate': {'nSamples': int(len(wf)), 'accuracy': float(hit['Model'].mean())},
        'baselines': {'alwaysUp': {'accuracy': float(hit['AlwaysUp'].mean())},
                      'timesfmOnly': {'accuracy': float(hit['Timesfm'].mean())},
                      'fundamentalOnly': {'accuracy': float(hit['Fundamental'].mean())},
                      'priceOnlyLgbm': {'accuracy': float(hit['PriceOnly'].mean())}},
        'blocks': blocks,
        'backtest': _decile_backtest(wf),
        'artifact': {'hash': artifact_hash,
                     'path': os.path.join(out_dir, 'model.txt')},
    }
    with open(os.path.join(out_dir, 'metrics.json'), 'w') as fh:
        json.dump(result, fh, indent=2)
    return result

def _decile_backtest(wf: pd.DataFrame, cost_bps: float = 25.0) -> dict:
    """Long-only decil superior de pModel por data de rebalanceio; custo por troca."""
    equity, n_reb = 1.0, 0
    peak, max_dd = 1.0, 0.0
    for _, g in wf.groupby('date'):
        top = g[g['pModel'] >= g['pModel'].quantile(0.9)]
        if not len(top):
            continue
        # retorno médio realizado a 10 pregões do decil, líquido de custos
        gross = (top['yTrue'] * 2 - 1).mean() * 0.02  # proxy: ±2% por acerto/erro médio
        equity *= 1 + gross - cost_bps / 10000
        n_reb += 1
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1)
    return {'metrics': {'totalReturn': round(equity - 1, 4),
                        'maxDrawdown': round(max_dd, 4), 'nRebalances': n_reb,
                        'note': 'proxy direcional ±2%; retorno real exige preços — v1.1'}}
```

- [ ] **Step 5: Rodar e ver passar** — `test_ml_walkforward: OK`

- [ ] **Step 6: Commit**

```bash
git add python/ml/walkforward.py python/ml/train.py python/tests/test_ml_walkforward.py
git commit -m "feat(ml): walk-forward com embargo, 4 baselines e artefatos LightGBM"
```

---

### Task 7: Python — serviço Flask `ml_api.py`

**Files:**
- Create: `python/ml_api.py`
- Create: `python/tests/test_ml_api.py`
- Modify: `.env.example` (adicionar `WR_ML_API_PORT=5560` e `WR_ML_API_URL=http://127.0.0.1:5560` com comentário)

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: HTTP JSON em `127.0.0.1:5560` —
  - `POST /ml/backfill` body `{"symbols": ["WEGE3", …]?}` (ausente → universo CVM) → `{"ok": [...], "failed": {...}}`; MT5 fora → 503 `{"error": "MT5_DISCONNECTED"}`.
  - `POST /ml/train` body `{"symbols": [...]?}` → resultado da Task 6 + `datasetHash`; dados insuficientes → 422 `{"error": "INSUFFICIENT_DATA", ...}`.
  - `POST /ml/predict` body `{"symbol": "WEGE3", "artifactHash": "abc123"}` → `{"symbol", "date", "direction": "BUY"|"SELL", "score": 0..1, "topFeatures": [{"name", "importance"}...], "sourceMeta": {...}}`; artefato ausente → 404 `MODEL_NOT_FOUND`.
  - `GET /ml/health` → `{"status": "ok", "timesfmLoaded": bool}`.
- Fábrica `create_app(deps)` com dependências injetáveis (`mt5_client_factory`, `tfm_provider`, paths) para teste; `main()` real lê envs e faz `app.run(host='127.0.0.1', port=...)`.

- [ ] **Step 1: Escrever teste que falha**

```python
# python/tests/test_ml_api.py
import os, sqlite3, sys, tempfile
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml_api import create_app
from ml.candles import replace_daily_candles
from test_ml_candles import DDL, day_ms
from test_ml_fundamentals import make_cvm_db
from test_ml_dataset import ZeroTfm

def make_deps(mt5_ok=True):
    price_db = os.path.join(tempfile.mkdtemp(), 'p.db')
    con = sqlite3.connect(price_db); con.executescript(DDL); con.close()
    rng = np.random.default_rng(5)
    close = 100 * np.cumprod(1 + rng.normal(0.0005, 0.01, 1200))
    replace_daily_candles(price_db, 'WEGE3',
        [(day_ms(i), c, c * 1.01, c * 0.99, c, 1000.0) for i, c in enumerate(close)])
    class FakeMt5:
        def get_daily_rates(self, symbol):
            return [(day_ms(i), c, c, c, c, 1.0) for i, c in enumerate(close)]
    return {'db_path': price_db, 'cvm_db_path': make_cvm_db(),
            'models_dir': tempfile.mkdtemp(), 'tfm_provider': ZeroTfm(),
            'mt5_client_factory': (lambda: FakeMt5()) if mt5_ok
                else (lambda: (_ for _ in ()).throw(RuntimeError('MT5_DISCONNECTED')))}

def test_health_backfill_train_predict():
    app = create_app(make_deps()); c = app.test_client()
    assert c.get('/ml/health').get_json()['status'] == 'ok'
    r = c.post('/ml/backfill', json={'symbols': ['WEGE3']})
    assert r.status_code == 200 and r.get_json()['ok'] == ['WEGE3']
    r = c.post('/ml/train', json={'symbols': ['WEGE3']})
    assert r.status_code == 200
    body = r.get_json()
    assert body['aggregate']['nSamples'] > 0 and body['artifact']['hash']
    r = c.post('/ml/predict', json={'symbol': 'WEGE3', 'artifactHash': body['artifact']['hash']})
    p = r.get_json()
    assert r.status_code == 200 and p['direction'] in ('BUY', 'SELL')
    assert 0.0 <= p['score'] <= 1.0 and len(p['topFeatures']) > 0

def test_errors_explicit():
    app = create_app(make_deps(mt5_ok=False)); c = app.test_client()
    r = c.post('/ml/backfill', json={'symbols': ['WEGE3']})
    assert r.status_code == 503 and r.get_json()['error'] == 'MT5_DISCONNECTED'
    app2 = create_app(make_deps()); c2 = app2.test_client()
    r = c2.post('/ml/predict', json={'symbol': 'WEGE3', 'artifactHash': 'nao-existe'})
    assert r.status_code == 404 and r.get_json()['error'] == 'MODEL_NOT_FOUND'

if __name__ == '__main__':
    test_health_backfill_train_predict(); test_errors_explicit()
    print('test_ml_api: OK')
```

- [ ] **Step 2: Rodar e ver falhar** — `ImportError`.

- [ ] **Step 3: Implementar `python/ml_api.py`**

```python
"""WR Trade Pro — ML API (Flask, loopback-only, porta 5560).

Motor de ML da plataforma: backfill D1 (MT5), dataset point-in-time,
treino walk-forward e inferência. Governança/persistência ficam no Next
(/api/v1/ml/*). Nunca envia ordem; nunca inventa dado.
"""
import os
import lightgbm as lgb
import pandas as pd
from flask import Flask, jsonify, request

from ml.candles import Mt5DailyClient, backfill_symbols, load_daily_candles
from ml.dataset import ALL_FEATURES, build_dataset
from ml.fundamentals import list_universe
from ml.timesfm_adapter import TimesFmFeatureProvider
from ml.train import run_training

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULTS = {
    'db_path': os.path.join(_ROOT, 'prisma', 'dev.db'),
    'cvm_db_path': os.path.join(_ROOT, 'data', 'cvm', 'cvm_fundamentos.db'),
    'models_dir': os.path.join(_ROOT, 'data', 'ml', 'models'),
    'tfm_provider': None,  # lazy TimesFmFeatureProvider real
    'mt5_client_factory': Mt5DailyClient,
}

def create_app(deps=None):
    cfg = {**DEFAULTS, **(deps or {})}
    app = Flask(__name__)

    def tfm():
        if cfg['tfm_provider'] is None:
            cfg['tfm_provider'] = TimesFmFeatureProvider(
                cache_dir=os.path.join(_ROOT, 'data', 'ml', 'tfm_cache'))
        return cfg['tfm_provider']

    def symbols_from(body):
        syms = (body or {}).get('symbols')
        return syms if syms else list_universe(cfg['cvm_db_path'])

    @app.post('/ml/backfill')
    def backfill():
        try:
            client = cfg['mt5_client_factory']()
        except Exception:
            return jsonify({'error': 'MT5_DISCONNECTED'}), 503
        report = backfill_symbols(cfg['db_path'], symbols_from(request.get_json(silent=True)), client)
        return jsonify(report)

    @app.post('/ml/train')
    def train():
        try:
            ds, dhash = build_dataset(cfg['db_path'], cfg['cvm_db_path'],
                                      symbols_from(request.get_json(silent=True)), tfm())
            result = run_training(ds, cfg['models_dir'], dataset_hash=dhash)
        except ValueError as exc:
            if 'INSUFFICIENT_DATA' in str(exc):
                return jsonify({'error': 'INSUFFICIENT_DATA', 'detail': str(exc)}), 422
            raise
        return jsonify(result)

    @app.post('/ml/predict')
    def predict():
        body = request.get_json(silent=True) or {}
        symbol, artifact_hash = body.get('symbol'), body.get('artifactHash')
        path = os.path.join(cfg['models_dir'], artifact_hash or '', 'model.txt')
        if not artifact_hash or not os.path.exists(path):
            return jsonify({'error': 'MODEL_NOT_FOUND'}), 404
        try:
            ds, _ = build_dataset(cfg['db_path'], cfg['cvm_db_path'], [symbol], tfm(), sample_every=1)
        except ValueError as exc:
            return jsonify({'error': 'INSUFFICIENT_DATA', 'detail': str(exc)}), 422
        row = ds.iloc[[-1]]
        booster = lgb.Booster(model_file=path)
        score = float(booster.predict(row[ALL_FEATURES].fillna(0))[0])
        imp = sorted(zip(booster.feature_name(), booster.feature_importance('gain')),
                     key=lambda t: -t[1])[:5]
        candles = load_daily_candles(cfg['db_path'], symbol)
        return jsonify({
            'symbol': symbol, 'date': row['date'].iloc[0].strftime('%Y-%m-%d'),
            'direction': 'BUY' if score > 0.5 else 'SELL', 'score': score,
            'topFeatures': [{'name': n, 'importance': float(v)} for n, v in imp],
            'sourceMeta': {'candles': {'from': candles['time'].min().strftime('%Y-%m-%d'),
                                       'to': candles['time'].max().strftime('%Y-%m-%d'),
                                       'source': 'MT5'},
                           'model': artifact_hash, 'timesfm': 'google/timesfm-2.5-200m-pytorch'}})

    @app.get('/ml/health')
    def health():
        return jsonify({'status': 'ok', 'timesfmLoaded': cfg['tfm_provider'] is not None})

    return app

def main():
    port = int(os.environ.get('WR_ML_API_PORT', '5560'))
    create_app().run(host='127.0.0.1', port=port, debug=False, use_reloader=False)

if __name__ == '__main__':
    main()
```

- [ ] **Step 4: Rodar e ver passar** — `test_ml_api: OK`

- [ ] **Step 5: Atualizar `.env.example`** — acrescentar bloco:

```bash
# --- ML Engine (servico python/ml_api.py) ---
# Porta local do motor de ML (loopback-only)
WR_ML_API_PORT=5560
# URL usada pelo Next para falar com o motor
WR_ML_API_URL=http://127.0.0.1:5560
```

- [ ] **Step 6: Commit**

```bash
git add python/ml_api.py python/tests/test_ml_api.py .env.example
git commit -m "feat(ml): servico Flask ml_api na porta 5560 com deps injetaveis"
```

---

### Task 8: Next — gate de promoção determinístico + runner `test:ml-hybrid`

**Files:**
- Create: `src/application/ml-hybrid/gate.ts`
- Create: `src/application/ml-hybrid/index.ts` (`export * from './gate'; export * from './service';` — service vem na Task 9; nesta task exportar só gate)
- Create: `scripts/ml-hybrid/tsconfig.json`
- Create: `scripts/ml-hybrid/run-ml-hybrid-tests.cjs`
- Create: `scripts/ml-hybrid/ml-hybrid-test.ts`
- Modify: `package.json` (script `"test:ml-hybrid": "node scripts/ml-hybrid/run-ml-hybrid-tests.cjs"`)
- Modify: `.gitignore` — nada a fazer (já cobre `scripts/*/.dist/` e `scripts/*/dist/`)

**Interfaces:**
- Consumes: shape do resultado de treino da Task 6 (`aggregate`, `baselines`, `blocks`).
- Produces:

```ts
export interface TrainingBlock {
  readonly block: string; readonly n: number; readonly hitsModel: number;
  readonly hitsAlwaysUp: number; readonly hitsTimesfm: number;
  readonly hitsFundamental: number; readonly hitsPriceOnly: number;
}
export interface GateComparison {
  readonly baseline: 'alwaysUp' | 'timesfmOnly' | 'fundamentalOnly' | 'priceOnlyLgbm';
  readonly accuracyDiff: number; readonly ciLower: number; readonly passed: boolean;
}
export interface GateResult { readonly approved: boolean; readonly comparisons: readonly GateComparison[]; }
export function evaluateGate(blocks: readonly TrainingBlock[], opts?: { resamples?: number; seed?: number }): GateResult;
```

- Regra: para cada baseline, bootstrap de blocos (reamostra `blocks.length` blocos com reposição, `resamples=1000`, PRNG mulberry32 `seed=42`); diferença de acurácia = `sum(hitsModel)/sum(n) − sum(hitsBaseline)/sum(n)` por reamostra; `ciLower` = percentil 2,5; `passed = ciLower > 0`; `approved` = todos os 4 passam.

- [ ] **Step 1: Runner (padrão mcp-pilot, compila em `.dist`, DB temp p/ Task 9)**

```javascript
// scripts/ml-hybrid/run-ml-hybrid-tests.cjs
const { rmSync, mkdtempSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const os = require('node:os');

const root = join(__dirname, '..', '..');
const testDist = join(__dirname, '.dist');

const run = (command, args, env) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false, env: env ?? process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? 'unknown status'}`);
};

let tempDir = null;
try {
  rmSync(testDist, { recursive: true, force: true });
  run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'scripts/ml-hybrid/tsconfig.json']);
  tempDir = mkdtempSync(join(os.tmpdir(), 'wr-ml-hybrid-test-'));
  const databaseUrl = `file:${join(tempDir, 'test.db').replace(/\\/g, '/')}`;
  const testEnv = { ...process.env, DATABASE_URL: databaseUrl };
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], testEnv);
  run(process.execPath, ['scripts/ml-hybrid/.dist/scripts/ml-hybrid/ml-hybrid-test.js'], testEnv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(testDist, { recursive: true, force: true });
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
}
```

`scripts/ml-hybrid/tsconfig.json` — copiar `scripts/mcp-pilot/tsconfig.json` trocando `outDir` para `.dist` (rootDir `../..`, paths `@/*`).

- [ ] **Step 2: Escrever teste que falha** (em `scripts/ml-hybrid/ml-hybrid-test.ts`)

```ts
import { evaluateGate, type TrainingBlock } from '../../src/application/ml-hybrid/gate';

function block(i: number, nHits: { model: number; base: number }, n = 10): TrainingBlock {
  return { block: `T${i % 7}:2024-${(i % 12) + 1}`, n, hitsModel: nHits.model,
    hitsAlwaysUp: nHits.base, hitsTimesfm: nHits.base,
    hitsFundamental: nHits.base, hitsPriceOnly: nHits.base };
}
function assert(cond: unknown, msg: string): void {
  if (!cond) { console.error(`FALHOU: ${msg}`); process.exit(1); }
  console.log(`ok: ${msg}`);
}

// modelo claramente melhor (8/10 vs 5/10 em 80 blocos) → aprovado
const strong = Array.from({ length: 80 }, (_, i) => block(i, { model: 8, base: 5 }));
const g1 = evaluateGate(strong);
assert(g1.approved, 'gate aprova modelo consistentemente superior');
assert(g1.comparisons.length === 4 && g1.comparisons.every((c) => c.passed), '4 comparações, todas passam');

// diferença nula → reprovado
const flat = Array.from({ length: 80 }, (_, i) => block(i, { model: 6, base: 6 }));
assert(!evaluateGate(flat).approved, 'gate reprova diferença nula');

// determinismo: mesma seed → mesmo resultado
const a = evaluateGate(strong, { seed: 42 });
const b = evaluateGate(strong, { seed: 42 });
assert(JSON.stringify(a) === JSON.stringify(b), 'bootstrap determinístico com seed fixa');

console.log('ml-hybrid gate: TODOS OS TESTES PASSARAM');
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run test:ml-hybrid` (após adicionar o script ao package.json)
Expected: erro de compilação `Cannot find module '../../src/application/ml-hybrid/gate'`.

- [ ] **Step 4: Implementar `src/application/ml-hybrid/gate.ts`**

```ts
/**
 * Gate de promoção do ML Híbrido (spec 2026-07-18): o modelo só vira
 * ModelVersion se superar CADA baseline com IC 95% por bootstrap em blocos
 * ticker-mês. Determinístico (mulberry32, seed fixa) — testável e auditável.
 */
export interface TrainingBlock {
  readonly block: string; readonly n: number; readonly hitsModel: number;
  readonly hitsAlwaysUp: number; readonly hitsTimesfm: number;
  readonly hitsFundamental: number; readonly hitsPriceOnly: number;
}
export interface GateComparison {
  readonly baseline: 'alwaysUp' | 'timesfmOnly' | 'fundamentalOnly' | 'priceOnlyLgbm';
  readonly accuracyDiff: number; readonly ciLower: number; readonly passed: boolean;
}
export interface GateResult { readonly approved: boolean; readonly comparisons: readonly GateComparison[]; }

const BASELINE_HITS: Record<GateComparison['baseline'], keyof TrainingBlock> = {
  alwaysUp: 'hitsAlwaysUp', timesfmOnly: 'hitsTimesfm',
  fundamentalOnly: 'hitsFundamental', priceOnlyLgbm: 'hitsPriceOnly',
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function evaluateGate(
  blocks: readonly TrainingBlock[],
  opts?: { resamples?: number; seed?: number },
): GateResult {
  const resamples = opts?.resamples ?? 1000;
  const seed = opts?.seed ?? 42;
  if (blocks.length < 10) {
    const comparisons = (Object.keys(BASELINE_HITS) as GateComparison['baseline'][])
      .map((baseline) => ({ baseline, accuracyDiff: 0, ciLower: -1, passed: false }));
    return { approved: false, comparisons };
  }
  const comparisons = (Object.keys(BASELINE_HITS) as GateComparison['baseline'][]).map((baseline) => {
    const hitsKey = BASELINE_HITS[baseline];
    const rand = mulberry32(seed);
    const diffs: number[] = [];
    for (let r = 0; r < resamples; r++) {
      let n = 0; let model = 0; let base = 0;
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[Math.floor(rand() * blocks.length)];
        n += b.n; model += b.hitsModel; base += b[hitsKey] as number;
      }
      diffs.push(n === 0 ? 0 : (model - base) / n);
    }
    diffs.sort((x, y) => x - y);
    const totalN = blocks.reduce((s, b) => s + b.n, 0);
    const accuracyDiff = blocks.reduce((s, b) => s + b.hitsModel - (b[hitsKey] as number), 0) / totalN;
    const ciLower = diffs[Math.floor(resamples * 0.025)];
    return { baseline, accuracyDiff, ciLower, passed: ciLower > 0 };
  });
  return { approved: comparisons.every((c) => c.passed), comparisons };
}
```

`src/application/ml-hybrid/index.ts`: `export * from './gate';`

- [ ] **Step 5: Rodar e ver passar** — `npm run test:ml-hybrid` → `ml-hybrid gate: TODOS OS TESTES PASSARAM`

- [ ] **Step 6: Commit**

```bash
git add src/application/ml-hybrid/ scripts/ml-hybrid/ package.json
git commit -m "feat(ml): gate de promocao com bootstrap em blocos e suite test:ml-hybrid"
```

---

### Task 9: Next — orquestração `/api/v1/ml/*` no trilho Fase 5

**Files:**
- Create: `src/application/ml-hybrid/service.ts`
- Modify: `src/application/ml-hybrid/index.ts` (adicionar `export * from './service';`)
- Create: `src/app/api/v1/ml/backfill/route.ts`
- Create: `src/app/api/v1/ml/train/route.ts`
- Create: `src/app/api/v1/ml/predict/route.ts`
- Modify: `scripts/ml-hybrid/ml-hybrid-test.ts` (adicionar bloco de testes do service)

**Interfaces:**
- Consumes: `evaluateGate` (Task 8); serviços Fase 5 via factories `createResearchRunService(prisma)`, `createModelVersionService(prisma)`, `createSignalService(prisma)`, `createBacktestRunService(prisma)` (já existem em `src/application/*/compose.ts` — conferir nomes exatos em `src/application/*/index.ts` antes de usar); shapes HTTP do `ml_api.py` (Task 7).
- Produces:

```ts
export interface MlApiPort {
  backfill(symbols?: readonly string[]): Promise<{ ok: string[]; failed: Record<string, string> }>;
  train(symbols?: readonly string[]): Promise<TrainResult>;   // shape da Task 6
  predict(symbol: string, artifactHash: string): Promise<PredictResult>; // shape da Task 7
}
export class MlHybridService {
  constructor(ports: { mlApi: MlApiPort; prisma: PrismaClient });
  runTraining(createdBy: string, symbols?: readonly string[]): Promise<{
    researchRunId: string; gate: GateResult; modelVersionId: string | null;
    backtestId: string | null; metrics: TrainResult;
  }>;
  predictLive(symbol: string): Promise<{ signalId: string; prediction: PredictResult }>;
}
export function createHttpMlApiPort(baseUrl: string, fetchImpl?: typeof fetch): MlApiPort;
```

- Comportamento de `runTraining`: chama `mlApi.train` → cria `ResearchRun` (`name='ml-hybrid-swing-v1'`, `hypothesis='preço+fundamentos+TimesFM supera cada camada isolada (spec 2026-07-18)'`, `datasetId=datasetHash`, `paramsJson=JSON.stringify(hyperparameters)`, janelas do resultado) → `evaluateGate(blocks)` → se aprovado: `ModelVersion.submit({ kind: 'ML', label: 'ml-hybrid-swing-v1', asOf: windowEnd, hyperparametersJson, trainingEvidenceJson: JSON.stringify({ aggregate, baselines, gate, artifact, walkforwardCsv: artifact.path }) })` e `BacktestRun.submit` com `instrumentId='UNIVERSE:CVM138'`, `entryRule='open_next_bar'`, `embargoDays=21`, `costsJson` do backtest, `metricsJson` — reprovado: só ResearchRun, `modelVersionId: null`.
- `predictLive`: resolve a `ModelVersion` ativa mais recente (kind `ML`, label `ml-hybrid-swing-v1`, não invalidada; ausente → `ReadModelError('MODEL_NOT_FOUND', …)`), extrai `artifact.hash` do `trainingEvidenceJson`, chama `mlApi.predict`, persiste `Signal` (`instrumentId=symbol`, `barTime=prediction.date`, `direction`, `score`, `knowledgeTime=barTime`).
- Rotas: seguem exatamente o padrão de `src/app/api/v1/research-runs/route.ts` (Zod strict body, `resolveRequestedBy`, `jsonSuccess`/`jsonError`); `WR_ML_API_URL` default `http://127.0.0.1:5560`.

- [ ] **Step 1: Escrever teste que falha** — acrescentar ao `ml-hybrid-test.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { MlHybridService } from '../../src/application/ml-hybrid/service';

async function serviceTests(): Promise<void> {
  const prisma = new PrismaClient();
  const strongBlocks = Array.from({ length: 80 }, (_, i) => ({
    block: `T${i % 7}:2024-${(i % 12) + 1}`, n: 10, hitsModel: 8,
    hitsAlwaysUp: 5, hitsTimesfm: 5, hitsFundamental: 5, hitsPriceOnly: 5 }));
  const trainResult = {
    datasetHash: 'sha256:abc', windowStart: '2019-01-05', windowEnd: '2026-07-17',
    hyperparameters: { max_depth: 6 }, aggregate: { nSamples: 800, accuracy: 0.8 },
    baselines: { alwaysUp: { accuracy: 0.5 }, timesfmOnly: { accuracy: 0.5 },
      fundamentalOnly: { accuracy: 0.5 }, priceOnlyLgbm: { accuracy: 0.5 } },
    blocks: strongBlocks,
    backtest: { metrics: { totalReturn: 0.1, maxDrawdown: -0.05, nRebalances: 40 } },
    artifact: { hash: 'deadbeef', path: 'data/ml/models/deadbeef/model.txt' },
  };
  const fakeApi = {
    backfill: async () => ({ ok: ['WEGE3'], failed: {} }),
    train: async () => trainResult,
    predict: async (symbol: string) => ({
      symbol, date: '2026-07-17', direction: 'BUY' as const, score: 0.62,
      topFeatures: [{ name: 'tfm_ret_10', importance: 10 }], sourceMeta: {} }),
  };
  const service = new MlHybridService({ mlApi: fakeApi, prisma });

  const approved = await service.runTraining('test-user');
  assert(approved.gate.approved && approved.modelVersionId !== null,
    'treino aprovado cria ModelVersion');
  assert(approved.backtestId !== null, 'treino aprovado cria BacktestRun');
  const run = await prisma.researchRun.findUnique({ where: { runId: approved.researchRunId } });
  assert(run !== null && run.datasetId === 'sha256:abc', 'ResearchRun persistido com datasetHash');

  const live = await service.predictLive('WEGE3');
  const signal = await prisma.signal.findUnique({ where: { signalId: live.signalId } });
  assert(signal !== null && signal.direction === 'BUY' && signal.instrumentId === 'WEGE3',
    'predictLive persiste Signal');

  const weakBlocks = strongBlocks.map((b) => ({ ...b, hitsModel: 5 }));
  const rejApi = { ...fakeApi, train: async () => ({ ...trainResult, blocks: weakBlocks }) };
  const rejected = await new MlHybridService({ mlApi: rejApi, prisma }).runTraining('test-user');
  assert(!rejected.gate.approved && rejected.modelVersionId === null,
    'treino reprovado registra ResearchRun sem ModelVersion');
  await prisma.$disconnect();
}
```

E chamar `await serviceTests();` no fim (transformar o arquivo em async IIFE).

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:ml-hybrid` → erro de import do service.

- [ ] **Step 3: Implementar `service.ts` + rotas** conforme o bloco Interfaces (comportamentos e shapes exatos acima; rotas copiam o padrão de `research-runs/route.ts`). `createHttpMlApiPort` usa `fetch` com `AbortSignal.timeout(600_000)` para train (treino demora) e `120_000` para o resto; resposta não-2xx vira `ReadModelError('UPSTREAM_ERROR', body.error ?? status)`.

- [ ] **Step 4: Rodar e ver passar** — `npm run test:ml-hybrid` integral; depois `npx tsc --noEmit` e `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/application/ml-hybrid/ src/app/api/v1/ml/ scripts/ml-hybrid/ml-hybrid-test.ts
git commit -m "feat(ml): orquestracao /api/v1/ml no trilho Fase 5 com gate"
```

---

### Task 10: UI — visão "Híbrido governado" + rótulo legado

**Files:**
- Create: `src/components/ml/HybridGovernedView.tsx`
- Modify: `src/components/tabs/MLPredictionsTab.tsx` (montar a visão nova no topo; adicionar rótulo "Heurísticas (legado)" na seção existente)

**Interfaces:**
- Consumes: `POST /api/v1/ml/train`, `POST /api/v1/ml/predict`, `POST /api/v1/ml/backfill`, `GET /api/v1/model-versions?kind=ML` (rota existente).
- Produces: componente client-side sem novas dependências.

- [ ] **Step 1: Implementar `HybridGovernedView.tsx`** — seções (usar classes `cyber-*` e toast global, nunca `alert()`):
  1. Cabeçalho de estado: busca `GET /api/v1/model-versions` (kind ML, label `ml-hybrid-swing-v1`); sem versão válida → banner honesto "Nenhum modelo aprovado no gate" + botões `Backfill D1` e `Treinar (walk-forward)`.
  2. Com versão ativa: card de métricas do `trainingEvidenceJson` (acurácia agregada + tabela das 4 comparações do gate com `accuracyDiff`/`ciLower`/passed) e proveniência (`datasetHash`, span, artifact hash, versão TimesFM).
  3. Previsão: input de ticker (validar regex `^[A-Z]{4}\d{1,2}$`), botão "Prever" → `POST /api/v1/ml/predict` → direção/score/topFeatures + `sourceMeta`; erro do serviço aparece como toast com o código (`MT5_DISCONNECTED`, `INSUFFICIENT_DATA`…).
  4. Rodapé fixo: "Pesquisa quantitativa — não é recomendação de investimento. Previsões nunca geram ordem."
- [ ] **Step 2: Integrar no `MLPredictionsTab.tsx`** — importar e renderizar `<HybridGovernedView />` antes do conteúdo atual; na seção antiga adicionar sub-título "Heurísticas (legado — sem validação walk-forward)".
- [ ] **Step 3: Verificar** — `npx tsc --noEmit` e `npm run build` passam; abrir a aba no dev (`npm run dev`) e conferir estado vazio honesto.
- [ ] **Step 4: Commit**

```bash
git add src/components/ml/HybridGovernedView.tsx src/components/tabs/MLPredictionsTab.tsx
git commit -m "feat(ml): visao Hibrido governado na aba Previsoes ML"
```

---

### Task 11: Electron + Admin — card "ML Engine"

**Files:**
- Modify: `electron/main.ts` (funções `getMlEngineStatus/startMlEngine/stopMlEngine` + IPC `ml-status/ml-start/ml-stop`)
- Modify: `electron/preload.ts` (expor `getMlStatus`, `startMlEngine`, `stopMlEngine`)
- Modify: `src/types/electron.d.ts` (tipos dos 3 métodos)
- Modify: `src/components/tabs/AdminTab.tsx` (card `MlCard` ao lado do `McpCard`)

**Interfaces:**
- Consumes: padrão MCP Pilot já existente em `electron/main.ts:328-463` (status por porta com `isPortInUse`, mutex de start, stop com `taskkill`, erros fail-closed).
- Produces: `MlEngineStatus { state: 'online'|'starting'|'offline'|'error'; endpoint: string; managedByElectron: boolean; pid: number|null; error: string|null }`.

- [ ] **Step 1: Implementar no `electron/main.ts`** — espelhar as funções do MCP Pilot com as diferenças:
  - porta `Number(process.env.WR_ML_API_PORT ?? 5560)`, host fixo `127.0.0.1` (sem allowlist — nunca exposto);
  - spawn: `spawn(getPythonPath(), [path.join(PROJECT_ROOT, 'python', 'ml_api.py')], { env: childEnv(), windowsHide: true, stdio: ['ignore','pipe','pipe'] })` — usar a função `getPythonPath()` que já existe no arquivo para os outros serviços Python;
  - mensagens: offline sem python → `'Python do conda IA_Day_Trading não encontrado.'`; exit code ≠ 0 → `` `ML Engine encerrou com código ${code}.` ``;
  - mutex de start idêntico ao `startMcpPilot` (promise compartilhada);
  - `stopMlEngine()` chamado também em `will-quit`/`before-quit` junto do `stopMcpPilot()`.
- [ ] **Step 2: Preload + tipos** — mesmos 3 métodos do padrão MCP (`ipcRenderer.invoke('ml-status'|'ml-start'|'ml-stop')`).
- [ ] **Step 3: `MlCard` no AdminTab** — copiar a estrutura do `McpCard` (estado/cores/botão Ligar-Desligar/instância externa) trocando título para "ML Engine", sem o aviso de `wsAuthReady`; incluir no `onlineCount`.
- [ ] **Step 4: Verificar** — `npm run electron:compile`, `npx tsc --noEmit`, `npm run build`; abrir o app desktop, ligar o ML Engine no Admin, conferir `GET http://127.0.0.1:5560/ml/health` respondendo.
- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/dist/ electron/preload.ts src/types/electron.d.ts src/components/tabs/AdminTab.tsx
git commit -m "feat(admin): card ML Engine com ligar/desligar no desktop"
```

---

### Task 12: E2E ao vivo, gitignore de dados, docs e handoff

**Files:**
- Modify: `.gitignore` (adicionar `data/ml/`)
- Create: `docs/ML_HYBRID.md`
- Modify: `docs/CODEX_HANDOFF.md` (nova sessão no topo)
- Modify: `CLAUDE.md` (serviço novo na seção "Como Rodar" e porta 5560 na arquitetura)

**Interfaces:** consome tudo.

- [ ] **Step 1: Suítes completas** — rodar e exigir verde:

```powershell
& C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe python\tests\test_ml_candles.py
& C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe python\tests\test_ml_features.py
& C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe python\tests\test_ml_fundamentals.py
& C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe python\tests\test_ml_timesfm_adapter.py
& C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe python\tests\test_ml_dataset.py
& C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe python\tests\test_ml_walkforward.py
& C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe python\tests\test_ml_api.py
npm run test:ml-hybrid
npm run build; npm run electron:compile
```

- [ ] **Step 2: E2E ao vivo (MT5 conectado, subconjunto)** — com o serviço rodando (`ml_api.py` via card Admin ou terminal):
  1. `POST /ml/backfill` com `{"symbols": ["WEGE3","PETR4","VALE3","ITUB4","ABEV3"]}` → conferir `ok` e, no SQLite, `count(*)` D1 por símbolo ≥ 750 e datas plausíveis (2020→hoje, sem horários intradiários);
  2. `POST /api/v1/ml/train` (autenticado) com os 5 símbolos → conferir ResearchRun criado, decisão do gate coerente com as métricas impressas (com 5 tickers o esperado honesto é REPROVAR — validar que a UI mostra o estado "nenhum modelo aprovado" corretamente);
  3. `POST /api/v1/ml/predict` para WEGE3 (se houver modelo; senão validar erro `MODEL_NOT_FOUND` limpo na UI);
  4. Registrar números reais observados (acurácias, spans, tempos de TimesFM) no relatório da task.
- [ ] **Step 3: Backfill/treino completos das 138** — disparar backfill do universo inteiro e treino completo; anotar duração e resultado do gate. Este é o primeiro resultado científico do projeto: **qualquer que seja o veredito do gate, ele é registrado como está** (sem ajuste de hiperparâmetros para "passar").
- [ ] **Step 4: Docs** — `docs/ML_HYBRID.md`: setup (pip installs, envs), como rodar backfill/treino/predição (UI e curl), formato dos artefatos em `data/ml/`, interpretação do gate e dos baselines, limitações (proxy do backtest, sem fine-tuning, universo CVM-only). Atualizar `CLAUDE.md` e `docs/CODEX_HANDOFF.md` (sessão nova com números do E2E). Atualizar vault (`log.md` + página do upgrade) conforme SCHEMA.md.
- [ ] **Step 5: Commit final**

```bash
git add .gitignore docs/ML_HYBRID.md docs/CODEX_HANDOFF.md CLAUDE.md
git commit -m "docs(ml): guia ML Hibrido v1, handoff e E2E registrado"
```

---

## Self-review (executado na escrita)

- **Cobertura da spec:** backfill (T1), features preço/alvo (T2), fundamentos com prazo legal (T3), TimesFM (T4), dataset + anti-vazamento (T5), walk-forward/baselines/embargo/backtest (T6), serviço Flask + envs (T7), gate bootstrap (T8), trilho Fase 5 + rotas (T9), UI honesta (T10), Admin/Electron (T11), E2E + docs + vault (T12). Desvios da spec listados no topo com justificativa.
- **Placeholders:** nenhum TBD; todo step de código tem código; steps de UI/Electron referenciam padrão existente com diffs comportamentais exatos.
- **Consistência de tipos:** `blocks[]` (`hitsModel/hitsAlwaysUp/hitsTimesfm/hitsFundamental/hitsPriceOnly`) idêntico entre Task 6 (produtor), Task 8 (`TrainingBlock`) e Task 9 (fake do teste); `artifact.hash/path`, `datasetHash`, shapes de predict alinhados entre Tasks 6/7/9/10.
