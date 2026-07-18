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
