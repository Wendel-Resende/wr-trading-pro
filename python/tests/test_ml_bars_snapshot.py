import os, sqlite3, sys, tempfile, threading
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.bars_snapshot import SnapshotNotFoundError, load_snapshot_bars, write_universe_snapshot
from ml.candles import replace_daily_candles
from test_ml_candles import DDL, day_ms

def make_price_db(symbols, n=300, seed=7):
    path = os.path.join(tempfile.mkdtemp(), 'p.db')
    con = sqlite3.connect(path); con.executescript(DDL); con.close()
    rng = np.random.default_rng(seed)
    for symbol in symbols:
        close = 100 * np.cumprod(1 + rng.normal(0, 0.01, n))
        replace_daily_candles(path, symbol,
            [(day_ms(i), c, c * 1.01, c * 0.99, c, 1000.0) for i, c in enumerate(close)])
    return path

def test_snapshot_is_deterministic_and_64_hex():
    db = make_price_db(['WEGE3', 'PETR4'])
    base1 = tempfile.mkdtemp(); base2 = tempfile.mkdtemp()
    m1 = write_universe_snapshot(db, ['WEGE3', 'PETR4'], base1)
    m2 = write_universe_snapshot(db, ['PETR4', 'WEGE3'], base2)  # ordem de entrada diferente
    assert m1['universeBarsDigest'] == m2['universeBarsDigest']  # canonicalizado internamente
    assert len(m1['universeBarsDigest']) == 64 and ':' not in m1['universeBarsDigest']
    assert set(m1['perSymbol'].keys()) == {'WEGE3', 'PETR4'}
    for meta in m1['perSymbol'].values():
        assert len(meta['sha256']) == 64 and meta['rows'] > 0

def test_snapshot_dir_named_by_universe_bars_digest_and_dedup():
    db = make_price_db(['WEGE3'])
    base = tempfile.mkdtemp()
    m1 = write_universe_snapshot(db, ['WEGE3'], base)
    assert m1['snapshotDir'] == os.path.join(base, m1['universeBarsDigest'])
    assert os.path.isdir(m1['snapshotDir'])
    # segunda chamada com as MESMAS barras -> reaproveita o diretório, sem duplicar/nao falha
    m2 = write_universe_snapshot(db, ['WEGE3'], base)
    assert m2['universeBarsDigest'] == m1['universeBarsDigest']
    assert len(os.listdir(base)) == 1  # nenhum diretório provisório sobrando

def test_snapshot_changes_when_bars_change():
    db = make_price_db(['WEGE3'], seed=1)
    base = tempfile.mkdtemp()
    m1 = write_universe_snapshot(db, ['WEGE3'], base)
    rng = np.random.default_rng(2)
    close = 300 * np.cumprod(1 + rng.normal(0, 0.01, 300))
    replace_daily_candles(db, 'WEGE3',
        [(day_ms(i), c, c * 1.01, c * 0.99, c, 1000.0) for i, c in enumerate(close)])
    m2 = write_universe_snapshot(db, ['WEGE3'], base)
    assert m1['universeBarsDigest'] != m2['universeBarsDigest']

def test_load_snapshot_bars_missing_symbol_raises_explicit():
    db = make_price_db(['WEGE3'])
    base = tempfile.mkdtemp()
    m = write_universe_snapshot(db, ['WEGE3'], base)
    try:
        load_snapshot_bars(m['snapshotDir'], 'PETR4')
        assert False, 'deveria levantar SnapshotNotFoundError'
    except SnapshotNotFoundError as exc:
        assert 'SNAPSHOT_NOT_FOUND' in str(exc)

def test_load_snapshot_bars_never_touches_live_table():
    """Depois do snapshot, mudar HistoricalCandle não pode mudar o que
    load_snapshot_bars devolve — é a garantia central do Item A / D1."""
    db = make_price_db(['WEGE3'], seed=5)
    base = tempfile.mkdtemp()
    m = write_universe_snapshot(db, ['WEGE3'], base)
    before = load_snapshot_bars(m['snapshotDir'], 'WEGE3').copy()

    rng = np.random.default_rng(6)
    close = 999 * np.cumprod(1 + rng.normal(0, 0.01, 300))
    replace_daily_candles(db, 'WEGE3',
        [(day_ms(i), c, c * 1.01, c * 0.99, c, 1000.0) for i, c in enumerate(close)])

    after = load_snapshot_bars(m['snapshotDir'], 'WEGE3')
    assert (before['close'].to_numpy() == after['close'].to_numpy()).all()

