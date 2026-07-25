"""Testes dos endpoints /ml/directional/* (Item D, §4.3).

Fixture sintética própria: banco CVM com o schema real (empresas +
fundamental_indicators + indicadores + dfc/bpa/dre) e barras D1 no schema real
de `HistoricalCandle`, ambos em tempdir. Nenhum teste toca banco de produção,
MT5 ou rede.
"""
import os
import sqlite3
import sys
import tempfile

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from ml.candles import replace_daily_candles  # noqa: E402
from ml_api import create_app  # noqa: E402
from test_ml_candles import DDL  # noqa: E402

_TICKERS = [f'DIR{i}3' if i < 10 else f'DI{i}3' for i in range(1, 31)]
_QUARTERS = [(y, q) for y in range(2011, 2026) for q in (1, 2, 3, 4)]
_CVM_DDL = """
  CREATE TABLE empresas (cd_cvm TEXT, ticker TEXT, nome TEXT, setor TEXT, setor_cvm TEXT);
  CREATE TABLE fundamental_indicators (
    cd_cvm TEXT, ano INT, trimestre INT, data_ref TEXT,
    roe REAL, roa REAL, margem_bruta REAL, margem_ebit REAL, margem_liquida REAL,
    margem_ebitda REAL, divida_bruta_pl REAL, divida_liquida_ebitda REAL,
    payout_ratio REAL, roic REAL, giro_ativos REAL,
    crescimento_receita_yoy REAL, crescimento_lucro_yoy REAL, pl_ativos REAL);
  CREATE TABLE indicadores (cd_cvm TEXT, ano INT, trimestre INT,
    liquidez_corrente REAL, endividamento REAL, divida_pl REAL);
  CREATE TABLE dfc_trimestral (cd_cvm TEXT, ano INT, trimestre INT,
    fco REAL, fcf REAL, dividendos_pagos REAL, jcp_pagos REAL);
  CREATE TABLE bpa_trimestral (cd_cvm TEXT, ano INT, trimestre INT, ativo_total REAL);
  CREATE TABLE dre_trimestral (cd_cvm TEXT, ano INT, trimestre INT, lucro_liquido REAL);
"""


def _data_ref(ano: int, tri: int) -> str:
    return {1: f'{ano}-03-31', 2: f'{ano}-06-30', 3: f'{ano}-09-30', 4: f'{ano}-12-31'}[tri]


def make_cvm_db(seed: int = 11) -> tuple[str, dict]:
    """Banco CVM sintético; devolve (path, {ticker: {(ano,tri): roe}})."""
    path = os.path.join(tempfile.mkdtemp(), 'cvm.db')
    con = sqlite3.connect(path)
    con.executescript(_CVM_DDL)
    rng = np.random.default_rng(seed)
    roes: dict = {}
    for idx, ticker in enumerate(_TICKERS):
        cd = f'{idx:06d}'
        con.execute('INSERT INTO empresas VALUES (?,?,?,?,?)',
                    (cd, ticker, f'Empresa {ticker}', 'Setor', f'SETOR{idx % 3}'))
        for ano, tri in _QUARTERS:
            roe = float(rng.uniform(0.0, 0.30))
            roes[(ticker, ano, tri)] = roe
            con.execute('INSERT INTO fundamental_indicators VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        (cd, ano, tri, _data_ref(ano, tri), roe, roe * 0.6,
                         float(rng.uniform(0.1, 0.5)), float(rng.uniform(0.05, 0.3)),
                         roe * 0.4, float(rng.uniform(0.1, 0.4)), float(rng.uniform(0, 2)),
                         float(rng.uniform(-1, 4)), float(rng.uniform(0, 1)), roe * 0.9,
                         float(rng.uniform(0.2, 1.5)), float(rng.normal(0.05, 0.1)),
                         float(rng.normal(0.05, 0.2)), float(rng.uniform(0.2, 0.8))))
            con.execute('INSERT INTO indicadores VALUES (?,?,?,?,?,?)',
                        (cd, ano, tri, float(rng.uniform(0.5, 3)), float(rng.uniform(0.1, 0.9)),
                         float(rng.uniform(0, 2))))
            con.execute('INSERT INTO dfc_trimestral VALUES (?,?,?,?,?,?,?)',
                        (cd, ano, tri, float(rng.uniform(1e6, 1e8)), float(rng.uniform(-1e7, 1e8)),
                         float(rng.uniform(0, 1e7)), 0.0))
            con.execute('INSERT INTO bpa_trimestral VALUES (?,?,?,?)',
                        (cd, ano, tri, float(rng.uniform(1e8, 1e10))))
            con.execute('INSERT INTO dre_trimestral VALUES (?,?,?,?)',
                        (cd, ano, tri, float(rng.uniform(-1e7, 1e8))))
    con.commit()
    con.close()
    return path, roes


