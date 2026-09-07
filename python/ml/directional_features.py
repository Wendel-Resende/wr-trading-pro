"""Painel trimestral de features fundamentalistas para o classificador direcional.

Item D (spec `docs/architecture/2026-07-25-item-d-directional-classifier-v1.md`).

Regra anti-vazamento (princípio fixo 1 da spec): cada linha do painel carrega
`knowledge_date` = fim do período contábil (`data_ref`) + prazo legal de
publicação (ITR T1–T3 +45 dias corridos; DFP T4 +90 dias) — NUNCA a data
contábil. Toda decisão/treino/target derivados deste painel usam
`knowledge_date` como `decisionTime`, então `knowledgeTime <= decisionTime`
vale por construção.

Este módulo é o ÚNICO ponto que lê fundamentos para o motor direcional: o
antigo caminho diário (`ml/fundamentals.py::asof_fundamentals`) casava
fundamentos trimestrais com features de preço diárias, o que fazia sentido no
horizonte de 10 pregões do motor híbrido; aqui a unidade de observação é o
próprio trimestre (uma linha por empresa/trimestre), alinhada ao horizonte de
60 pregões (decisão de arquitetura 2 da spec).
"""
import os
import sqlite3

import pandas as pd

# Prazo legal de publicação — FALLBACK, não mais a regra principal.
#
# Até 2026-09-06 o carimbo de conhecimento era sempre `data_ref + prazo
# legal`. Medido sobre os 48.593 filings reais ingeridos de `CvmFiling`:
# a mediana confirma o proxy (ITR 44d, DFP 83d), mas 21,3% dos ITR e 19,4%
# das DFP são entregues DEPOIS do prazo — nessas, o painel tratava o
# fundamento como conhecido antes de existir. No universo desta base, são
# 13,3% dos ITR e 11,6% das DFP.
#
# Agora o carimbo vem de `DT_RECEB` real. Estes valores sobram para as
# linhas que não casam com nenhum filing (5 de 7.085 hoje) e para quando o
# banco de filings não está disponível — sempre com `knowledge_source`
# dizendo qual dos dois foi usado.
LAG_ITR_DAYS = 45
LAG_DFP_DAYS = 90

#: Caminho default do banco que guarda `CvmFiling` (o banco do app, não o
#: snapshot da CVM). Escrever a data dentro de `cvm_fundamentos.db` seria
#: inútil: ele é recopiado do WSL e a coluna se perderia.
DEFAULT_FILINGS_DB = os.path.join('prisma', 'dev.db')

#: Origem do carimbo de conhecimento, exposta no painel para que o fallback
#: nunca passe despercebido.
SOURCE_FILING = 'DT_RECEB'
SOURCE_LEGAL_DEADLINE = 'PRAZO_LEGAL'

# --- Blocos de features declarados na spec (§4.1) ------------------------------
RENTABILIDADE = ['roe', 'roa', 'margem_bruta', 'margem_ebit', 'margem_liquida']
SAUDE_FINANCEIRA = ['divida_pl', 'liquidez_corrente', 'endividamento',
                    'divida_bruta_pl', 'divida_liquida_ebitda']
GERACAO_CAIXA = ['fcf_ativo', 'fco_ativo']
CRESCIMENTO = ['crescimento_receita_yoy', 'crescimento_lucro_yoy',
               'giro_ativos', 'payout_ratio', 'roic']
MOMENTUM_BASE = ['roe', 'margem_bruta', 'margem_liquida', 'roic', 'margem_ebit']
MOMENTUM = [f'delta_{c}' for c in MOMENTUM_BASE]
QUALIDADE = ['fcf_positivo', 'dividendos_positivo', 'lucro_positivo']
SETOR_RELATIVO_BASE = ['roe', 'margem_liquida', 'roic', 'divida_bruta_pl', 'margem_ebitda']
SETOR_RELATIVO = [f'{c}_vs_mediana_setor' for c in SETOR_RELATIVO_BASE]

#: Ordem canônica das features — entra no hash da `modelVersion` (§4.4), então
#: qualquer mudança aqui produz uma versão de modelo distinta, por construção.
FEATURE_COLUMNS = (RENTABILIDADE + ['margem_ebitda'] + SAUDE_FINANCEIRA
                   + GERACAO_CAIXA + CRESCIMENTO + MOMENTUM + QUALIDADE + SETOR_RELATIVO)

#: Colunas lidas de `fundamental_indicators` (indicadores 12M do pipeline CVM).
_FI_COLUMNS = ['roe', 'roa', 'margem_bruta', 'margem_ebit', 'margem_liquida', 'margem_ebitda',
               'divida_bruta_pl', 'divida_liquida_ebitda', 'payout_ratio', 'roic',
               'giro_ativos', 'crescimento_receita_yoy', 'crescimento_lucro_yoy', 'pl_ativos']
