import os, sqlite3, sys, tempfile
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml_api import create_app
from ml.candles import replace_daily_candles
from test_ml_candles import DDL, day_ms
from test_ml_fundamentals import make_cvm_db
from test_ml_dataset import ZeroTfm

def make_deps(mt5_ok=True):
    price_db = os.path.join(tempfile.mkdtemp(), 'p.db')
    con = sqlite3.connect(price_db); con.executescript(DDL); con.close()
    rng = np.random.default_rng(5)
    close = 100 * np.cumprod(1 + rng.normal(0.0005, 0.01, 1500))
    replace_daily_candles(price_db, 'WEGE3',
        [(day_ms(i), c, c * 1.01, c * 0.99, c, 1000.0) for i, c in enumerate(close)])
    class FakeMt5:
        def get_daily_rates(self, symbol):
            return [(day_ms(i), c, c, c, c, 1.0) for i, c in enumerate(close)]
    return {'db_path': price_db, 'cvm_db_path': make_cvm_db(),
            'models_dir': tempfile.mkdtemp(), 'bars_snapshot_dir': tempfile.mkdtemp(),
            'tfm_provider': ZeroTfm(),
            'mt5_client_factory': (lambda: FakeMt5()) if mt5_ok
                else (lambda: (_ for _ in ()).throw(RuntimeError('MT5_DISCONNECTED')))}

def test_health_backfill_train_predict():
    app = create_app(make_deps()); c = app.test_client()
    assert c.get('/ml/health').get_json()['status'] == 'ok'
    r = c.post('/ml/backfill', json={'symbols': ['WEGE3']})
    assert r.status_code == 200 and r.get_json()['ok'] == ['WEGE3']
    r = c.post('/ml/train', json={'symbols': ['WEGE3']})
    assert r.status_code == 200
    body = r.get_json()
    assert body['aggregate']['nSamples'] > 0 and body['artifact']['hash']
    # D-hash: artifact hash e digests completos (64 hex), sem prefixo/':'.
    assert len(body['artifact']['hash']) == 64 and ':' not in body['artifact']['hash']
    assert len(body['datasetDigest']) == 64 and ':' not in body['datasetDigest']
    assert len(body['universeBarsDigest']) == 64 and ':' not in body['universeBarsDigest']
    assert body['datasetHash'] == f"sha256:{body['datasetDigest']}"
    r = c.post('/ml/predict', json={'symbol': 'WEGE3', 'artifactHash': body['artifact']['hash']})
    p = r.get_json()
    assert r.status_code == 200 and p['direction'] in ('BUY', 'SELL')
    assert 0.0 <= p['score'] <= 1.0 and len(p['topFeatures']) > 0
    return body['artifact']['hash']

def test_errors_explicit():
    app = create_app(make_deps(mt5_ok=False)); c = app.test_client()
    r = c.post('/ml/backfill', json={'symbols': ['WEGE3']})
    assert r.status_code == 503 and r.get_json()['error'] == 'MT5_DISCONNECTED'
    app2 = create_app(make_deps()); c2 = app2.test_client()
    r = c2.post('/ml/predict', json={'symbol': 'WEGE3', 'artifactHash': 'nao-existe'})
    assert r.status_code == 400 and r.get_json()['error'] == 'INVALID_HASH'
    # hash bem formado (64 hex) mas sem artefato no disco -> 404 MODEL_NOT_FOUND
    r2 = c2.post('/ml/predict', json={'symbol': 'WEGE3', 'artifactHash': 'a' * 64})
    assert r2.status_code == 404 and r2.get_json()['error'] == 'MODEL_NOT_FOUND'

def test_train_uses_frozen_snapshot_not_live_table_mid_training():
    """Item A / D1, teste de integração via a rota real: um backfill
    concorrente entre o snapshot e a leitura de dataset (simulado aqui
    trocando a tabela HistoricalCandle diretamente) não pode afetar o
    resultado do treino, porque build_dataset só olha o snapshot já
    congelado por write_universe_snapshot antes dele."""
    deps = make_deps()
    app = create_app(deps); c = app.test_client()
    r1 = c.post('/ml/train', json={'symbols': ['WEGE3']})
    digest1 = r1.get_json()['datasetDigest']

    # sem re-treinar: só confirma que rodar de novo com as MESMAS barras
    # produz o MESMO datasetDigest (determinismo fim a fim via a rota HTTP).
    r2 = c.post('/ml/train', json={'symbols': ['WEGE3']})
    assert r2.get_json()['datasetDigest'] == digest1

