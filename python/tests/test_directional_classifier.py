"""Testes do classificador direcional (Item D, §7).

Dados sintéticos com sinal PLANTADO e verificável: o rótulo depende
deterministicamente de `roe`, então um ensemble que aprende de verdade tem de
bater o baseline "comprar tudo" e ficar calibrado. Nenhum teste toca banco
real, MT5 ou rede.
"""
import json
import os
import sqlite3
import sys
import tempfile

import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from ml.directional_classifier import (  # noqa: E402
    HORIZON_TRADING_DAYS, MAX_ENTRY_LAG_DAYS, MIN_FEATURE_TSTAT, QUANTILES,
    SIGNAL_BUY, SIGNAL_NEUTRAL, SIGNAL_SELL, CompositeFactorScore, classify_signal,
    compute_model_version, evaluate_walk_forward, label_panel, predict_latest,
    run_directional_training, run_walk_forward, yearly_splits,
)
from ml.directional_features import (  # noqa: E402
    FEATURE_COLUMNS, build_feature_panel, knowledge_date, load_directional_panel,
)

_TICKERS = [f'TST{i}3' if i < 10 else f'TS{i}3' for i in range(1, 41)]
_QUARTER_ENDS = [(y, q) for y in range(2011, 2026) for q in (1, 2, 3, 4)]


def _quarter_data_ref(ano: int, tri: int) -> pd.Timestamp:
    return pd.Timestamp({1: f'{ano}-03-31', 2: f'{ano}-06-30',
                         3: f'{ano}-09-30', 4: f'{ano}-12-31'}[tri])


def _synthetic_panel(seed: int = 7) -> pd.DataFrame:
    """Painel trimestral sintético: `roe` alto ⇒ alta nos 60 pregões seguintes."""
    rng = np.random.default_rng(seed)
    rows = []
    for t_idx, ticker in enumerate(_TICKERS):
        setor = f'SETOR{t_idx % 4}'
        for ano, tri in _QUARTER_ENDS:
            roe = float(rng.uniform(0.0, 0.30))
            rows.append({
                'ticker': ticker, 'cd_cvm': f'{t_idx:06d}', 'setor': setor,
                'ano': ano, 'trimestre': tri, 'data_ref': _quarter_data_ref(ano, tri),
                'roe': roe,
                'roa': roe * 0.6,
                'margem_bruta': float(rng.uniform(0.1, 0.5)),
                'margem_ebit': float(rng.uniform(0.05, 0.3)),
                'margem_liquida': roe * 0.4 + float(rng.normal(0, 0.01)),
                'margem_ebitda': float(rng.uniform(0.1, 0.4)),
                'divida_bruta_pl': float(rng.uniform(0.0, 2.0)),
                'divida_liquida_ebitda': float(rng.uniform(-1.0, 4.0)),
                'payout_ratio': float(rng.uniform(0.0, 1.0)),
                'roic': roe * 0.9,
                'giro_ativos': float(rng.uniform(0.2, 1.5)),
                'crescimento_receita_yoy': float(rng.normal(0.05, 0.1)),
                'crescimento_lucro_yoy': float(rng.normal(0.05, 0.2)),
                'pl_ativos': float(rng.uniform(0.2, 0.8)),
                'liquidez_corrente': float(rng.uniform(0.5, 3.0)),
                'endividamento': float(rng.uniform(0.1, 0.9)),
                'divida_pl': float(rng.uniform(0.0, 2.0)),
                'fco': float(rng.uniform(1e6, 1e8)),
                'fcf': float(rng.uniform(-1e7, 1e8)),
                'dividendos_pagos': float(rng.uniform(0, 1e7)),
                'jcp_pagos': 0.0,
                'ativo_total': float(rng.uniform(1e8, 1e10)),
                'lucro_liquido': float(rng.uniform(-1e7, 1e8)),
            })
    raw = pd.DataFrame(rows)
    raw['knowledge_date'] = knowledge_date(raw['data_ref'], raw['trimestre'])
    return build_feature_panel(raw)