#: Colunas lidas de `indicadores` (trimestral) — só as que NÃO existem em
#: `fundamental_indicators`. Misturar as duas fontes no mesmo indicador foi um
#: bug real da ficha fundamentalista v1 (escalas incompatíveis: percentual
#: trimestral vs decimal 12M); aqui cada indicador vem de uma fonte só.
_IND_COLUMNS = ['liquidez_corrente', 'endividamento', 'divida_pl']


def _connect_ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=30)


def knowledge_date(data_ref: pd.Series, trimestre: pd.Series) -> pd.Series:
    """Carimbo de conhecimento = fim do período + prazo legal de publicação."""
    lag = trimestre.map(lambda q: LAG_DFP_DAYS if int(q) == 4 else LAG_ITR_DAYS)
    return pd.to_datetime(data_ref) + pd.to_timedelta(lag, unit='D')


def load_filing_dates(filings_db_path: str) -> pd.DataFrame:
    """Data de publicação REAL por (cd_cvm, ano, trimestre), da tabela `CvmFiling`.

    Devolve a ÚLTIMA versão de cada documento, não a primeira — e essa é a
    escolha que corrige o vazamento por retificação. O valor guardado em
    `fundamental_indicators` já é o retificado; carimbá-lo com a data da v1
    afirmaria que se conhecia em maio um número publicado em novembro. 19%
    das linhas desta base são retificação.

    Mapeamento de trimestre: a WR usa 1..4, onde 4 é o exercício anual. A
    CVM publica os trimestres 1..3 como ITR e o quarto período como DFP.

    Devolve DataFrame vazio (sem lançar) se o banco não existir ou não tiver
    a tabela — o painel então cai no prazo legal, sinalizado.
    """
    if not os.path.exists(filings_db_path):
        return pd.DataFrame(columns=['cd_cvm_norm', 'ano', 'trimestre', 'publicado_em', 'is_restatement'])

    sql = """
        SELECT i.cvmCode                                   AS cd_cvm_norm,
               f.fiscalYear                                AS ano,
               CASE WHEN f.documentType = 'ITR' THEN f.fiscalQuarter ELSE 4 END AS trimestre,
               MAX(f.publishedAt)                          AS publicado_em,
               MAX(f.isRestatement)                        AS is_restatement
          FROM CvmFiling f
          JOIN Issuer i ON i.id = f.issuerId
         WHERE f.documentType IN ('ITR', 'DFP')
      GROUP BY 1, 2, 3
    """
    con = _connect_ro(filings_db_path)
    try:
        df = pd.read_sql_query(sql, con)
    except (sqlite3.DatabaseError, pd.errors.DatabaseError):
        return pd.DataFrame(columns=['cd_cvm_norm', 'ano', 'trimestre', 'publicado_em', 'is_restatement'])
    finally:
        con.close()

    if df.empty:
        return df
    # Prisma grava DateTime como epoch em milissegundos.
    df['publicado_em'] = pd.to_datetime(df['publicado_em'], unit='ms').dt.normalize()
    df['is_restatement'] = df['is_restatement'].astype(bool)
    return df


def apply_real_knowledge_dates(df: pd.DataFrame, filings: pd.DataFrame) -> pd.DataFrame:
    """Substitui o carimbo por `DT_RECEB` real onde houver filing casado.

    Onde não houver, mantém o prazo legal — e `knowledge_source` diz qual
    dos dois valeu para cada linha. Uma linha que cai no fallback não é
    erro; é o que a fonte permite, e precisa ser visível para quem lê.
    """
    df = df.copy()
    df['knowledge_source'] = SOURCE_LEGAL_DEADLINE
    df['is_restatement'] = False

    if filings.empty:
        return df

    df['cd_cvm_norm'] = df['cd_cvm'].astype(str).str.lstrip('0')
    merged = df.merge(filings, on=['cd_cvm_norm', 'ano', 'trimestre'], how='left', suffixes=('', '_filing'))

    casadas = merged['publicado_em'].notna()
    merged.loc[casadas, 'knowledge_date'] = merged.loc[casadas, 'publicado_em']
    merged.loc[casadas, 'knowledge_source'] = SOURCE_FILING
    marcadas = merged.loc[casadas, 'is_restatement_filing'].astype('boolean').fillna(False).astype(bool)
    merged.loc[casadas, 'is_restatement'] = marcadas

    return merged.drop(columns=['cd_cvm_norm', 'publicado_em', 'is_restatement_filing'], errors='ignore')


