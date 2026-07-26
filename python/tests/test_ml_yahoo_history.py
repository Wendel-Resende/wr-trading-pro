"""Testes da ingestão de histórico Yahoo (Item D, 2026-07-25).

Nenhum teste toca a rede: o coletor HTTP é injetado. O banco é temporário,
com o schema real de `HistoricalCandle` (incluindo a coluna `source`).
"""
import json
import os
import sqlite3
import sys
import tempfile

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from ml.candles import replace_daily_candles  # noqa: E402
from ml.yahoo_history import (  # noqa: E402
    SOURCE, SYMBOL_OVERRIDES, YahooUnavailableError, fetch_daily, ingest_symbols,
    write_yahoo_candles, yahoo_symbol,
)

DDL = """CREATE TABLE HistoricalCandle (
  id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, timeframe TEXT NOT NULL,
  time DATETIME NOT NULL, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL,
  close REAL NOT NULL, volume REAL NOT NULL, source TEXT NOT NULL DEFAULT 'MT5',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX u ON HistoricalCandle(symbol, timeframe, time);"""


def make_db():
    path = os.path.join(tempfile.mkdtemp(), 'test.db')
    con = sqlite3.connect(path)
    con.executescript(DDL)
    con.close()
    return path


def _payload(n=400, inicio='2015-01-01', com_buracos=False):
    dias = pd.bdate_range(inicio, periods=n)
    ts = [int(d.timestamp()) for d in dias]
    adj = [10.0 + i * 0.01 for i in range(n)]
    if com_buracos:
        adj[5] = None  # dia sem fechamento ajustado: não é barra
    return json.dumps({'chart': {'result': [{
        'timestamp': ts,
        'indicators': {
            'quote': [{'open': adj, 'high': adj, 'low': adj, 'volume': [1000.0] * n}],
            'adjclose': [{'adjclose': adj}],
        },
    }]}}).encode()


def test_symbol_overrides():
    """Empresas renomeadas: o Yahoo só conhece o nome novo."""
    assert yahoo_symbol('PETR4') == 'PETR4.SA'
    assert yahoo_symbol('CCRO3') == 'MOTV3.SA', 'CCR virou Motiva em 2024'
    assert yahoo_symbol('TRPL4') == 'ISAE4.SA'
    assert set(SYMBOL_OVERRIDES) == {'CCRO3', 'TRPL4'}
    print('  test_symbol_overrides: OK')


def test_fetch_usa_adjclose_e_descarta_dia_sem_fechamento():
    df = fetch_daily('PETR4', opener=lambda url: _payload(com_buracos=True))
    assert len(df) == 399, f'dia sem adjclose deveria sair, obtido {len(df)} de 400'
    assert (df['close'] > 0).all()
    # OHLC ausente cai para o próprio fechamento — nunca inventado.
    assert (df['open'] == df['close']).all() or df['open'].notna().all()
    assert df['time'].is_monotonic_increasing and df['time'].is_unique
    print('  test_fetch_usa_adjclose_e_descarta_dia_sem_fechamento: OK')


def test_fetch_falha_explicita():
    """404/resposta vazia/histórico curto viram erro TIPADO, nunca série falsa."""
    def erro(_url):
        raise RuntimeError('HTTP 404')
    for opener, motivo in [
        (erro, '404'),
        (lambda u: json.dumps({'chart': {'result': None}}).encode(), 'sem serie'),
        (lambda u: _payload(n=10), 'historico curto'),
    ]:
        try:
            fetch_daily('ELET3', opener=opener)
            raise AssertionError(f'deveria falhar: {motivo}')
        except YahooUnavailableError:
            pass
    print('  test_fetch_falha_explicita: OK')


def test_yahoo_e_autoritativo_na_janela_que_cobre():
    """Barra do Yahoo substitui a do MT5 no mesmo dia; fora da janela, MT5 fica."""
    db = make_db()
    dias = pd.bdate_range('2015-01-01', periods=400)
    # MT5 cobre um intervalo MAIOR à direita (pregão recente que o Yahoo atrasa)
    epoch_ms = [int(d.timestamp() * 1000) for d in list(dias) + [dias[-1] + pd.Timedelta(days=3)]]
    replace_daily_candles(db, 'PETR4', [(ms, 1.0, 1.0, 1.0, 99.0, 1.0) for ms in epoch_ms])

    bars = fetch_daily('PETR4', opener=lambda url: _payload())
    escritas = write_yahoo_candles(db, 'PETR4', bars)
    assert escritas == 400

    con = sqlite3.connect(db)
    por_fonte = dict(con.execute('SELECT source, COUNT(*) FROM HistoricalCandle GROUP BY source').fetchall())
    assert por_fonte.get(SOURCE) == 400, f'Yahoo deveria ocupar a janela inteira: {por_fonte}'
    assert por_fonte.get('MT5') == 1, 'a barra do MT5 FORA da janela do Yahoo permanece'
    # Nenhum dia duplicado.
    dup = con.execute('SELECT COUNT(*) FROM (SELECT time FROM HistoricalCandle '
                      "WHERE symbol='PETR4' GROUP BY time HAVING COUNT(*)>1)").fetchone()[0]
    assert dup == 0
    con.close()
    print('  test_yahoo_e_autoritativo_na_janela_que_cobre: OK')


