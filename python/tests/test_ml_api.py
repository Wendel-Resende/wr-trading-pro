"""Testes do ml_api.py fora do trilho direcional (backfill, health, guardas).

O grosso da cobertura de treino/previsão vive em `test_directional_api.py`.
Aqui ficam só as superfícies que sobreviveram à remoção do motor híbrido.
"""
import os
import sqlite3
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from ml.candles import replace_daily_candles  # noqa: E402
from ml_api import create_app  # noqa: E402
from test_ml_candles import DDL, day_ms  # noqa: E402
from test_ml_fundamentals import make_cvm_db  # noqa: E402


def make_deps(mt5_ok=True):
    price_db = os.path.join(tempfile.mkdtemp(), 'p.db')
    con = sqlite3.connect(price_db)
    con.executescript(DDL)
    con.close()
    rng = np.random.default_rng(5)
    close = 100 * np.cumprod(1 + rng.normal(0.0005, 0.01, 1500))
    replace_daily_candles(price_db, 'WEGE3',
                          [(day_ms(i), c, c * 1.01, c * 0.99, c, 1000.0) for i, c in enumerate(close)])

    class FakeMt5:
        def get_daily_rates(self, symbol):
            return [(day_ms(i), c, c, c, c, 1.0) for i, c in enumerate(close)]

    return {
        'db_path': price_db,
        'cvm_db_path': make_cvm_db(),
        'directional_models_dir': tempfile.mkdtemp(),
        'bars_snapshot_dir': tempfile.mkdtemp(),
        'jobs_dir': tempfile.mkdtemp(),
        'mt5_client_factory': (lambda: FakeMt5()) if mt5_ok
        else (lambda: (_ for _ in ()).throw(RuntimeError('MT5_DISCONNECTED'))),
    }


def test_health():
    client = create_app(make_deps()).test_client()
    body = client.get('/ml/health').get_json()
    assert body['status'] == 'ok'
    # Item D: o motor não carrega mais nenhum foundation model — o health
    # deixou de reportar `timesfmLoaded`.
    assert 'timesfmLoaded' not in body
    print('  test_health: OK')


def test_backfill():
    client = create_app(make_deps()).test_client()
    r = client.post('/ml/backfill', json={'symbols': ['WEGE3']})
    assert r.status_code == 200 and r.get_json()['ok'] == ['WEGE3']
    print('  test_backfill: OK')


def test_backfill_mt5_disconnected_is_explicit():
    client = create_app(make_deps(mt5_ok=False)).test_client()
    r = client.post('/ml/backfill', json={'symbols': ['WEGE3']})
    assert r.status_code == 503 and r.get_json()['error'] == 'MT5_DISCONNECTED'
    print('  test_backfill_mt5_disconnected_is_explicit: OK')


def test_ticker_guard_accepts_b3sa3_and_rejects_path_traversal():
    """A guarda de ticker protege acesso a filesystem (path do snapshot).

    Deve aceitar o padrão canônico B3 (raiz alfanumérica de 4 chars + 1-2
    dígitos, ex. B3SA3, a própria B3 S.A.), sincronizado manualmente com
    `B3_TICKER_PATTERN` de src/lib/b3-ticker.ts, e rejeitar qualquer coisa que
    não seja um ticker válido.
    """
    client = create_app(make_deps()).test_client()

    r = client.post('/ml/backfill', json={'symbols': ['B3SA3']})
    assert r.get_json().get('error') != 'INVALID_SYMBOLS', 'B3SA3 deve passar da guarda'

    for bad in ['../etc', 'A/B', 'foo.bar', '123456', '', 'PETR']:
        rb = client.post('/ml/backfill', json={'symbols': [bad]})
        assert rb.status_code == 400, f'{bad!r} deveria ser rejeitado'
        assert rb.get_json()['error'] == 'INVALID_SYMBOLS'

    # Espaço/quebra de linha em volta é NORMALIZADO (strip) antes da guarda —
    # o valor que compõe o path é sempre o ticker canônico, nunca o cru. A
    # equivalência de ancoragem com o regex do Node é coberta pela suíte
    # cruzada `npm run test:b3-ticker`.
    ok = client.post('/ml/backfill', json={'symbols': [' petr4\n']})
    assert ok.get_json().get('error') != 'INVALID_SYMBOLS'
    print('  test_ticker_guard_accepts_b3sa3_and_rejects_path_traversal: OK')


def test_train_job_validates_job_id():
    client = create_app(make_deps()).test_client()
    for bad in ['nao-e-job-id', '', 'a' * 31, '../etc']:
        r = client.post('/ml/train-jobs', json={'jobId': bad, 'symbols': ['WEGE3']})
        assert r.status_code == 400 and r.get_json()['error'] == 'INVALID_JOB_ID'
    r = client.get('/ml/train-jobs/nao-e-job-id')
    assert r.status_code == 400 and r.get_json()['error'] == 'INVALID_JOB_ID'
    print('  test_train_job_validates_job_id: OK')


if __name__ == '__main__':
    test_health()
    test_backfill()
    test_backfill_mt5_disconnected_is_explicit()
    test_ticker_guard_accepts_b3sa3_and_rejects_path_traversal()
    test_train_job_validates_job_id()
    print('test_ml_api: OK')
