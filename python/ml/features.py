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