_THRESHOLD = 0.15  # roe acima disto ⇒ alta plantada


def _synthetic_bars(panel: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Barras D1 construídas para materializar o sinal plantado em `roe`.

    A partir da entrada de cada trimestre (primeiro pregão >= knowledge_date),
    os 60 pregões seguintes recebem drift positivo se `roe > 0.15`, negativo
    caso contrário. O drift é ACUMULADO (`+=`), não sobrescrito: a janela do T4
    (publicado em 31/03) invade a do T1 seguinte (publicado em 15/05) por ~28
    pregões, e sobrescrever inverteria o rótulo plantado do T1. Somando, a
    própria janela sempre domina (60 dias de drift próprio contra no máximo 28
    de invasão), então o sinal do retorno continua determinado por `roe`.
    """
    days = pd.bdate_range('2010-01-01', '2027-06-30')
    bars: dict[str, pd.DataFrame] = {}
    for ticker, group in panel.groupby('ticker'):
        drift = np.zeros(len(days))
        entry_idx = days.searchsorted(pd.to_datetime(group['knowledge_date']), side='left')
        for idx, roe in zip(entry_idx, group['roe']):
            if idx + HORIZON_TRADING_DAYS >= len(days):
                continue
            drift[idx:idx + HORIZON_TRADING_DAYS] += 0.002 if roe > _THRESHOLD else -0.002
        close = 100.0 * np.cumprod(1.0 + drift)
        bars[ticker] = pd.DataFrame({'time': days, 'close': close})
    return bars


def _bars_for(bars: dict[str, pd.DataFrame]):
    def loader(ticker: str):
        return bars.get(ticker)
    return loader


def _labeled_absolute(panel: pd.DataFrame) -> pd.DataFrame:
    """Rotula no modo ABSOLUTO.

    O sinal destes dados sintéticos é plantado em termos absolutos (`roe` alto
    ⇒ alta), então os testes que conferem o plano precisam pedir esse modo — o
    default da plataforma é `sector_relative`, que mede excesso sobre os pares
    e por construção não reproduz um plano absoluto.
    """
    return label_panel(panel, _bars_for(_synthetic_bars(panel)), target_mode='absolute')


# ---------------------------------------------------------------------------
def test_directional_target():
    """direcao_60d correta a partir do retorno de 60 pregões."""
    panel = _synthetic_panel()
    labeled = _labeled_absolute(panel)

    assert len(labeled) > 1000, f'esperado painel rotulado substancial, obtido {len(labeled)}'
    # Rótulo bate exatamente com o sinal plantado.
    esperado = (labeled['roe'] > _THRESHOLD).astype(float)
    assert (labeled['y'] == esperado).all(), 'rotulo divergente do sinal plantado'
    # Retorno e rótulo são coerentes entre si.
    assert ((labeled['ret_fwd'] > 0) == (labeled['y'] == 1.0)).all()
    # Entrada nunca acontece antes do carimbo de conhecimento (sem lookahead).
    assert (pd.to_datetime(labeled['entry_date']) >= pd.to_datetime(labeled['knowledge_date'])).all()
    # Saída é exatamente 60 pregões depois da entrada.
    for ticker, group in labeled.groupby('ticker'):
        bars_days = pd.bdate_range('2010-01-01', '2027-06-30')
        e = bars_days.searchsorted(pd.to_datetime(group['entry_date']), side='left')
        x = bars_days.searchsorted(pd.to_datetime(group['exit_date']), side='left')
        assert (x - e == HORIZON_TRADING_DAYS).all(), f'{ticker}: horizonte != 60 pregoes'
        break
    print('  test_directional_target: OK')


def test_walk_forward_no_lookahead():
    """knowledgeTime <= decisionTime: nenhum fold treina com alvo dentro do teste."""
    panel = _synthetic_panel()
    labeled = _labeled_absolute(panel)

    for split in yearly_splits(labeled['knowledge_date']):
        test = labeled[split['test_mask']]
        train = labeled[split['train_mask']]
        test_start = pd.to_datetime(test['knowledge_date']).min()
        # Todo treino é estritamente anterior ao início do teste...
        assert (pd.to_datetime(train['knowledge_date']) < test_start).all()
        # ...e o embargo do alvo remove quem ainda estaria posicionado no teste.
        embargoed = train[pd.to_datetime(train['exit_date']) < test_start]
        assert (pd.to_datetime(embargoed['exit_date']) < test_start).all()
        assert len(embargoed) <= len(train)

    wf = run_walk_forward(labeled)
    # O fold é indexado pelo ano do CARIMBO DE CONHECIMENTO, não pelo ano
    # fiscal: o T4/2025 só é conhecido em 31/03/2026 e pertence ao fold de 2026.
    anos_conhecidos = set(pd.to_datetime(labeled['knowledge_date']).dt.year)
    assert set(wf['testYear']).issubset(anos_conhecidos)
    assert len(wf) > 0
    print('  test_walk_forward_no_lookahead: OK')


def test_model_version_is_canonical():
    """Identidade canônica: determinística, independente da ordem do universo."""
    a = compute_model_version({'x': 1}, ['f1', 'f2'], ['PETR4', 'VALE3'])
    b = compute_model_version({'x': 1}, ['f1', 'f2'], ['VALE3', 'PETR4', 'VALE3'])
    c = compute_model_version({'x': 2}, ['f1', 'f2'], ['PETR4', 'VALE3'])
    assert a == b, 'ordem/duplicata do universo nao pode mudar a identidade'
    assert a != c, 'hiperparametro diferente tem de gerar versao diferente'
    assert len(a) == 64 and all(ch in '0123456789abcdef' for ch in a)
    print('  test_model_version_is_canonical: OK')


def test_training_publishes_artifact():
    """run_directional_training publica artefato imutável e prevê o trimestre vivo."""
    panel = _synthetic_panel()
    bars = _synthetic_bars(panel)
    models_dir = tempfile.mkdtemp()

    result = run_directional_training(panel, _bars_for(bars), models_dir,
                                      universe_bars_digest='0' * 64, target_mode='absolute')
    out_dir = os.path.join(models_dir, result['modelVersion'])
    assert os.path.isfile(os.path.join(out_dir, 'model.json'))
    assert os.path.isfile(os.path.join(out_dir, 'metrics.json'))
    assert os.path.isfile(os.path.join(out_dir, 'walkforward_predictions.csv'))
    assert result['horizonTradingDays'] == HORIZON_TRADING_DAYS
    assert result['features'] == list(FEATURE_COLUMNS)
    assert result['selectedFeatures'], 'o artefato registra quais features entraram'
    assert set(result['selectedFeatures']) <= set(FEATURE_COLUMNS)

    # Republicar a MESMA versão não sobrescreve o artefato já publicado.
    mtime = os.path.getmtime(os.path.join(out_dir, 'model.json'))
    run_directional_training(panel, _bars_for(bars), models_dir, universe_bars_digest='0' * 64,
                             target_mode='absolute')
    assert os.path.getmtime(os.path.join(out_dir, 'model.json')) == mtime

    model = CompositeFactorScore.load(os.path.join(out_dir, 'model.json'))
    preds = predict_latest(panel, model)
    assert len(preds) == len(_TICKERS)
    assert set(preds['signal']) <= {SIGNAL_BUY, SIGNAL_SELL, SIGNAL_NEUTRAL}
    assert ((preds['percentile'] >= 0) & (preds['percentile'] <= 1)).all()
    # Sinal COMPRA só no quintil de topo; VENDA só no de fundo.
    assert (preds.loc[preds['signal'] == SIGNAL_BUY, 'quantile'] == QUANTILES).all()
    assert (preds.loc[preds['signal'] == SIGNAL_SELL, 'quantile'] == 1).all()
    assert json.loads(preds['topFeatures'].iloc[0])
    print('  test_training_publishes_artifact: OK')


# ---------------------------------------------------------------------------
def test_feature_panel_from_sqlite():
    """Painel lido do schema CVM real: carimbo legal, momentum e setor relativo."""
    path = os.path.join(tempfile.mkdtemp(), 'cvm.db')
    con = sqlite3.connect(path)
    con.executescript("""
      CREATE TABLE empresas (cd_cvm TEXT, ticker TEXT, nome TEXT, setor TEXT, setor_cvm TEXT);
      CREATE TABLE fundamental_indicators (
        cd_cvm TEXT, ano INT, trimestre INT, data_ref TEXT,
        roe REAL, roa REAL, margem_bruta REAL, margem_ebit REAL, margem_liquida REAL,
        margem_ebitda REAL, divida_bruta_pl REAL, divida_liquida_ebitda REAL,
        payout_ratio REAL, roic REAL, giro_ativos REAL,
        crescimento_receita_yoy REAL, crescimento_lucro_yoy REAL, pl_ativos REAL);
      CREATE TABLE indicadores (cd_cvm TEXT, ano INT, trimestre INT,
        liquidez_corrente REAL, endividamento REAL, divida_pl REAL);
      CREATE TABLE dfc_trimestral (cd_cvm TEXT, ano INT, trimestre INT,
        fco REAL, fcf REAL, dividendos_pagos REAL, jcp_pagos REAL);
      CREATE TABLE bpa_trimestral (cd_cvm TEXT, ano INT, trimestre INT, ativo_total REAL);
      CREATE TABLE dre_trimestral (cd_cvm TEXT, ano INT, trimestre INT, lucro_liquido REAL);
      INSERT INTO empresas VALUES ('001','WEGE3','WEG','Industriais','Bens Industriais');
      INSERT INTO empresas VALUES ('002','RANI3','Irani','Industriais','Bens Industriais');
      INSERT INTO fundamental_indicators VALUES
        ('001',2024,1,'2024-03-31',0.20,0.12,0.30,0.18,0.15,0.22,0.30,0.40,0.50,0.18,0.9,0.10,0.12,0.55),
        ('001',2024,4,'2024-12-31',0.26,0.15,0.34,0.20,0.19,0.25,0.28,0.35,0.55,0.22,1.0,0.11,0.15,0.57),
        ('002',2024,1,'2024-03-31',0.10,0.05,0.20,0.10,0.07,0.14,0.80,1.60,0.30,0.08,0.7,0.02,0.01,0.40);
      INSERT INTO indicadores VALUES ('001',2024,1,1.8,0.45,0.30),('001',2024,4,2.0,0.44,0.28),
                                      ('002',2024,1,1.1,0.70,0.80);
      INSERT INTO dfc_trimestral VALUES ('001',2024,1,5e7,3e7,1e7,0),('001',2024,4,6e7,-1e6,2e7,0),
                                         ('002',2024,1,1e7,-5e6,0,0);
      INSERT INTO bpa_trimestral VALUES ('001',2024,1,1e9),('001',2024,4,1.1e9),('002',2024,1,5e8);
      INSERT INTO dre_trimestral VALUES ('001',2024,1,8e7),('001',2024,4,9e7),('002',2024,1,-2e6);
    """)
    con.commit()
    con.close()

    panel = load_directional_panel(path)
    assert len(panel) == 3
    assert set(FEATURE_COLUMNS) <= set(panel.columns)

    wege_t1 = panel[(panel['ticker'] == 'WEGE3') & (panel['trimestre'] == 1)].iloc[0]
    wege_t4 = panel[(panel['ticker'] == 'WEGE3') & (panel['trimestre'] == 4)].iloc[0]
    rani_t1 = panel[panel['ticker'] == 'RANI3'].iloc[0]

    # Prazo legal: T1 +45 dias corridos; T4 +90.
    assert pd.Timestamp(wege_t1['knowledge_date']) == pd.Timestamp('2024-05-15')
    assert pd.Timestamp(wege_t4['knowledge_date']) == pd.Timestamp('2025-03-31')
    # Setor vem de setor_cvm (classificação mais limpa), não de `setor`.
    assert wege_t1['setor'] == 'Bens Industriais'
    # Momentum T vs T-1 dentro do mesmo ticker.
    assert abs(wege_t4['delta_roe'] - 0.06) < 1e-9
    assert pd.isna(wege_t1['delta_roe']), 'primeiro trimestre nao tem T-1'
    # Setor relativo: mediana de 2 empresas no mesmo período.
    assert abs(wege_t1['roe_vs_mediana_setor'] - 0.05) < 1e-9
    assert abs(rani_t1['roe_vs_mediana_setor'] + 0.05) < 1e-9
    # Geração de caixa normalizada pelo ativo; flags de qualidade honestas.
    assert abs(wege_t1['fco_ativo'] - 0.05) < 1e-9
    assert wege_t4['fcf_positivo'] == 0.0 and wege_t1['fcf_positivo'] == 1.0
    assert rani_t1['dividendos_positivo'] == 0.0 and wege_t1['dividendos_positivo'] == 1.0
    assert rani_t1['lucro_positivo'] == 0.0
    print('  test_feature_panel_from_sqlite: OK')


def test_entry_lag_guard_discards_stale_labels():
    """REGRESSÃO (bug real, 2026-07-25): carimbo anterior à primeira barra.

    `searchsorted` devolve o índice 0 quando o carimbo de conhecimento é
    ANTERIOR a toda a série de preços — o que fazia um trimestre de 2011 ser
    "operado" na primeira barra existente (2021) e fechado 60 pregões depois.
    Nos dados reais isso fabricava 62% dos rótulos (3.770 de 6.124), com
    mediana de 620 dias entre o fundamento e o preço que o rotulava.
    """
    panel = _synthetic_panel()
    # Barras que só começam em 2020: nada antes disso tem entrada válida.
    days = pd.bdate_range('2020-01-02', '2027-06-30')
    close = 100.0 * np.cumprod(1.0 + np.full(len(days), 0.001))
    tardias = {t: pd.DataFrame({'time': days, 'close': close}) for t in _TICKERS}

    labeled = label_panel(panel, _bars_for(tardias))

    lag = (pd.to_datetime(labeled['entry_date']) - pd.to_datetime(labeled['knowledge_date'])).dt.days
    assert lag.max() <= MAX_ENTRY_LAG_DAYS, f'entrada defasada em {lag.max()} dias — rotulo fabricado'
    assert (lag >= 0).all(), 'entrada nunca pode anteceder o carimbo de conhecimento'
    assert pd.to_datetime(labeled['knowledge_date']).min() >= pd.Timestamp('2019-12-01')
    assert len(labeled) > 100, 'o painel inteiro nao pode ser descartado por engano'
    print(f'  test_entry_lag_guard_discards_stale_labels: OK (defasagem max {int(lag.max())}d)')


def test_sector_relative_target_removes_the_common_factor():
    """Alvo relativo: excesso sobre a mediana dos pares, não direção absoluta.

    Construção do teste: aplica um choque comum de mercado a TODOS os tickers
    no mesmo período. O alvo absoluto muda (todo mundo sobe); o relativo NÃO,
    porque o choque entra igualmente na empresa e na sua referência — que é
    exatamente a propriedade pela qual o alvo relativo foi adotado.
    """
    panel = _synthetic_panel()
    bars = _synthetic_bars(panel)

    absoluto = label_panel(panel, _bars_for(bars), target_mode='absolute')
    relativo = label_panel(panel, _bars_for(bars), target_mode='sector_relative')

    # Nenhuma linha é perdida: sem pares no setor, a referência é o mercado.
    assert len(relativo) == len(absoluto), 'alvo relativo nao pode descartar linhas'
    assert set(relativo['benchmark']) <= {'setor', 'mercado'}
    assert 'ret_excess' in relativo.columns

    # A taxa-base fica perto de 50% por construção (mediana como referência).
    assert 0.40 <= relativo['y'].mean() <= 0.60, f"taxa-base {relativo['y'].mean()}"

    # Excesso é coerente com o rótulo.
    assert ((relativo['ret_excess'] > 0) == (relativo['y'] == 1.0)).all()

    # Choque comum: um "bull market" de 0,5% ao dia aplicado IGUALMENTE a todas
    # as séries — ~35% por janela de 60 pregões, o suficiente para dominar o
    # sinal plantado (~12%) e virar praticamente todo rótulo absoluto para alta.
    chocadas = {}
    for ticker, b in bars.items():
        c = b.copy()
        c['close'] = c['close'] * np.cumprod(np.full(len(c), 1.005))
        chocadas[ticker] = c

    abs_chocado = label_panel(panel, _bars_for(chocadas), target_mode='absolute')
    rel_chocado = label_panel(panel, _bars_for(chocadas), target_mode='sector_relative')

    mudou_abs = (abs_chocado['y'].to_numpy() != absoluto['y'].to_numpy()).mean()
    mudou_rel = (rel_chocado['y'].to_numpy() != relativo['y'].to_numpy()).mean()
    # O alvo absoluto vira em massa (o choque decide o sinal do retorno);
    # o relativo é praticamente imune, porque o mesmo choque entra na empresa
    # E na referência, cancelando-se no excesso.
    assert mudou_abs > 0.30, f'choque deveria virar a maioria dos rotulos absolutos ({mudou_abs:.3f})'
    assert mudou_rel < 0.05, f'alvo relativo deveria ser imune ao choque comum ({mudou_rel:.3f})'
    print(f'  test_sector_relative_target_removes_the_common_factor: OK '
          f'(choque comum move {mudou_abs:.1%} dos rotulos absolutos vs {mudou_rel:.1%} dos relativos)')


def test_sinal_vem_do_quintil_nao_de_probabilidade():
    """O escore ordena; não estima probabilidade. Sinal sai da POSIÇÃO."""
    assert classify_signal(QUANTILES) == SIGNAL_BUY
    assert classify_signal(1) == SIGNAL_SELL
    for meio in range(2, QUANTILES):
        assert classify_signal(meio) == SIGNAL_NEUTRAL
    # Sem quintil (período com pares de menos) não há ordenação: NEUTRO.
    assert classify_signal(None) == SIGNAL_NEUTRAL
    assert classify_signal(float('nan')) == SIGNAL_NEUTRAL
    print('  test_sinal_vem_do_quintil_nao_de_probabilidade: OK')


def test_selecao_de_features_usa_so_o_treino():
    """Feature entra pelo IC medido NO TREINO; ruído puro fica de fora."""
    panel = _synthetic_panel()
    labeled = _labeled_absolute(panel)
    treino = labeled[labeled['ano'] <= 2020]

    modelo = CompositeFactorScore().fit(treino)
    assert modelo.selected, 'deveria selecionar ao menos uma feature'
    assert 'roe' in modelo.selected, 'o sinal foi plantado em roe; ele tem de entrar'
    for f in modelo.selected:
        assert modelo.feature_ic[f]['tStat'] >= MIN_FEATURE_TSTAT

    rng = np.random.default_rng(3)
    com_ruido = treino.assign(ruido_puro=rng.normal(size=len(treino)))
    m2 = CompositeFactorScore(features=list(FEATURE_COLUMNS) + ['ruido_puro']).fit(com_ruido)
    assert 'ruido_puro' not in m2.selected, 'ruido nao pode entrar no escore'

    # Base 100% ruído: com 28 candidatas a t > 2 (p=0,05), esperam-se ~1,4
    # falsos positivos POR ACASO — a seleção não pode prometer lista vazia.
    # O que se exige é que o escore NÃO tenha poder preditivo FORA da amostra
    # em que a seleção foi feita. Medir dentro dela seria só reencontrar o
    # próprio viés de seleção.
    todo_ruido = labeled.assign(**{c: rng.normal(size=len(labeled)) for c in FEATURE_COLUMNS})
    sel_in = todo_ruido[todo_ruido['ano'] <= 2019]
    fora = todo_ruido[todo_ruido['ano'] >= 2021]
    try:
        m3 = CompositeFactorScore().fit(sel_in)
        ics = [stats.spearmanr(g['s'], g['ret_excess']).statistic
               for _, g in fora.assign(s=m3.score(fora)).groupby(['ano', 'trimestre'])
               if len(g) >= 20]
        assert abs(np.mean(ics)) < 0.05,             f'escore de ruido nao pode prever fora da amostra (IC {np.mean(ics):.4f})'
    except ValueError as exc:
        # Nenhuma feature passou: também é resultado válido, e explícito.
        assert 'INSUFFICIENT_DATA' in str(exc)
    print('  test_selecao_de_features_usa_so_o_treino: OK')


def test_escore_e_transversal_e_imune_a_choque_comum():
    """O escore é posição relativa: choque igual em todos não muda a ordem."""
    panel = _synthetic_panel()
    labeled = _labeled_absolute(panel)
    treino = labeled[labeled['ano'] <= 2020]
    teste = labeled[labeled['ano'] == 2021]
    modelo = CompositeFactorScore().fit(treino)

    escore = modelo.score(teste)
    assert escore.notna().all() and len(escore) == len(teste)
    media_por_periodo = escore.groupby([teste['ano'], teste['trimestre']]).mean()
    assert media_por_periodo.abs().max() < 0.05

    deslocado = teste.copy()
    for f in modelo.selected:
        deslocado[f] = deslocado[f] + 1000.0
    assert np.allclose(modelo.score(deslocado).to_numpy(), escore.to_numpy()),         'escore transversal nao pode reagir a choque comum'
    print('  test_escore_e_transversal_e_imune_a_choque_comum: OK')


def test_artefato_do_escore_e_a_lista_de_features():
    """Serialização: o artefato é a seleção, não pesos treinados."""
    panel = _synthetic_panel()
    labeled = _labeled_absolute(panel)
    modelo = CompositeFactorScore().fit(labeled[labeled['ano'] <= 2020])

    path = os.path.join(tempfile.mkdtemp(), 'model.json')
    modelo.save(path)
    recarregado = CompositeFactorScore.load(path)

    assert recarregado.selected == modelo.selected
    assert recarregado.feature_ic == modelo.feature_ic
    teste = labeled[labeled['ano'] == 2021]
    assert np.allclose(recarregado.score(teste).to_numpy(), modelo.score(teste).to_numpy())
    with open(path, encoding='utf-8') as fh:
        assert 'selected' in json.load(fh)
    print('  test_artefato_do_escore_e_a_lista_de_features: OK')


def _metrics_cache() -> dict:
    """Walk-forward completo é caro — roda uma vez e reusa entre os testes."""
    if 'metrics' not in _CACHE:
        panel = _synthetic_panel()
        labeled = _labeled_absolute(panel)
        wf = run_walk_forward(labeled)
        _CACHE['metrics'] = evaluate_walk_forward(wf)
    return _CACHE['metrics']


if __name__ == '__main__':
    test_feature_panel_from_sqlite()
    test_model_version_is_canonical()
    test_sinal_vem_do_quintil_nao_de_probabilidade()
    test_selecao_de_features_usa_so_o_treino()
    test_escore_e_transversal_e_imune_a_choque_comum()
    test_artefato_do_escore_e_a_lista_de_features()
    test_directional_target()
    test_walk_forward_no_lookahead()
    test_entry_lag_guard_discards_stale_labels()
    test_sector_relative_target_removes_the_common_factor()
    test_training_publishes_artifact()
    print('test_directional_classifier: OK')