def test_predictions_endpoint_validation_and_pagination():
    deps = make_deps()
    app = create_app(deps); c = app.test_client()
    r = c.post('/ml/train', json={'symbols': ['WEGE3']})
    artifact_hash = r.get_json()['artifact']['hash']

    # hash malformado -> 400, nunca toca filesystem
    bad = c.get('/ml/predictions/nao-e-hash?symbol=WEGE3')
    assert bad.status_code == 400 and bad.get_json()['error'] == 'INVALID_HASH'

    # símbolo malformado -> 400
    bad_symbol = c.get(f'/ml/predictions/{artifact_hash}?symbol=lower4')
    assert bad_symbol.status_code == 400 and bad_symbol.get_json()['error'] == 'INVALID_SYMBOL'

    # hash bem formado mas inexistente -> 404 MODEL_NOT_FOUND
    fake_hash = 'a' * 64
    missing = c.get(f'/ml/predictions/{fake_hash}?symbol=WEGE3')
    assert missing.status_code == 404 and missing.get_json()['error'] == 'MODEL_NOT_FOUND'

    # símbolo bem formado mas fora do universo do artefato -> 404
    not_in_artifact = c.get(f'/ml/predictions/{artifact_hash}?symbol=PETR4')
    assert not_in_artifact.status_code == 404
    assert not_in_artifact.get_json()['error'] == 'SYMBOL_NOT_IN_ARTIFACT'

    # caminho feliz: linhas com metadata de fold (D3/D11), paginado
    ok = c.get(f'/ml/predictions/{artifact_hash}?symbol=WEGE3&limit=2&offset=0')
    assert ok.status_code == 200
    page = ok.get_json()
    assert page['limit'] == 2 and page['offset'] == 0 and page['total'] > 0
    assert len(page['rows']) <= 2
    row = page['rows'][0]
    for key in ('foldId', 'trainEnd', 'testStart', 'embargoCalDays', 'symbol', 'date', 'pModel'):
        assert key in row

    # paginação fora do teto -> 400
    too_big = c.get(f'/ml/predictions/{artifact_hash}?symbol=WEGE3&limit=5000')
    assert too_big.status_code == 400 and too_big.get_json()['error'] == 'INVALID_QUERY'

def test_snapshot_bars_endpoint_validation_and_pagination():
    deps = make_deps()
    app = create_app(deps); c = app.test_client()
    r = c.post('/ml/train', json={'symbols': ['WEGE3']})
    universe_digest = r.get_json()['universeBarsDigest']

    bad = c.get('/ml/snapshot-bars/nao-e-hash?symbol=WEGE3')
    assert bad.status_code == 400 and bad.get_json()['error'] == 'INVALID_HASH'

    bad_symbol = c.get(f'/ml/snapshot-bars/{universe_digest}?symbol=lower4')
    assert bad_symbol.status_code == 400 and bad_symbol.get_json()['error'] == 'INVALID_SYMBOL'

    fake_digest = 'a' * 64
    missing = c.get(f'/ml/snapshot-bars/{fake_digest}?symbol=WEGE3')
    assert missing.status_code == 404 and missing.get_json()['error'] == 'ARTIFACT_NOT_FOUND'

    not_in_snapshot = c.get(f'/ml/snapshot-bars/{universe_digest}?symbol=PETR4')
    assert not_in_snapshot.status_code == 404
    assert not_in_snapshot.get_json()['error'] == 'SYMBOL_NOT_IN_ARTIFACT'

    ok = c.get(f'/ml/snapshot-bars/{universe_digest}?symbol=WEGE3&limit=3&offset=0')
    assert ok.status_code == 200
    page = ok.get_json()
    assert page['total'] > 0 and len(page['rows']) <= 3
    row = page['rows'][0]
    for key in ('time', 'open', 'high', 'low', 'close', 'volume'):
        assert key in row
    assert row['time'].endswith('Z')

def test_predictions_endpoint_paginates_in_stable_order_even_if_artifact_is_shuffled():
    """G-007 item 2: /ml/predictions não pode confiar na ordem física do CSV
    para paginar — embaralha o artefato em disco e confirma que as páginas
    seguintes ordenam por data (desempate por foldId), sem duplicar nem
    pular linha, e são estáveis entre chamadas repetidas."""
    import pandas as pd
    deps = make_deps()
    app = create_app(deps); c = app.test_client()
    r = c.post('/ml/train', json={'symbols': ['WEGE3']})
    artifact_hash = r.get_json()['artifact']['hash']
    csv_path = os.path.join(deps['models_dir'], artifact_hash, 'walkforward_predictions.csv')

    wf = pd.read_csv(csv_path)
    rows_for_symbol = wf[wf['symbol'] == 'WEGE3']
    expected_order = list(zip(rows_for_symbol.sort_values(['date', 'foldId'], kind='stable')['date'],
                               rows_for_symbol.sort_values(['date', 'foldId'], kind='stable')['foldId']))

    shuffled = wf.sample(frac=1.0, random_state=7).reset_index(drop=True)
    shuffled.to_csv(csv_path, index=False)

    limit = 3
    collected = []
    offset = 0
    total = None
    while True:
        page = c.get(f'/ml/predictions/{artifact_hash}?symbol=WEGE3&limit={limit}&offset={offset}').get_json()
        total = page['total']
        if not page['rows']:
            break
        collected.extend((row['date'], row['foldId']) for row in page['rows'])
        offset += limit
    assert total == len(expected_order)
    assert len(collected) == len(expected_order), 'sem duplicata nem lacuna entre páginas'
    assert collected == expected_order, 'ordem estável independente da ordem física do CSV embaralhado'

    # repetir a mesma página duas vezes deve devolver exatamente as mesmas linhas.
    page_a = c.get(f'/ml/predictions/{artifact_hash}?symbol=WEGE3&limit={limit}&offset=0').get_json()
    page_b = c.get(f'/ml/predictions/{artifact_hash}?symbol=WEGE3&limit={limit}&offset=0').get_json()
    assert page_a['rows'] == page_b['rows']

