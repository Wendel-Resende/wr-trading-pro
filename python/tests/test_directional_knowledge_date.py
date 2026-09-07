"""Carimbo de conhecimento vindo da data de publicação REAL da CVM.

Até 2026-09-06 o painel usava sempre `data_ref + prazo legal` (+45d ITR,
+90d DFP), porque a WR nunca coletara a data de publicação. Medido sobre os
48.593 filings ingeridos em `CvmFiling`: 21,3% dos ITR e 19,4% das DFP são
entregues DEPOIS do prazo — nessas, o painel tratava o fundamento como
conhecido antes de existir.

Estes testes protegem as duas metades da correção:
  1. onde há filing casado, o carimbo é `DT_RECEB` da ÚLTIMA versão;
  2. onde não há, o prazo legal continua valendo — e `knowledge_source`
     diz qual dos dois valeu, para o fallback nunca passar despercebido.
"""
import os
import sqlite3
import sys
import tempfile
import unittest

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from python.ml.directional_features import (  # noqa: E402
    DEFAULT_FILINGS_DB,
    LAG_DFP_DAYS,
    LAG_ITR_DAYS,
    SOURCE_FILING,
    SOURCE_LEGAL_DEADLINE,
    apply_real_knowledge_dates,
    knowledge_date,
    knowledge_provenance,
    load_filing_dates,
)

EPOCH = pd.Timestamp('1970-01-01')


def _ms(date: str) -> int:
    """Prisma grava DateTime como epoch em milissegundos."""
    return int((pd.Timestamp(date) - EPOCH).total_seconds() * 1000)


def _filings_db(path: str, rows: list[tuple]) -> None:
    """Banco mínimo com o formato real de `Issuer`/`CvmFiling`."""
    con = sqlite3.connect(path)
    con.execute('CREATE TABLE Issuer (id TEXT PRIMARY KEY, cvmCode TEXT)')
    con.execute(
        'CREATE TABLE CvmFiling (id TEXT PRIMARY KEY, issuerId TEXT, documentType TEXT, '
        'fiscalYear INTEGER, fiscalQuarter INTEGER, publishedAt BIGINT, isRestatement INTEGER)'
    )
    emissores = {code for code, *_ in rows}
    for code in emissores:
        con.execute('INSERT INTO Issuer VALUES (?, ?)', (f'iss-{code}', code))
    for i, (code, doc_type, year, quarter, published, restated) in enumerate(rows):
        con.execute(
            'INSERT INTO CvmFiling VALUES (?, ?, ?, ?, ?, ?, ?)',
            (f'f{i}', f'iss-{code}', doc_type, year, quarter, _ms(published), int(restated)),
        )
    con.commit()
    con.close()