def load_quarterly_panel(cvm_db_path: str, tickers: list[str] | None = None,
                         filings_db_path: str | None = None) -> pd.DataFrame:
    """Lê o painel cru (uma linha por empresa/trimestre) do snapshot CVM.

    Colunas de saída: ticker, cd_cvm, setor, ano, trimestre, data_ref,
    knowledge_date + os indicadores crus. Empresas sem ticker são descartadas
    (não há como casar com barras D1). Nunca fabrica valor ausente: indicador
    faltante vira NaN e assim permanece até o imputador do modelo.
    """
    fi = ', '.join(f'fi.{c}' for c in _FI_COLUMNS)
    ind = ', '.join(f'ind.{c}' for c in _IND_COLUMNS)
    sql = f"""
        SELECT e.ticker, e.cd_cvm, COALESCE(e.setor_cvm, e.setor, 'DESCONHECIDO') AS setor,
               fi.ano, fi.trimestre, fi.data_ref, {fi}, {ind},
               dfc.fco, dfc.fcf, dfc.dividendos_pagos, dfc.jcp_pagos,
               bpa.ativo_total, dre.lucro_liquido
          FROM fundamental_indicators fi
          JOIN empresas e ON e.cd_cvm = fi.cd_cvm
          LEFT JOIN indicadores ind
                 ON ind.cd_cvm = fi.cd_cvm AND ind.ano = fi.ano AND ind.trimestre = fi.trimestre
          LEFT JOIN dfc_trimestral dfc
                 ON dfc.cd_cvm = fi.cd_cvm AND dfc.ano = fi.ano AND dfc.trimestre = fi.trimestre
          LEFT JOIN bpa_trimestral bpa
                 ON bpa.cd_cvm = fi.cd_cvm AND bpa.ano = fi.ano AND bpa.trimestre = fi.trimestre
          LEFT JOIN dre_trimestral dre
                 ON dre.cd_cvm = fi.cd_cvm AND dre.ano = fi.ano AND dre.trimestre = fi.trimestre
         WHERE e.ticker IS NOT NULL AND fi.data_ref IS NOT NULL
         ORDER BY e.ticker, fi.data_ref
    """
    con = _connect_ro(cvm_db_path)
    try:
        df = pd.read_sql_query(sql, con)
    finally:
        con.close()

    if tickers is not None:
        df = df[df['ticker'].isin(set(tickers))].copy()
    if df.empty:
        return df

    df['data_ref'] = pd.to_datetime(df['data_ref'])
    # Prazo legal primeiro, como base; a data real sobrescreve onde existir.
    df['knowledge_date'] = knowledge_date(df['data_ref'], df['trimestre'])
    df = apply_real_knowledge_dates(df, load_filing_dates(filings_db_path or DEFAULT_FILINGS_DB))
    return df.sort_values(['ticker', 'data_ref']).reset_index(drop=True)


def build_feature_panel(raw: pd.DataFrame) -> pd.DataFrame:
    """Deriva geração de caixa, momentum, flags de qualidade e setor relativo.

    Momentum (T vs T-1) usa `shift(1)` DENTRO de cada ticker sobre o painel já
    ordenado por `data_ref` — nunca olha para o futuro. Setor relativo usa a
    mediana do setor no MESMO trimestre; como todas as empresas do trimestre
    compartilham o mesmo prazo legal, a mediana só é conhecida a partir do
    `knowledge_date` mais tardio do grupo, então o carimbo do painel é
    reajustado para esse máximo (nunca para o mínimo, que vazaria).
    """
    if raw.empty:
        return raw.assign(**{c: pd.Series(dtype=float) for c in FEATURE_COLUMNS})

    df = raw.copy()

    ativo = df['ativo_total'].where(df['ativo_total'] > 0)
    df['fcf_ativo'] = df['fcf'] / ativo
    df['fco_ativo'] = df['fco'] / ativo

    df['fcf_positivo'] = (df['fcf'] > 0).astype(float).where(df['fcf'].notna())
    proventos = df['dividendos_pagos'].fillna(0).abs() + df['jcp_pagos'].fillna(0).abs()
    df['dividendos_positivo'] = (proventos > 0).astype(float)
    df['lucro_positivo'] = (df['lucro_liquido'] > 0).astype(float).where(df['lucro_liquido'].notna())

    for col in MOMENTUM_BASE:
        df[f'delta_{col}'] = df.groupby('ticker')[col].diff()

    # Setor relativo: mediana por (setor, período). Períodos com um único
    # emissor no setor produzem diferença 0 — informativo-neutro, nunca NaN
    # fabricado nem descarte silencioso da linha.
    for col in SETOR_RELATIVO_BASE:
        mediana = df.groupby(['setor', 'ano', 'trimestre'])[col].transform('median')
        df[f'{col}_vs_mediana_setor'] = df[col] - mediana

    df['knowledge_date'] = df.groupby(['setor', 'ano', 'trimestre'])['knowledge_date'].transform('max')

    for col in FEATURE_COLUMNS:
        if col not in df.columns:
            df[col] = pd.Series([float('nan')] * len(df), index=df.index)
        df[col] = pd.to_numeric(df[col], errors='coerce')

    return df.sort_values(['knowledge_date', 'ticker']).reset_index(drop=True)


def load_directional_panel(cvm_db_path: str, tickers: list[str] | None = None) -> pd.DataFrame:
    """Atalho: painel cru + features derivadas, pronto para o rotulador."""
    return build_feature_panel(load_quarterly_panel(cvm_db_path, tickers))
