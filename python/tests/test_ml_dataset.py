import os, sqlite3, sys, tempfile
import numpy as np, pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.bars_snapshot import write_universe_snapshot
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

def snapshot_dir_for(db, symbols):
    """Helper de teste: espelha a ordem obrigatória da spec (snapshot ANTES
    de build_dataset) sem precisar do Flask app inteiro."""
    return write_universe_snapshot(db, symbols, tempfile.mkdtemp())['snapshotDir']

def test_dataset_shape_and_sampling():
    db = make_price_db()
    snap = snapshot_dir_for(db, ['WEGE3'])
    ds, digest = build_dataset(snap, make_cvm_db(), ['WEGE3'], ZeroTfm(), sample_every=5)
    assert set(['symbol', 'date', 'setor', 'y'] + ALL_FEATURES) <= set(ds.columns)
    assert not ds['y'].isna().any()
    gaps = ds['date'].diff().dropna().dt.days
    assert (gaps >= 5).all()                      # amostragem a cada 5 pregões
    _, digest2 = build_dataset(snap, make_cvm_db(), ['WEGE3'], ZeroTfm(), sample_every=5)
    assert digest == digest2                       # hash determinístico
    assert len(digest) == 64 and ':' not in digest  # D-hash: 64 hex, sem prefixo, sem ':'

def test_no_leakage_smoke():
    """Anti-vazamento: com features point-in-time, um LightGBM não pode 'prever'
    ruído puro. Se alguma feature vazar o futuro, a acurácia dispara."""
    import lightgbm as lgb
    db = make_price_db(n=900, seed=11)            # random walk: direção imprevisível
    snap = snapshot_dir_for(db, ['WEGE3'])
    ds, _ = build_dataset(snap, make_cvm_db(), ['WEGE3'], ZeroTfm(), sample_every=5)
    cut = int(len(ds) * 0.7)
    train, test = ds.iloc[:cut], ds.iloc[cut:]
    m = lgb.LGBMClassifier(max_depth=3, n_estimators=50, verbose=-1)
    m.fit(train[ALL_FEATURES].fillna(0), train['y'])
    acc = (m.predict(test[ALL_FEATURES].fillna(0)) == test['y']).mean()
    assert acc < 0.65, f'acuracia {acc:.2f} em ruido puro indica VAZAMENTO'

def test_inference_row_uses_last_candle_not_last_labeled_row():
    """build_dataset descarta as últimas `horizon` barras (sem y); a linha de
    inferência não pode herdar esse atraso — tem que usar a última barra real.
    build_inference_row continua lendo HistoricalCandle AO VIVO (não o
    snapshot) de propósito — a previsão do dia precisa do dado mais recente."""
    db = make_price_db(n=600)
    cvm = make_cvm_db()
    snap = snapshot_dir_for(db, ['WEGE3'])
    ds, _ = build_dataset(snap, cvm, ['WEGE3'], ZeroTfm(), sample_every=1)
    row = build_inference_row(db, cvm, 'WEGE3', ZeroTfm())
    candles = load_daily_candles(db, 'WEGE3')
    assert row['date'].iloc[0] == candles['time'].iloc[-1]
    assert row['date'].iloc[0] > ds['date'].iloc[-1]        # mais recente que o dataset rotulado
    assert set(ALL_FEATURES) <= set(row.columns)
    assert not row[ALL_FEATURES].isna().all(axis=None)

def test_build_dataset_never_reads_historical_candle_live():
    """Item A / D1: build_dataset só aceita snapshot_dir, não db_path — um
    backfill concorrente depois do snapshot não pode mudar o dataset."""
    db = make_price_db(n=600)
    cvm = make_cvm_db()
    snap = snapshot_dir_for(db, ['WEGE3'])
    ds_before, digest_before = build_dataset(snap, cvm, ['WEGE3'], ZeroTfm(), sample_every=5)

    # "backfill concorrente": tabela HistoricalCandle muda depois do snapshot.
    rng = np.random.default_rng(999)
    close = 200 * np.cumprod(1 + rng.normal(0, 0.01, 600))
    replace_daily_candles(db, 'WEGE3',
        [(day_ms(i), c, c * 1.01, c * 0.99, c, 1000.0) for i, c in enumerate(close)])

    ds_after, digest_after = build_dataset(snap, cvm, ['WEGE3'], ZeroTfm(), sample_every=5)
    assert digest_before == digest_after            # dataset ignora o backfill concorrente
    pd.testing.assert_frame_equal(ds_before, ds_after)

def test_build_dataset_missing_snapshot_symbol_is_skipped_not_fatal():
    """Símbolo sem snapshot (nunca teve barra) não derruba o dataset inteiro
    — mesmo padrão de falha por símbolo do resto do pipeline."""
    db = make_price_db(symbol='WEGE3', n=600)
    cvm = make_cvm_db()
    snap = snapshot_dir_for(db, ['WEGE3'])  # só WEGE3 foi snapshotado
    ds, _ = build_dataset(snap, cvm, ['WEGE3', 'ZZZZ9'], ZeroTfm(), sample_every=5)
    assert set(ds['symbol'].unique()) == {'WEGE3'}

if __name__ == '__main__':
    test_dataset_shape_and_sampling(); test_no_leakage_smoke()
    test_inference_row_uses_last_candle_not_last_labeled_row()
    test_build_dataset_never_reads_historical_candle_live()
    test_build_dataset_missing_snapshot_symbol_is_skipped_not_fatal()
    print('test_ml_dataset: OK')