def _panel(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    df['data_ref'] = pd.to_datetime(df['data_ref'])
    df['knowledge_date'] = knowledge_date(df['data_ref'], df['trimestre'])
    return df


class RealKnowledgeDateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, 'filings.db')

    def test_uses_real_publication_date_when_filing_matches(self) -> None:
        # A empresa entregou em 08/05, ANTES dos 45 dias legais (15/05).
        # O painel estava conservador à toa: 80% das linhas reais caem aqui.
        _filings_db(self.db, [('1023', 'ITR', 2024, 1, '2024-05-08', False)])
        panel = _panel([{'cd_cvm': '001023', 'ano': 2024, 'trimestre': 1, 'data_ref': '2024-03-31'}])
        legal = panel['knowledge_date'].iloc[0]

        out = apply_real_knowledge_dates(panel, load_filing_dates(self.db))

        self.assertEqual(out['knowledge_source'].iloc[0], SOURCE_FILING)
        self.assertEqual(out['knowledge_date'].iloc[0], pd.Timestamp('2024-05-08'))
        self.assertLess(out['knowledge_date'].iloc[0], legal, 'entrega antecipada recupera sinal')

    def test_late_filing_pushes_the_stamp_forward(self) -> None:
        # O caso que era vazamento: entrega em 20/07, muito depois dos 45
        # dias. Antes, o painel dizia conhecer o dado em 15/05.
        _filings_db(self.db, [('1023', 'ITR', 2024, 1, '2024-07-20', False)])
        panel = _panel([{'cd_cvm': '001023', 'ano': 2024, 'trimestre': 1, 'data_ref': '2024-03-31'}])
        legal = panel['knowledge_date'].iloc[0]

        out = apply_real_knowledge_dates(panel, load_filing_dates(self.db))

        self.assertEqual(out['knowledge_date'].iloc[0], pd.Timestamp('2024-07-20'))
        self.assertGreater(out['knowledge_date'].iloc[0], legal, 'entrega tardia remove o look-ahead')

    def test_restatement_uses_the_last_version(self) -> None:
        # A correção do segundo vazamento. O valor guardado em
        # `fundamental_indicators` é o RETIFICADO; carimbá-lo com a data da
        # v1 afirmaria que se conhecia em maio um número publicado em
        # novembro. 19% das linhas da base real são retificação.
        _filings_db(
            self.db,
            [
                ('1023', 'ITR', 2024, 1, '2024-05-08', False),
                ('1023', 'ITR', 2024, 1, '2024-11-22', True),
            ],
        )
        panel = _panel([{'cd_cvm': '001023', 'ano': 2024, 'trimestre': 1, 'data_ref': '2024-03-31'}])

        out = apply_real_knowledge_dates(panel, load_filing_dates(self.db))

        self.assertEqual(out['knowledge_date'].iloc[0], pd.Timestamp('2024-11-22'))
        self.assertTrue(bool(out['is_restatement'].iloc[0]), 'a linha tem que ficar marcada')

    def test_fourth_quarter_matches_the_annual_dfp(self) -> None:
        # A WR usa trimestre 1..4; a CVM publica 1..3 como ITR e o quarto
        # período como DFP, sem trimestre.
        _filings_db(self.db, [('1023', 'DFP', 2024, None, '2025-03-28', False)])
        panel = _panel([{'cd_cvm': '001023', 'ano': 2024, 'trimestre': 4, 'data_ref': '2024-12-31'}])

        out = apply_real_knowledge_dates(panel, load_filing_dates(self.db))

        self.assertEqual(out['knowledge_source'].iloc[0], SOURCE_FILING)
        self.assertEqual(out['knowledge_date'].iloc[0], pd.Timestamp('2025-03-28'))

    def test_unmatched_row_falls_back_and_says_so(self) -> None:
        # Fallback não é erro: é o que a fonte permite. Mas tem que ser
        # visível, ou vira uma afirmação sem lastro.
        _filings_db(self.db, [('9999', 'ITR', 2024, 1, '2024-05-08', False)])
        panel = _panel([{'cd_cvm': '001023', 'ano': 2024, 'trimestre': 1, 'data_ref': '2024-03-31'}])
        legal = panel['knowledge_date'].iloc[0]

        out = apply_real_knowledge_dates(panel, load_filing_dates(self.db))

        self.assertEqual(out['knowledge_source'].iloc[0], SOURCE_LEGAL_DEADLINE)
        self.assertEqual(out['knowledge_date'].iloc[0], legal)
        self.assertFalse(bool(out['is_restatement'].iloc[0]))

    def test_missing_filings_database_does_not_break_the_panel(self) -> None:
        # O painel é o ativo mais crítico da WR; a ausência do banco de
        # filings degrada o carimbo, nunca derruba o treino.
        filings = load_filing_dates(os.path.join(self.tmp, 'nao-existe.db'))
        self.assertTrue(filings.empty)

        panel = _panel([{'cd_cvm': '001023', 'ano': 2024, 'trimestre': 1, 'data_ref': '2024-03-31'}])
        out = apply_real_knowledge_dates(panel, filings)

        self.assertEqual(out['knowledge_source'].iloc[0], SOURCE_LEGAL_DEADLINE)
        self.assertEqual(out['knowledge_date'].iloc[0], panel['knowledge_date'].iloc[0])

    def test_leading_zeros_do_not_break_the_join(self) -> None:
        # `fundamental_indicators` guarda '000906'; `Issuer.cvmCode` guarda
        # '906'. Sem normalizar, NENHUMA linha casaria.
        _filings_db(self.db, [('906', 'ITR', 2024, 2, '2024-08-09', False)])
        panel = _panel([{'cd_cvm': '000906', 'ano': 2024, 'trimestre': 2, 'data_ref': '2024-06-30'}])

        out = apply_real_knowledge_dates(panel, load_filing_dates(self.db))

        self.assertEqual(out['knowledge_source'].iloc[0], SOURCE_FILING)
        self.assertEqual(out['knowledge_date'].iloc[0], pd.Timestamp('2024-08-09'))

    def test_legal_deadline_constants_are_unchanged(self) -> None:
        # O fallback continua sendo o prazo legal brasileiro; a mudança foi
        # de ORIGEM do carimbo, não dos prazos.
        self.assertEqual(LAG_ITR_DAYS, 45)
        self.assertEqual(LAG_DFP_DAYS, 90)
        self.assertTrue(DEFAULT_FILINGS_DB.endswith('dev.db'))


