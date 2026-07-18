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
            'models_dir': tempfile.mkdtemp(), 'tfm_provider': ZeroTfm(),
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
    r = c.post('/ml/predict', json={'symbol': 'WEGE3', 'artifactHash': body['artifact']['hash']})
    p = r.get_json()
    assert r.status_code == 200 and p['direction'] in ('BUY', 'SELL')
    assert 0.0 <= p['score'] <= 1.0 and len(p['topFeatures']) > 0

def test_errors_explicit():
    app = create_app(make_deps(mt5_ok=False)); c = app.test_client()
    r = c.post('/ml/backfill', json={'symbols': ['WEGE3']})
    assert r.status_code == 503 and r.get_json()['error'] == 'MT5_DISCONNECTED'
    app2 = create_app(make_deps()); c2 = app2.test_client()
    r = c2.post('/ml/predict', json={'symbol': 'WEGE3', 'artifactHash': 'nao-existe'})
    assert r.status_code == 404 and r.get_json()['error'] == 'MODEL_NOT_FOUND'

if __name__ == '__main__':
    test_health_backfill_train_predict(); test_errors_explicit()
    print('test_ml_api: OK')
