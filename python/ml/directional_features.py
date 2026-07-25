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
import sqlite3

import pandas as pd

# Prazo legal de publicação — mesmos valores de `ml/fundamentals.py`
# (fonte única conceitual; replicado aqui porque aquele módulo trabalha em
# grade diária e será removido junto com o motor híbrido).
LAG_ITR_DAYS = 45
LAG_DFP_DAYS = 90

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


def load_quarterly_panel(cvm_db_path: str, tickers: list[str] | None = None) -> pd.DataFrame:
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
    df['knowledge_date'] = knowledge_date(df['data_ref'], df['trimestre'])
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
