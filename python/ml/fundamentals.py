"""Universo e setores do snapshot CVM.

Item D: a leitura de indicadores fundamentalistas vive em
`ml/directional_features.py`, que trabalha em grade TRIMESTRAL (uma linha por
empresa/trimestre). As funções antigas de casamento em grade DIÁRIA
(`load_fundamental_history`/`asof_fundamentals`) existiam só para o dataset do
motor híbrido e saíram junto com ele. O prazo legal de publicação continua
sendo a regra anti-vazamento — agora aplicado em `directional_features`.
"""
import sqlite3

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
