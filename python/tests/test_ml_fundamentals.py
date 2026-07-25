"""Universo/setores do snapshot CVM.

Item D: os testes do casamento point-in-time em grade diária
(`load_fundamental_history`/`asof_fundamentals`) saíram junto com o motor
híbrido. A regra do prazo legal continua coberta — agora em
`test_directional_classifier.py::test_feature_panel_from_sqlite`, sobre a
grade trimestral que o classificador direcional de fato usa.
"""
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from ml.fundamentals import list_universe, load_sector_map  # noqa: E402


def make_cvm_db():
    path = os.path.join(tempfile.mkdtemp(), 'cvm.db')
    con = sqlite3.connect(path)
    con.executescript("""
      CREATE TABLE empresas (cd_cvm TEXT, ticker TEXT, setor TEXT);
      INSERT INTO empresas VALUES ('001', 'WEGE3', 'Bens Industriais');
      INSERT INTO empresas VALUES ('002', NULL, 'Sem ticker');
    """)
    con.commit()
    con.close()
    return path


def test_universe_skips_companies_without_ticker():
    assert list_universe(make_cvm_db()) == ['WEGE3']
    print('  test_universe_skips_companies_without_ticker: OK')


def test_sector_map():
    assert load_sector_map(make_cvm_db()) == {'WEGE3': 'Bens Industriais'}
    print('  test_sector_map: OK')


if __name__ == '__main__':
    test_universe_skips_companies_without_ticker()
    test_sector_map()
    print('test_ml_fundamentals: OK')