def make_price_db(roes: dict) -> str:
    """Barras D1 com o mesmo sinal plantado do teste do motor (roe > 0.15 ⇒ alta)."""
    path = os.path.join(tempfile.mkdtemp(), 'p.db')
    con = sqlite3.connect(path)
    con.executescript(DDL)
    con.close()

    days = pd.bdate_range('2010-01-01', '2027-06-30')
    epoch_ms = [int(d.timestamp() * 1000) for d in days]
    for ticker in _TICKERS:
        drift = np.zeros(len(days))
        for (t, ano, tri), roe in roes.items():
            if t != ticker:
                continue
            lag = 90 if tri == 4 else 45
            know = pd.Timestamp(_data_ref(ano, tri)) + pd.Timedelta(days=lag)
            idx = int(days.searchsorted(know, side='left'))
            if idx + 60 >= len(days):
                continue
            drift[idx:idx + 60] += 0.002 if roe > 0.15 else -0.002
        close = 100.0 * np.cumprod(1.0 + drift)
        replace_daily_candles(path, ticker,
                              [(epoch_ms[i], c, c * 1.01, c * 0.99, c, 1000.0)
                               for i, c in enumerate(close)])
    return path


def make_deps() -> dict:
    cvm_path, roes = make_cvm_db()
    return {
        'db_path': make_price_db(roes),
        'cvm_db_path': cvm_path,
        'models_dir': tempfile.mkdtemp(),
        'directional_models_dir': tempfile.mkdtemp(),
        'bars_snapshot_dir': tempfile.mkdtemp(),
        'jobs_dir': tempfile.mkdtemp(),
        'mt5_client_factory': lambda: (_ for _ in ()).throw(RuntimeError('MT5_DISCONNECTED')),
    }


_APP_CACHE: dict = {}


def _app_and_training():
    """Treino real é caro; roda uma vez e reusa entre os testes."""
    if 'app' not in _APP_CACHE:
        deps = make_deps()
        app = create_app(deps)
        client = app.test_client()
        response = client.post('/ml/directional/train', json={'symbols': _TICKERS})
        assert response.status_code == 200, response.get_json()
        _APP_CACHE.update({'app': app, 'client': client, 'deps': deps,
                           'result': response.get_json()})
    return _APP_CACHE


# ---------------------------------------------------------------------------
def test_train_returns_model_version_and_metrics():
    ctx = _app_and_training()
    body = ctx['result']

    assert len(body['modelVersion']) == 64 and ':' not in body['modelVersion']
    assert len(body['datasetDigest']) == 64
    assert len(body['universeBarsDigest']) == 64
    assert body['horizonTradingDays'] == 60
    assert body['gate'] == {'upper': 0.90, 'lower': 0.10}
    assert sorted(body['universe']) == body['universe'], 'universo tem de vir ordenado'
    assert set(body['universe']) <= set(_TICKERS)

    metrics = body['metrics']
    for key in ('nSamples', 'nHighConfidence', 'accuracy', 'brier', 'coverage',
                'coveragePeriod', 'baselineAllUp', 'baselineOnSignals', 'baselineDelta',
                'confusionMatrix', 'reliability', 'byFold'):
        assert key in metrics, f'metrica ausente: {key}'
    assert metrics['nSamples'] > 0
    assert 0.0 <= metrics['brier'] <= 1.0
    assert os.path.isfile(os.path.join(ctx['deps']['directional_models_dir'],
                                       body['modelVersion'], 'model.pkl'))
    print('  test_train_returns_model_version_and_metrics: OK')


def test_train_is_deterministic_and_dedups_artifact():
    """Mesmos dados ⇒ mesma modelVersion; artefato publicado nunca é sobrescrito."""
    ctx = _app_and_training()
    version = ctx['result']['modelVersion']
    artifact = os.path.join(ctx['deps']['directional_models_dir'], version, 'model.pkl')
    mtime = os.path.getmtime(artifact)

    again = ctx['client'].post('/ml/directional/train', json={'symbols': _TICKERS})
    assert again.status_code == 200
    assert again.get_json()['modelVersion'] == version
    assert os.path.getmtime(artifact) == mtime, 'artefato imutavel foi sobrescrito'
    print('  test_train_is_deterministic_and_dedups_artifact: OK')