def test_universe_bars_digest_covers_exactly_persisted_precision():
    """G-003 item 3 (D1/D-hash): o digest não pode arredondar a menos casas
    do que o parquet persiste — uma diferença sub-1e-8 no OHLC precisa
    mudar o digest, e o valor lido de volta do parquet precisa bater
    byte-a-byte com o que gerou o hash (sem arredondamento no meio)."""
    db = make_price_db(['WEGE3'], n=50)
    base1 = tempfile.mkdtemp()
    m1 = write_universe_snapshot(db, ['WEGE3'], base1)
    bars_before = load_snapshot_bars(m1['snapshotDir'], 'WEGE3')

    # perturbação MENOR que 1e-8 no primeiro close — se o digest ainda
    # arredondasse a 8 casas, isso colidiria (mesmo digest de antes).
    con = sqlite3.connect(db)
    row = con.execute("SELECT time, high, low, close, volume FROM HistoricalCandle "
                       "WHERE symbol='WEGE3' ORDER BY time LIMIT 1").fetchone()
    perturbed_close = row[3] + 4e-9
    con.execute("UPDATE HistoricalCandle SET close=? WHERE symbol='WEGE3' AND time=?",
                (perturbed_close, row[0]))
    con.commit(); con.close()

    base2 = tempfile.mkdtemp()
    m2 = write_universe_snapshot(db, ['WEGE3'], base2)
    assert m2['universeBarsDigest'] != m1['universeBarsDigest'], (
        'digest deveria mudar com uma diferenca sub-1e-8 no OHLC persistido')

    bars_after = load_snapshot_bars(m2['snapshotDir'], 'WEGE3')
    assert bars_after['close'].iloc[0] == perturbed_close, (
        'valor persistido no parquet deve ser exatamente o valor que gerou o novo digest, sem arredondamento')
    assert bars_before['close'].iloc[0] != bars_after['close'].iloc[0]

def test_concurrent_snapshot_publish_same_universe_never_raises():
    """G-003 item 3 (D1): publicação/dedup do snapshot precisa ser segura
    sob concorrência real — dois treinos escrevendo o MESMO universo de
    barras ao mesmo tempo não podem lançar exceção nem corromper o
    diretório final; ambos devem convergir para o mesmo `universeBarsDigest`."""
    db = make_price_db(['WEGE3'], n=80)
    base = tempfile.mkdtemp()
    results: list = []
    errors: list = []

    def worker():
        try:
            results.append(write_universe_snapshot(db, ['WEGE3'], base))
        except Exception as exc:  # noqa: BLE001 — o teste falha explicitamente abaixo se algo for capturado aqui
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f'publicacao concorrente do mesmo digest nao pode lancar excecao: {errors}'
    assert len(results) == 8
    digests = {r['universeBarsDigest'] for r in results}
    assert len(digests) == 1, 'todas as chamadas concorrentes devem convergir para o mesmo digest'
    # nenhum diretório `.provisional-*` deve sobrar após a corrida.
    leftovers = [d for d in os.listdir(base) if d.startswith('.provisional-')]
    assert not leftovers, f'diretorios provisorios nao limpos apos a corrida: {leftovers}'

if __name__ == '__main__':
    test_snapshot_is_deterministic_and_64_hex()
    test_snapshot_dir_named_by_universe_bars_digest_and_dedup()
    test_snapshot_changes_when_bars_change()
    test_load_snapshot_bars_missing_symbol_raises_explicit()
    test_load_snapshot_bars_never_touches_live_table()
    test_universe_bars_digest_covers_exactly_persisted_precision()
    test_concurrent_snapshot_publish_same_universe_never_raises()
    print('test_ml_bars_snapshot: OK')