class ProvenanceAndPathTests(unittest.TestCase):
    """Os três defeitos do primeiro retreino, todos meus.

    Depois de trocar o carimbo, o retreino pelo app reproduziu EXATAMENTE as
    métricas antigas (IC 0,1020, t 4,575, spread 0,0261). Causa: o worker roda
    com CWD próprio, o default era relativo, `load_directional_panel` não
    aceitava o caminho, e nada no resultado denunciava a queda para o prazo
    legal. Só a comparação com uma medição anterior pegou.
    """

    def test_default_path_is_anchored_to_the_repo_not_the_cwd(self) -> None:
        self.assertTrue(os.path.isabs(DEFAULT_FILINGS_DB), 'default relativo quebra quando o CWD muda')
        self.assertTrue(DEFAULT_FILINGS_DB.endswith(os.path.join('prisma', 'dev.db')))

    def test_panel_shortcut_forwards_the_filings_path(self) -> None:
        import inspect

        from python.ml.directional_features import load_directional_panel

        params = inspect.signature(load_directional_panel).parameters
        self.assertIn('filings_db_path', params, 'sem repassar, o worker nunca alcança os filings')

    def test_provenance_reports_full_coverage(self) -> None:
        panel = pd.DataFrame({
            'knowledge_source': [SOURCE_FILING] * 9 + [SOURCE_LEGAL_DEADLINE],
            'is_restatement': [True] * 2 + [False] * 8,
        })
        p = knowledge_provenance(panel)
        self.assertEqual(p['rows'], 10)
        self.assertEqual(p['fromFiling'], 9)
        self.assertEqual(p['fromLegalDeadline'], 1)
        self.assertEqual(p['filingCoverage'], 0.9)
        self.assertEqual(p['restatements'], 2)

    def test_provenance_makes_total_fallback_loud(self) -> None:
        # O caso que passou despercebido: NENHUMA linha veio de filing. A
        # cobertura zero tem que aparecer no resultado do treino.
        panel = pd.DataFrame({
            'knowledge_source': [SOURCE_LEGAL_DEADLINE] * 5,
            'is_restatement': [False] * 5,
        })
        p = knowledge_provenance(panel)
        self.assertEqual(p['filingCoverage'], 0.0)
        self.assertEqual(p['fromFiling'], 0)
        self.assertEqual(p['fromLegalDeadline'], 5)

    def test_provenance_survives_a_panel_without_the_columns(self) -> None:
        p = knowledge_provenance(pd.DataFrame({'x': [1, 2]}))
        self.assertEqual(p['rows'], 2)
        self.assertEqual(p['filingCoverage'], 0.0)


if __name__ == '__main__':
    unittest.main()
