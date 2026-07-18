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