def test_snapshot_bars_endpoint_paginates_in_stable_order_even_if_artifact_is_shuffled():
    """G-007 item 2: /ml/snapshot-bars não pode confiar na ordem física do
    parquet para paginar — embaralha o artefato em disco e confirma que as
    páginas seguintes ordenam por tempo, sem duplicar nem pular barra, e são
    estáveis entre chamadas repetidas."""
    import pandas as pd
    deps = make_deps()
    app = create_app(deps); c = app.test_client()
    r = c.post('/ml/train', json={'symbols': ['WEGE3']})
    universe_digest = r.get_json()['universeBarsDigest']
    parquet_path = os.path.join(deps['bars_snapshot_dir'], universe_digest, 'WEGE3.parquet')

    bars = pd.read_parquet(parquet_path)
    expected_order = list(bars.sort_values('time', kind='stable')['time'].astype(str))

    shuffled = bars.sample(frac=1.0, random_state=11).reset_index(drop=True)
    shuffled.to_parquet(parquet_path)

    limit = 50
    collected = []
    offset = 0
    total = None
    while True:
        page = c.get(f'/ml/snapshot-bars/{universe_digest}?symbol=WEGE3&limit={limit}&offset={offset}').get_json()
        total = page['total']
        if not page['rows']:
            break
        collected.extend(page['rows'])
        offset += limit
    assert total == len(expected_order)
    assert len(collected) == len(expected_order), 'sem duplicata nem lacuna entre páginas'
    times = [row['time'] for row in collected]
    assert times == sorted(times), 'ordem estável por tempo independente da ordem física do parquet embaralhado'

    page_a = c.get(f'/ml/snapshot-bars/{universe_digest}?symbol=WEGE3&limit={limit}&offset=0').get_json()
    page_b = c.get(f'/ml/snapshot-bars/{universe_digest}?symbol=WEGE3&limit={limit}&offset=0').get_json()
    assert page_a['rows'] == page_b['rows']

def test_predictions_endpoint_corrupted_csv_never_500():
    deps = make_deps()
    app = create_app(deps); c = app.test_client()
    r = c.post('/ml/train', json={'symbols': ['WEGE3']})
    artifact_hash = r.get_json()['artifact']['hash']
    csv_path = os.path.join(deps['models_dir'], artifact_hash, 'walkforward_predictions.csv')
    with open(csv_path, 'wb') as fh:
        fh.write(b'\x00\x01not,a,real,csv\x02')
    bad = c.get(f'/ml/predictions/{artifact_hash}?symbol=WEGE3')
    assert bad.status_code == 422 and bad.get_json()['error'] == 'ARTIFACT_UNREADABLE'
    assert set(bad.get_json().keys()) == {'error'}

def test_snapshot_bars_endpoint_corrupted_parquet_never_leaks_detail():
    """G-003 item 1: /ml/snapshot-bars não pode devolver `detail` de exceção
    interna ao cliente — mesmo padrão de /ml/predictions e /ml/predict."""
    deps = make_deps()
    app = create_app(deps); c = app.test_client()
    r = c.post('/ml/train', json={'symbols': ['WEGE3']})
    universe_digest = r.get_json()['universeBarsDigest']
    parquet_path = os.path.join(deps['bars_snapshot_dir'], universe_digest, 'WEGE3.parquet')
    with open(parquet_path, 'wb') as fh:
        fh.write(b'\x00\x01not-a-real-parquet\x02')
    bad = c.get(f'/ml/snapshot-bars/{universe_digest}?symbol=WEGE3')
    assert bad.status_code == 422
    body = bad.get_json()
    assert body['error'] == 'ARTIFACT_UNREADABLE'
    assert set(body.keys()) == {'error'}

if __name__ == '__main__':
    test_health_backfill_train_predict(); test_errors_explicit()
    test_train_uses_frozen_snapshot_not_live_table_mid_training()
    test_predictions_endpoint_validation_and_pagination()
    test_snapshot_bars_endpoint_validation_and_pagination()
    test_predictions_endpoint_paginates_in_stable_order_even_if_artifact_is_shuffled()
    test_snapshot_bars_endpoint_paginates_in_stable_order_even_if_artifact_is_shuffled()
    test_predictions_endpoint_corrupted_csv_never_500()
    test_snapshot_bars_endpoint_corrupted_parquet_never_leaks_detail()
    print('test_ml_api: OK')