def test_backfill_mt5_nao_apaga_historico_yahoo():
    """REGRESSÃO: sem escopo por fonte, um backfill do MT5 apagaria 15 anos."""
    db = make_db()
    bars = fetch_daily('PETR4', opener=lambda url: _payload())
    write_yahoo_candles(db, 'PETR4', bars)

    # Backfill do MT5 cobrindo um intervalo curto e recente.
    recentes = pd.bdate_range('2024-01-01', periods=5)
    replace_daily_candles(db, 'PETR4', [(int(d.timestamp() * 1000), 1.0, 1.0, 1.0, 50.0, 1.0) for d in recentes])

    con = sqlite3.connect(db)
    por_fonte = dict(con.execute('SELECT source, COUNT(*) FROM HistoricalCandle GROUP BY source').fetchall())
    assert por_fonte.get(SOURCE) == 400, f'historico Yahoo foi destruido pelo backfill: {por_fonte}'
    assert por_fonte.get('MT5') == 5
    con.close()
    print('  test_backfill_mt5_nao_apaga_historico_yahoo: OK')


def test_saneamento_distingue_artefato_de_queda_real():
    """Limiares calibrados: artefato de ajuste sai, crash legítimo fica.

    A primeira versão usava |ret| >= 60% e destruiu a série inteira da AMBP3
    por causa de uma queda REAL de -61,5% (crise de dívida, out/2025). Os
    artefatos observados no Yahoo são inconfundíveis (+9.900%, +1.900%), então
    os limites são assimétricos e calibrados contra eles.
    """
    from ml.yahoo_history import truncate_at_last_implausible

    # Artefato de fator: salto de +1.900% no meio da série.
    artefato = pd.DataFrame({'close': [10.0, 10.1, 200.0, 201.0, 202.0, 203.0]})
    limpo, rel = truncate_at_last_implausible(artefato)
    assert rel['truncated'] and len(limpo) == 3, 'salto de +1.900% deveria truncar'

    # Preço absurdo (fator de desdobramento errado em série antiga).
    absurdo = pd.DataFrame({'close': [114496.0, 114500.0, 20.0, 20.1, 20.2]})
    limpo2, rel2 = truncate_at_last_implausible(absurdo)
    assert rel2['truncated'] and len(limpo2) == 2

    # Queda REAL de -61,5%: preservada, com a história inteira intacta.
    crash = pd.DataFrame({'close': [10.0, 10.2, 10.1, 3.885, 3.9, 4.0]})
    limpo3, rel3 = truncate_at_last_implausible(crash)
    assert not rel3['truncated'], 'queda real de -61,5% NAO pode truncar a serie'
    assert len(limpo3) == 6

    # Queda a praticamente zero continua sendo artefato.
    zerada = pd.DataFrame({'close': [10.0, 10.2, 0.5, 0.51, 0.52]})
    assert truncate_at_last_implausible(zerada)[1]['truncated']
    print('  test_saneamento_distingue_artefato_de_queda_real: OK')


def test_ingest_reporta_por_simbolo():
    """Falha de um símbolo nunca derruba os demais, e nunca some do relatório."""
    db = make_db()

    def fetcher(ticker):
        if ticker == 'ELET3':
            raise YahooUnavailableError('ELET3: indisponivel no Yahoo')
        return fetch_daily(ticker, opener=lambda url: _payload())

    rel = ingest_symbols(db, ['PETR4', 'ELET3', 'WEGE3'], fetcher=fetcher)
    assert set(rel['ok']) == {'PETR4', 'WEGE3'}
    assert set(rel['failed']) == {'ELET3'}
    assert rel['ok']['PETR4']['bars'] == 400
    assert rel['ok']['PETR4']['from'] == '2015-01-01'
    print('  test_ingest_reporta_por_simbolo: OK')


if __name__ == '__main__':
    test_symbol_overrides()
    test_fetch_usa_adjclose_e_descarta_dia_sem_fechamento()
    test_fetch_falha_explicita()
    test_saneamento_distingue_artefato_de_queda_real()
    test_yahoo_e_autoritativo_na_janela_que_cobre()
    test_backfill_mt5_nao_apaga_historico_yahoo()
    test_ingest_reporta_por_simbolo()
    print('test_ml_yahoo_history: OK')
