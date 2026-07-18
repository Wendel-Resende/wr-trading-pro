import os, sqlite3, sys, tempfile
import pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ml.fundamentals import load_fundamental_history, asof_fundamentals, FUND_COLUMNS, list_universe

def make_cvm_db():
    path = os.path.join(tempfile.mkdtemp(), 'cvm.db')
    con = sqlite3.connect(path)
    con.executescript("""
      CREATE TABLE empresas (cd_cvm TEXT, ticker TEXT, setor TEXT);
      CREATE TABLE fundamental_indicators (
        cd_cvm TEXT, ano INT, trimestre INT, data_ref TEXT,
        roe REAL, margem_liquida REAL, margem_ebitda REAL, divida_bruta_pl REAL,
        crescimento_receita_yoy REAL, crescimento_lucro_yoy REAL, payout_ratio REAL,
        roic REAL, divida_liquida_ebitda REAL);
      INSERT INTO empresas VALUES ('001', 'WEGE3', 'Bens Industriais');
      INSERT INTO fundamental_indicators VALUES
        ('001', 2023, 1, '2023-03-31', 0.20, 0.15, 0.22, 0.3, 0.1, 0.12, 0.5, 0.18, 0.4),
        ('001', 2023, 4, '2023-12-31', 0.22, 0.16, 0.23, 0.3, 0.1, 0.15, 0.6, 0.19, 0.4);
    """)
    con.commit(); con.close()
    return path

def test_legal_lag():
    db = make_cvm_db()
    hist = load_fundamental_history(db, 'WEGE3')
    assert list(hist['available_at']) == [pd.Timestamp('2023-05-15'),   # T1: 31/03 + 45d
                                          pd.Timestamp('2024-03-30')]   # T4: 31/12 + 90d
    dates = pd.DatetimeIndex(['2023-05-14', '2023-05-15', '2024-03-29', '2024-03-30'])
    joined = asof_fundamentals(dates, hist)
    assert len(joined) == 4
    assert pd.isna(joined['roe'].iloc[0])                  # véspera: nada publicado
    assert abs(joined['roe'].iloc[1] - 0.20) < 1e-9        # dia da publicação do T1
    assert abs(joined['roe'].iloc[2] - 0.20) < 1e-9        # T4 ainda não disponível
    assert abs(joined['roe'].iloc[3] - 0.22) < 1e-9        # T4 disponível
    assert set(FUND_COLUMNS) <= set(joined.columns)

def test_universe():
    assert list_universe(make_cvm_db()) == ['WEGE3']

if __name__ == '__main__':
    test_legal_lag(); test_universe()
    print('test_ml_fundamentals: OK')
