import os, sqlite3, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.candles import replace_daily_candles, load_daily_candles, backfill_symbols

DDL = """CREATE TABLE HistoricalCandle (
  id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, timeframe TEXT NOT NULL,
  time DATETIME NOT NULL, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL,
  close REAL NOT NULL, volume REAL NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX u ON HistoricalCandle(symbol, timeframe, time);"""

def make_db():
    path = os.path.join(tempfile.mkdtemp(), 'test.db')
    con = sqlite3.connect(path); con.executescript(DDL); con.close()
    return path

def day_ms(i):  # dias sequenciais a partir de 2024-01-01 UTC
    return (1704067200 + i * 86400) * 1000

def test_replace_is_full_refresh():
    db = make_db()
    replace_daily_candles(db, 'WEGE3', [(day_ms(i), 1, 2, 0.5, 1.5, 100) for i in range(5)])
    # segunda carga menor substitui a primeira (full refresh, não append)
    n = replace_daily_candles(db, 'WEGE3', [(day_ms(i), 1, 2, 0.5, 1.6, 100) for i in range(3)])
    assert n == 3
    df = load_daily_candles(db, 'WEGE3')
    assert len(df) == 3 and abs(df['close'].iloc[0] - 1.6) < 1e-9
    assert df['time'].is_monotonic_increasing

def test_backfill_report_and_min_bars():
    db = make_db()
    class FakeMt5:
        def get_daily_rates(self, symbol):
            if symbol == 'DEAD3': return None
            n = 10 if symbol == 'CURT3' else 800
            return [(day_ms(i), 1, 2, 0.5, 1.5, 100) for i in range(n)]
    report = backfill_symbols(db, ['WEGE3', 'CURT3', 'DEAD3'], FakeMt5(), min_bars=750)
    assert report['ok'] == ['WEGE3']
    assert 'CURT3' in report['failed'] and 'DEAD3' in report['failed']
    assert len(load_daily_candles(db, 'CURT3')) == 0  # rejeitado não grava

if __name__ == '__main__':
    test_replace_is_full_refresh(); test_backfill_report_and_min_bars()
    print('test_ml_candles: OK')
