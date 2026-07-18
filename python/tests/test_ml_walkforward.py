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
