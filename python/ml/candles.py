"""Store de candles D1 em prisma/dev.db (tabela HistoricalCandle).

Escreve apenas LINHAS via sqlite3 (WAL, transação por símbolo) — o schema é
exclusivo do Prisma.

Precedência entre fontes (2026-07-25): o full refresh do MT5 passou a ser
ESCOPADO em `source='MT5'`, e a inserção usa `INSERT OR IGNORE`. Motivo: o
histórico do Yahoo (`ml/yahoo_history.py`) cobre 15-26 anos contra os ~5 que a
corretora entrega, e é gravado como autoritativo na janela que cobre. Sem o
escopo, um backfill do MT5 apagaria toda a história estendida a cada execução.

O MT5 continua sendo a fonte para o que o Yahoo não tem: os 9 tickers sem
cobertura lá, e o pregão mais recente (que o Yahoo publica com atraso).
"""
from datetime import datetime, timezone
import sqlite3
import pandas as pd

TIMEFRAME = 'D1'

def _iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S')

def replace_daily_candles(db_path: str, symbol: str, rows) -> int:
    """Full refresh das barras do MT5 — escopado à PRÓPRIA fonte.

    `DELETE ... AND source='MT5'` preserva o histórico estendido do Yahoo, e
    `INSERT OR IGNORE` faz o MT5 preencher apenas os dias que o Yahoo não
    cobre (a chave única é (symbol, timeframe, time), então o dia já ocupado
    por uma barra Yahoo permanece dela). Devolve quantas linhas foram de fato
    inseridas, não quantas vieram do MT5 — a diferença é a sobreposição.
    """
    con = sqlite3.connect(db_path, timeout=30)
    try:
        con.execute('PRAGMA journal_mode=WAL')
        with con:  # transação: delete+insert atômico
            con.execute("DELETE FROM HistoricalCandle WHERE symbol=? AND timeframe=? AND source='MT5'",
                        (symbol, TIMEFRAME))
            antes = con.total_changes
            con.executemany(
                'INSERT OR IGNORE INTO HistoricalCandle (symbol, timeframe, time, open, high, low, close, volume, source) '
                "VALUES (?,?,?,?,?,?,?,?,'MT5')",
                [(symbol, TIMEFRAME, _iso(r[0]), r[1], r[2], r[3], r[4], r[5]) for r in rows])
            inseridas = con.total_changes - antes
        return inseridas
    finally:
        con.close()

def load_daily_candles(db_path: str, symbol: str) -> pd.DataFrame:
    con = sqlite3.connect(db_path, timeout=30)
    try:
        df = pd.read_sql_query(
            'SELECT time, open, high, low, close, volume FROM HistoricalCandle '
            'WHERE symbol=? AND timeframe=? ORDER BY time', con, params=(symbol, TIMEFRAME))
    finally:
        con.close()
    df['time'] = pd.to_datetime(df['time'])
    return df

def backfill_symbols(db_path: str, symbols, mt5_client, min_bars: int = 750) -> dict:
    report = {'ok': [], 'failed': {}}
    for symbol in symbols:
        try:
            rates = mt5_client.get_daily_rates(symbol)
        except Exception as exc:  # noqa: BLE001 — relatório por ticker, nunca meia-carga
            report['failed'][symbol] = f'MT5_ERROR: {exc}'
            continue
        if rates is None:
            report['failed'][symbol] = 'SYMBOL_NOT_FOUND'
        elif len(rates) < min_bars:
            report['failed'][symbol] = f'INSUFFICIENT_DATA: {len(rates)} < {min_bars}'
        else:
            replace_daily_candles(db_path, symbol, rates)
            report['ok'].append(symbol)
    return report

class Mt5DailyClient:
    """Cliente real. Import adiado: testes não exigem MetaTrader5 instalado."""

    def __init__(self, max_bars: int = 5000):
        import MetaTrader5 as mt5  # noqa: PLC0415
        self._mt5 = mt5
        self._max_bars = max_bars
        if not mt5.initialize():
            raise RuntimeError('MT5_DISCONNECTED')

    def get_daily_rates(self, symbol):
        info = self._mt5.symbol_info(symbol)
        if info is None:
            return None
        self._mt5.symbol_select(symbol, True)
        rates = self._mt5.copy_rates_from_pos(symbol, self._mt5.TIMEFRAME_D1, 0, self._max_bars)
        if rates is None:
            return None
        return [(int(r['time']) * 1000, float(r['open']), float(r['high']),
                 float(r['low']), float(r['close']), float(r['real_volume'] or r['tick_volume']))
                for r in rates]
