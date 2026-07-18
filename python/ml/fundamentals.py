"""Fundamentos CVM defasados pelo prazo legal de publicação.

Regra anti-vazamento central da v1: o trimestre com fim em data_ref só entra
no dataset a partir de data_ref + 45 dias corridos (ITR, T1–T3) ou + 90 dias
(DFP, T4). Nunca a data contábil.
"""
import sqlite3
import pandas as pd

FUND_COLUMNS = ['roe', 'margem_liquida', 'margem_ebitda', 'divida_bruta_pl',
                'crescimento_receita_yoy', 'crescimento_lucro_yoy', 'payout_ratio',
                'roic', 'divida_liquida_ebitda']
_LAG_ITR_DAYS = 45
_LAG_DFP_DAYS = 90

def _connect_ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=30)

def list_universe(cvm_db_path: str) -> list:
    con = _connect_ro(cvm_db_path)
    try:
        rows = con.execute('SELECT ticker FROM empresas WHERE ticker IS NOT NULL ORDER BY ticker').fetchall()
    finally:
        con.close()
    return [r[0] for r in rows]

def load_sector_map(cvm_db_path: str) -> dict:
    con = _connect_ro(cvm_db_path)
    try:
        rows = con.execute('SELECT ticker, setor FROM empresas WHERE ticker IS NOT NULL').fetchall()
    finally:
        con.close()
    return dict(rows)

def load_fundamental_history(cvm_db_path: str, ticker: str) -> pd.DataFrame:
    con = _connect_ro(cvm_db_path)
    try:
        df = pd.read_sql_query(
            'SELECT f.trimestre, f.data_ref, ' + ', '.join(f'f.{c}' for c in FUND_COLUMNS) +
            ' FROM fundamental_indicators f JOIN empresas e ON e.cd_cvm = f.cd_cvm '
            'WHERE e.ticker = ? ORDER BY f.data_ref', con, params=(ticker,))
    finally:
        con.close()
    df['data_ref'] = pd.to_datetime(df['data_ref'])
    lag = df['trimestre'].map(lambda q: _LAG_DFP_DAYS if q == 4 else _LAG_ITR_DAYS)
    df['available_at'] = df['data_ref'] + pd.to_timedelta(lag, unit='D')
    return df.drop(columns=['trimestre']).sort_values('available_at').reset_index(drop=True)

def asof_fundamentals(dates: pd.DatetimeIndex, fund: pd.DataFrame) -> pd.DataFrame:
    left = pd.DataFrame({'date': pd.DatetimeIndex(dates)}).sort_values('date')
    joined = pd.merge_asof(left, fund.drop(columns=['data_ref']),
                           left_on='date', right_on='available_at', direction='backward')
    return joined.set_index('date').drop(columns=['available_at'])
