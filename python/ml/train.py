"""Treino walk-forward + baselines + artefatos. Hiperparâmetros FIXOS (spec)."""
import hashlib, json, os, shutil, uuid
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

def run_training(ds: pd.DataFrame, models_dir: str, dataset_digest: str = '',
                  universe_bars_digest: str = '', per_symbol_manifest: dict | None = None) -> dict:
    """Treina, avalia walk-forward e persiste artefatos.

    `dataset_digest`: SHA-256 completo (64 hex, SEM prefixo) do dataset
    final (retorno de `build_dataset`). `universe_bars_digest`/
    `per_symbol_manifest`: identificam o snapshot de barras cru já
    congelado ANTES deste dataset ser montado (ver `ml.bars_snapshot`) —
    gravados aqui em `bars_snapshot_manifest.json`, nunca confundidos com
    `dataset_digest` (D-hash, revisão 4 da spec).
    """
    ds = ds.sort_values(['date', 'symbol']).reset_index(drop=True)
    fund_sig = _fundamental_signal(ds)
    preds = []
    for split in walkforward_splits(ds['date']):
        train, test = ds[split['train_mask']], ds[split['test_mask']]
        model = _fit(train, ALL_FEATURES)
        price_only = _fit(train, FEATURE_COLUMNS)
        test_start = test['date'].min().strftime('%Y-%m-%d')
        preds.append(pd.DataFrame({
            'symbol': test['symbol'], 'date': test['date'], 'yTrue': test['y'],
            'pModel': model.predict_proba(test[ALL_FEATURES].fillna(0))[:, 1],
            'pPriceOnly': price_only.predict_proba(test[FEATURE_COLUMNS].fillna(0))[:, 1],
            'predTimesfm': (test['tfm_ret_10'] > 0).astype(float),
            'predFundamental': fund_sig[test.index],
            # metadata de fold auditável por previsão (Item A / D3, D11):
            'foldId': split['fold_id'],
            'trainEnd': split['train_end'].strftime('%Y-%m-%d'),
            'testStart': test_start,
            'embargoCalDays': split['embargo_cal_days']}))
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
    # D-hash (revisão 3): hash completo, sem truncar — 16 hex chars (64 bits)
    # era resistência a colisão fraca demais para um identificador auditável.
    artifact_hash = hashlib.sha256(booster_str.encode()).hexdigest()
    out_dir = os.path.join(models_dir, artifact_hash)
    dataset_hash = f'sha256:{dataset_digest}' if dataset_digest else ''
    result = {
        'datasetHash': dataset_hash,           # identificador SEMÂNTICO (com prefixo) — ResearchRun.datasetId
        'datasetDigest': dataset_digest,        # 64 hex, sem prefixo — nunca usado como path fora daqui
        'universeBarsDigest': universe_bars_digest,  # 64 hex, sem prefixo — identifica o snapshot de barras cru
        'universe': sorted((per_symbol_manifest or {}).keys()),  # símbolos com snapshot válido usado neste treino
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
    manifest = {
        'universeBarsDigest': universe_bars_digest,
        'datasetDigest': dataset_digest,
        'datasetHash': dataset_hash,
        'perSymbol': per_symbol_manifest or {},
    }
    _publish_artifact(models_dir, artifact_hash, booster_str, wf, result, manifest)
    return result

def _publish_artifact(models_dir: str, artifact_hash: str, booster_str: str,
                       wf: pd.DataFrame, result: dict, manifest: dict) -> None:
    """G-003 item 3 (D1/D-hash): publicação do artefato é imutável e atômica.

    Escreve tudo (model.txt, walkforward_predictions.csv, metrics.json,
    bars_snapshot_manifest.json) num diretório provisório único e só então
    publica com um rename atômico para `models_dir/<artifact_hash>/`. Se o
    diretório final já existir — mesmo artifact_hash publicado por um treino
    concorrente ou anterior, possivelmente com proveniência distinta (universo/
    dataset diferentes que coincidentemente produziram o mesmo modelo) —
    NUNCA sobrescreve: descarta o provisório e mantém o que já foi publicado
    primeiro (dedup, primeiro escritor vence), o mesmo padrão já usado em
    `bars_snapshot.write_universe_snapshot`.
    """
    out_dir = os.path.join(models_dir, artifact_hash)
    if os.path.isdir(out_dir):
        return
    os.makedirs(models_dir, exist_ok=True)
    provisional_dir = os.path.join(models_dir, f'.provisional-{uuid.uuid4().hex}')
    os.makedirs(provisional_dir, exist_ok=True)
    try:
        with open(os.path.join(provisional_dir, 'model.txt'), 'w') as fh:
            fh.write(booster_str)
        wf.to_csv(os.path.join(provisional_dir, 'walkforward_predictions.csv'), index=False)
        with open(os.path.join(provisional_dir, 'metrics.json'), 'w') as fh:
            json.dump(result, fh, indent=2)
        with open(os.path.join(provisional_dir, 'bars_snapshot_manifest.json'), 'w') as fh:
            json.dump(manifest, fh, indent=2)
        try:
            os.replace(provisional_dir, out_dir)
        except OSError:
            if os.path.isdir(out_dir):
                shutil.rmtree(provisional_dir, ignore_errors=True)
            else:
                raise
    except Exception:
        shutil.rmtree(provisional_dir, ignore_errors=True)
        raise

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
