import os, sqlite3, sys, tempfile
import numpy as np, pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.candles import replace_daily_candles, load_daily_candles
from ml.dataset import build_dataset, build_inference_row, ALL_FEATURES
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

def test_inference_row_uses_last_candle_not_last_labeled_row():
    """build_dataset descarta as últimas `horizon` barras (sem y); a linha de
    inferência não pode herdar esse atraso — tem que usar a última barra real."""
    db = make_price_db(n=600)
    cvm = make_cvm_db()
    ds, _ = build_dataset(db, cvm, ['WEGE3'], ZeroTfm(), sample_every=1)
    row = build_inference_row(db, cvm, 'WEGE3', ZeroTfm())
    candles = load_daily_candles(db, 'WEGE3')
    assert row['date'].iloc[0] == candles['time'].iloc[-1]
    assert row['date'].iloc[0] > ds['date'].iloc[-1]        # mais recente que o dataset rotulado
    assert set(ALL_FEATURES) <= set(row.columns)
    assert not row[ALL_FEATURES].isna().all(axis=None)

if __name__ == '__main__':
    test_dataset_shape_and_sampling(); test_no_leakage_smoke()
    test_inference_row_uses_last_candle_not_last_labeled_row()
    print('test_ml_dataset: OK')
