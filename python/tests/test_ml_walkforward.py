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

def test_embargo_is_exactly_21_trading_days_not_calendar_days():
    """G-003 item 4: o corte precisa ser 21 PREGÕES reais contados sobre o
    próprio calendário de dias com dado, imune a feriados/interrupções — não
    uma aproximação em dias corridos. Constrói um calendário de negociação
    com um "buraco" deliberado (feriado/interrupção de 10 dias corridos sem
    nenhum pregão) logo antes do início do ano de teste e confirma que o
    trecho de treino termina exatamente 21 posições (pregões) antes do
    primeiro pregão do ano de teste — nem mais, nem menos — mesmo quando
    isso atravessa o buraco."""
    trading_days = list(pd.date_range('2019-01-02', periods=800, freq='B'))  # dias úteis, sem feriados
    # ano de teste = 2021: insere um "feriado/interrupção" de 10 dias corridos
    # (nenhum pregão) imediatamente antes do primeiro pregão de 2021.
    test_year_start = next(d for d in trading_days if d.year == 2021)
    idx = trading_days.index(test_year_start)
    gap_start = test_year_start - pd.Timedelta(days=10)
    trading_days = [d for d in trading_days if not (gap_start <= d < test_year_start)]

    rows = []
    for d in trading_days:
        x = {f: 0.0 for f in ALL_FEATURES}
        rows.append({'symbol': 'AAAA3', 'date': d, 'setor': 'X', 'y': 0.0, **x})
    ds = pd.DataFrame(rows)

    splits = walkforward_splits(ds['date'])
    test_2021 = next(s for s in splits if s['test_year'] == 2021)
    unique_days = sorted(ds['date'].unique())
    test_start = min(d for d in unique_days if pd.Timestamp(d).year == 2021)
    test_start_pos = unique_days.index(test_start)
    train_end_pos = unique_days.index(pd.Timestamp(test_2021['train_end']))
    # exatamente 21 pregões de distância (posições), independente do buraco de
    # dias corridos que existe entre train_end e test_start.
    assert test_start_pos - train_end_pos - 1 == 21

def test_run_training_output_contract():
    ds = make_ds(signal_strength=0.25)  # sinal real em ret_5: modelo deve aprender
    out = run_training(ds, tempfile.mkdtemp(), dataset_digest='ab' * 32, universe_bars_digest='cd' * 32,
                        per_symbol_manifest={'AAAA3': {'sha256': 'ef' * 32, 'rows': 10, 'from': '2019-01-05', 'to': '2019-02-01'}})
    for key in ('aggregate', 'baselines', 'blocks', 'artifact', 'hyperparameters', 'backtest',
                'datasetHash', 'datasetDigest', 'universeBarsDigest', 'universe'):
        assert key in out, key
    assert out['universe'] == ['AAAA3']
    assert out['aggregate']['nSamples'] == sum(b['n'] for b in out['blocks'])
    assert set(out['baselines']) == {'alwaysUp', 'timesfmOnly', 'fundamentalOnly', 'priceOnlyLgbm'}
    b0 = out['blocks'][0]
    assert b0['hitsModel'] <= b0['n'] and ':' in b0['block']
    assert os.path.exists(out['artifact']['path'])
    assert out['aggregate']['accuracy'] > 0.55            # aprendeu o sinal plantado

    # D-hash: artifact hash completo (64 hex), datasetDigest sem prefixo,
    # datasetHash com prefixo semântico — nunca confundidos.
    assert len(out['artifact']['hash']) == 64 and ':' not in out['artifact']['hash']
    assert out['datasetDigest'] == 'ab' * 32
    assert out['universeBarsDigest'] == 'cd' * 32
    assert out['datasetHash'] == f"sha256:{'ab' * 32}"

    # D3/D11: metadata de fold auditável por previsão, gravada no CSV.
    out_dir = os.path.dirname(out['artifact']['path'])
    wf = pd.read_csv(os.path.join(out_dir, 'walkforward_predictions.csv'))
    for col in ('foldId', 'trainEnd', 'testStart', 'embargoCalDays'):
        assert col in wf.columns
    assert (pd.to_datetime(wf['trainEnd']) < pd.to_datetime(wf['testStart'])).all()

    # manifesto de proveniência do snapshot, separado do manifesto de treino.
    manifest_path = os.path.join(out_dir, 'bars_snapshot_manifest.json')
    assert os.path.exists(manifest_path)
    import json
    with open(manifest_path) as fh:
        manifest = json.load(fh)
    assert manifest['universeBarsDigest'] == 'cd' * 32
    assert manifest['datasetDigest'] == 'ab' * 32
    assert manifest['perSymbol']['AAAA3']['rows'] == 10

if __name__ == '__main__':
    test_splits_embargo()
    test_embargo_is_exactly_21_trading_days_not_calendar_days()
    test_run_training_output_contract()
    print('test_ml_walkforward: OK')