def test_predict_applies_confidence_gate():
    ctx = _app_and_training()
    response = ctx['client'].post('/ml/directional/predict',
                                  json={'modelVersion': ctx['result']['modelVersion'],
                                        'symbols': _TICKERS})
    assert response.status_code == 200, response.get_json()
    body = response.get_json()

    assert body['modelVersion'] == ctx['result']['modelVersion']
    assert len(body['universeDigest']) == 64
    assert body['generatedAt'].endswith('Z')
    assert len(body['predictions']) == len(_TICKERS)

    for pred in body['predictions']:
        assert pred['signal'] in ('COMPRA', 'VENDA', 'NEUTRO')
        assert 0.0 <= pred['confidence'] <= 1.0
        assert 0.0 <= pred['prob'] <= 1.0
        assert pred['ticker'] in _TICKERS
        assert isinstance(pred['topFeatures'], list)
        # O gate é a única fonte do sinal — contrato verificado na fronteira HTTP.
        if pred['prob'] > 0.90:
            assert pred['signal'] == 'COMPRA' and pred['confidence'] == pred['prob']
        elif pred['prob'] < 0.10:
            assert pred['signal'] == 'VENDA'
            assert abs(pred['confidence'] - (1 - pred['prob'])) < 1e-9
        else:
            assert pred['signal'] == 'NEUTRO'
    print('  test_predict_applies_confidence_gate: OK')


def test_predict_validation_and_guards():
    ctx = _app_and_training()
    client = ctx['client']

    # modelVersion malformada -> 400 ANTES de qualquer acesso a filesystem.
    for bad in ['nao-e-hash', '../../etc/passwd', '', None, 123]:
        r = client.post('/ml/directional/predict', json={'modelVersion': bad})
        assert r.status_code == 400, f'{bad!r} deveria ser rejeitado'
        assert r.get_json()['error'] == 'INVALID_MODEL_VERSION'

    # bem formada mas inexistente -> 404, sem vazar path.
    missing = client.post('/ml/directional/predict', json={'modelVersion': 'a' * 64})
    assert missing.status_code == 404 and missing.get_json()['error'] == 'MODEL_NOT_FOUND'
    assert set(missing.get_json().keys()) == {'error'}

    # ticker malformado continua barrado pela guarda canônica B3.
    bad_symbol = client.post('/ml/directional/predict',
                             json={'modelVersion': ctx['result']['modelVersion'],
                                   'symbols': ['../etc']})
    assert bad_symbol.status_code == 400
    assert bad_symbol.get_json()['error'] == 'INVALID_SYMBOLS'
    print('  test_predict_validation_and_guards: OK')


def test_predict_corrupted_artifact_never_leaks_detail():
    ctx = _app_and_training()
    version = 'b' * 64
    out_dir = os.path.join(ctx['deps']['directional_models_dir'], version)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, 'model.pkl'), 'wb') as fh:
        fh.write(b'\x00\x01nao-e-um-pickle\x02')

    bad = ctx['client'].post('/ml/directional/predict', json={'modelVersion': version})
    assert bad.status_code == 422
    assert bad.get_json()['error'] == 'ARTIFACT_UNREADABLE'
    assert set(bad.get_json().keys()) == {'error'}, 'nunca vazar detalhe interno do artefato'
    print('  test_predict_corrupted_artifact_never_leaks_detail: OK')


def test_train_insufficient_data_is_explicit():
    """Universo minúsculo não vira modelo silencioso — 422 explícito."""
    deps = make_deps()
    client = create_app(deps).test_client()
    r = client.post('/ml/directional/train', json={'symbols': [_TICKERS[0]]})
    assert r.status_code == 422
    assert r.get_json()['error'] == 'INSUFFICIENT_DATA'
    print('  test_train_insufficient_data_is_explicit: OK')


if __name__ == '__main__':
    test_train_returns_model_version_and_metrics()
    test_train_is_deterministic_and_dedups_artifact()
    test_predict_applies_confidence_gate()
    test_predict_validation_and_guards()
    test_predict_corrupted_artifact_never_leaks_detail()
    test_train_insufficient_data_is_explicit()
    print('test_directional_api: OK')
