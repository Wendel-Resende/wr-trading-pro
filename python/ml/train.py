"""Treino walk-forward + baselines + artefatos. Hiperparâmetros FIXOS (spec)."""
import hashlib, json, os
import lightgbm as lgb
import pandas as pd

from .dataset import ALL_FEATURES
from .features import FEATURE_COLUMNS
from .walkforward import walkforward_splits

HYPERPARAMETERS = {'max_depth': 6, 'num_leaves': 63, 'learning_rate': 0.05, 'n_estimators': 400, 'random_state': 42}
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
        'timesfmVersion': 'google/timesfm-2.5-200m-pytorch',
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
        # proxy direcional: ±2% fixo por acerto/erro do decil; retorno real por posição fica na v1.1
        gross = (top['yTrue'] * 2 - 1).mean() * 0.02
        equity *= 1 + gross - cost_bps / 10000
        n_reb += 1
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1)
    return {'metrics': {'totalReturn': round(equity - 1, 4),
                        'maxDrawdown': round(max_dd, 4), 'nRebalances': n_reb,
                        'note': 'proxy direcional ±2%; retorno real exige preços — v1.1'}}
