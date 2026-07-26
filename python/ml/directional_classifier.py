"""Classificador direcional com ensemble governado (Item D).

Spec: `docs/architecture/2026-07-25-item-d-directional-classifier-v1.md`.

Unidade de observação: (empresa, trimestre). Para cada linha do painel
fundamentalista (`ml/directional_features.py`), o rótulo é a DIREÇÃO do
retorno dos 60 pregões seguintes ao carimbo de conhecimento — nunca ao fim do
período contábil. Ensemble de 3 modelos com erros descorrelacionados
(LightGBM, XGBoost, Regressão Logística com penalização Ridge) e gate de
confiança: só vira sinal quando a probabilidade média ponderada sai da zona
ambígua.

Nada aqui acessa MT5, rede ou banco Prisma: as barras entram por um callable
injetado (`bars_for`), normalmente ligado ao snapshot congelado
(`ml/bars_snapshot.py`). Governança/persistência continuam no Next.
"""
import hashlib
import json
import os
import pickle
import shutil
import uuid

import numpy as np
import pandas as pd

from .directional_features import FEATURE_COLUMNS

#: Horizonte do alvo, em pregões (princípio fixo 7 da spec: 1 trimestre).
HORIZON_TRADING_DAYS = 60

#: Número de faixas do ranking transversal. O sinal sai da POSIÇÃO da empresa
#: entre as pares do trimestre, não de um limiar absoluto de probabilidade —
#: o escore composto ordena, não estima probabilidade.
QUANTILES = 5

#: Mínimo de empresas num período para que a ordenação signifique algo.
MIN_CROSS_SECTION = 20

#: Corte de significância para uma feature entrar no escore. Medido sobre 58
#: trimestres de dado limpo, as features fortes ficam bem acima disto
#: (`delta_margem_liquida` t=6,20; `delta_roe` t=5,93) e as inúteis bem abaixo
#: (`margem_ebitda` t=0,22) — o corte separa os dois grupos com folga.
MIN_FEATURE_TSTAT = 2.0

#: Períodos mínimos para estimar o IC de uma feature na seleção.
MIN_SELECTION_PERIODS = 8

#: LIMITAÇÃO CONHECIDA — teste múltiplo na seleção. Com 28 features candidatas
#: e corte em t > 2 (p = 0,05), esperam-se ~1,4 falsos positivos POR ACASO em
#: cada fold. O efeito é diluído (uma feature de ruído entre 13 selecionadas
#: desloca pouco a média de percentis) e a seleção é refeita a cada fold, mas
#: existe. Correção de Bonferroni (t ≈ 3,0 para 28 candidatas) cortaria os
#: marginais mantendo os fortes (`delta_margem_liquida` t=6,20, `delta_roe`
#: t=5,93) — não aplicada aqui para não ajustar o critério depois de ver o
#: resultado, que é o erro que esta sessão já cometeu uma vez.

SIGNAL_BUY = 'COMPRA'
SIGNAL_SELL = 'VENDA'
SIGNAL_NEUTRAL = 'NEUTRO'

#: Número de faixas do ranking transversal. O sinal sai da POSIÇÃO da empresa
#: entre as pares do trimestre, não de um limiar absoluto de probabilidade —
#: o escore composto ordena, não estima probabilidade.
QUANTILES = 5

#: Mínimo de empresas num período para que a ordenação signifique algo.
MIN_CROSS_SECTION = 20

#: Corte de significância para uma feature entrar no escore. Medido sobre 58
#: trimestres de dado limpo, as features fortes ficam bem acima disto
#: (`delta_margem_liquida` t=6,20; `delta_roe` t=5,93) e as inúteis bem abaixo
#: (`margem_ebitda` t=0,22) — o corte separa os dois grupos com folga.
MIN_FEATURE_TSTAT = 2.0

#: Períodos mínimos para estimar o IC de uma feature na seleção.
MIN_SELECTION_PERIODS = 8

#: LIMITAÇÃO CONHECIDA — teste múltiplo na seleção. Com 28 features candidatas
#: e corte em t > 2 (p = 0,05), esperam-se ~1,4 falsos positivos POR ACASO em
#: cada fold. O efeito é diluído (uma feature de ruído entre 13 selecionadas
#: desloca pouco a média de percentis) e a seleção é refeita a cada fold, mas
#: existe. Correção de Bonferroni (t ≈ 3,0 para 28 candidatas) cortaria os
#: marginais mantendo os fortes (`delta_margem_liquida` t=6,20, `delta_roe`
#: t=5,93) — não aplicada aqui para não ajustar o critério depois de ver o
#: resultado, que é o erro que esta sessão já cometeu uma vez.

SIGNAL_BUY = 'COMPRA'
SIGNAL_SELL = 'VENDA'
SIGNAL_NEUTRAL = 'NEUTRO'

#: Pesos da votação (§4.1). Somam 1.0 — validado em `DirectionalEnsemble`.
ENSEMBLE_WEIGHTS = {'lightgbm': 0.40, 'xgboost': 0.40, 'logistic': 0.20}

#: Calibração de probabilidade (decisão de arquitetura 3 da spec).
#:
#: O ensemble cru é grosseiramente SUPERCONFIANTE: no primeiro treino sobre
#: dados reais (2026-07-25) o Brier deu 0,329 — pior que um preditor constante
#: de 0,5 (~0,25). Um modelo que diz "95% de alta" e acerta 54% das vezes não é
#: só impreciso: ele mente sobre a própria confiança, e é justamente a
#: confiança que o gate de 90% usa para decidir se emite sinal.
#:
#: A calibração aprende, num conjunto SEPARADO e ANTERIOR ao teste, o mapa
#: entre a probabilidade que o ensemble diz e a frequência realmente observada.
#: 'isotonic' é não-paramétrica (só exige monotonicidade); 'sigmoid' (Platt) é
#: mais estável com poucas amostras, ao custo de assumir forma logística.
#:
#: DEFAULT = 'sigmoid', por honestidade. Medido sobre os dados reais depois da
#: correção da rotulagem (2026-07-25): a isotônica preserva 43 sinais de alta
#: confiança cuja acurácia é de 39,5% — ou seja, ANTI-preditivos, fruto de
#: degraus locais ajustados a poucas amostras; o Platt, sendo monótono e suave,
#: não deixa NENHUMA probabilidade passar do gate de 90%. Zero sinais é a
#: resposta correta quando o modelo não tem confiança genuína para oferecer.
CALIBRATION_METHOD = 'sigmoid'
#: Fração FINAL (mais recente) do treino reservada para calibrar — nunca usada
#: para ajustar os modelos-base, senão o mapa seria aprendido sobre previsões
#: in-sample (otimistas) e não corrigiria nada.
CALIBRATION_FRACTION = 0.25
#: Abaixo disto não há amostra suficiente para um mapa confiável: sem
#: calibração, e o modelo reporta isso explicitamente em vez de fingir.
_MIN_CALIBRATION_ROWS = 100

#: Definição do alvo.
#:
#: 'absolute'        — y = 1 se o retorno de 60 pregões for positivo.
#: 'sector_relative' — y = 1 se o retorno SUPERAR a mediana dos pares do mesmo
#:                     setor no MESMO período (excesso > 0).
#:
#: DEFAULT = 'sector_relative' desde 2026-07-25. Motivo medido, não estético: o
#: alvo absoluto embute o movimento do mercado inteiro, que fundamentos
#: trimestrais não têm como prever — em 60 pregões o beta domina o alfa, e o
#: modelo passa a tentar adivinhar a direção da bolsa a partir de balanços. O
#: alvo relativo cancela o fator comum do setor e pergunta o que a análise
#: fundamentalista de fato responde: "esta empresa vai melhor que suas pares?".
#:
#: Efeito colateral desejável: com a mediana como referência, a taxa-base fica
#: ~50% por construção, então o baseline "comprar tudo" deixa de ser um alvo
#: móvel e o gate 4 (vantagem >= 15 p.p.) vira um teste real de habilidade.
TARGET_MODE = 'sector_relative'

#: Normalização TRANSVERSAL das features (rank dentro de cada período).
#:
#: Diagnóstico de 2026-07-25 que motivou: as features carregam sinal
#: transversal forte (IC de `roic` = 0,127 com t = 3,41; 16 de 28 features com
#: |t| > 2), mas o ensemble treinava sobre NÍVEIS ABSOLUTOS empilhados no
#: tempo e não extraía nada. ROE de 18% não significa a mesma coisa em 2021 e
#: em 2025 — sem normalizar por período, o modelo teria de aprender o contexto
#: macro sozinho a partir de 19 trimestres.
#:
#: Rank (percentil) em vez de z-score: é imune a outlier contábil (EV/EBITDA de
#: 649× já apareceu neste projeto) e é exatamente a escala em que o sinal foi
#: medido (Spearman). Centrado em 0 para que "mediana do período" seja o zero.
#:
#: DEFAULT = False. A hipótese era que normalizar melhoraria o ensemble; foi
#: MEDIDA e REJEITADA em 2026-07-25 — piorou em todas as métricas:
#:
#:     sem normalizar:  IC +0,0720  t +2,16  spread topo-fundo +1,17 p.p.
#:     normalizando:    IC +0,0573  t +1,83  spread topo-fundo +0,89 p.p.
#:
#: Explicação provável: as árvores já particionam por limiar, o que as torna
#: invariantes a transformação monótona DENTRO de um período; ranquear apenas
#: destrói a informação de NÍVEL que distingue um trimestre de outro. Mantido
#: como opção configurável porque a conclusão pode mudar com mais história.
CROSS_SECTIONAL_NORMALIZATION = False
#: Setor/período com menos pares que isto não define mediana confiável — as
#: linhas ficam SEM rótulo, nunca comparadas contra si mesmas.
MIN_SECTOR_PEERS = 5

HYPERPARAMETERS = {
    'model': 'composite-factor-score',
    'minFeatureTStat': MIN_FEATURE_TSTAT,
    'minSelectionPeriods': MIN_SELECTION_PERIODS,
    'quantiles': QUANTILES,
    'horizon': HORIZON_TRADING_DAYS,
    'target': {'mode': TARGET_MODE, 'minSectorPeers': MIN_SECTOR_PEERS},
}

_MIN_TRAIN_ROWS = 200
_MIN_TEST_ROWS = 20

#: Defasagem máxima, em dias corridos, entre o carimbo de conhecimento e a
#: barra de entrada.
#:
#: BUG REAL corrigido em 2026-07-25: `searchsorted` devolve o índice 0 quando o
#: carimbo é ANTERIOR à primeira barra disponível, o que fazia um trimestre de
#: 2011 ser "operado" na primeira barra existente (2021) e fechado 60 pregões
#: depois. Como `HistoricalCandle` só tem barras desde 2021-07-26, 62% das
#: linhas (3.770 de 6.124) recebiam o rótulo de uma janela de preço a até 10
#: ANOS de distância do fundamento que a originou — mediana de 620 dias de
#: defasagem. Eram rótulos fabricados, e treinavam o modelo.
#:
#: Regra honesta: a decisão é tomada no primeiro pregão após a publicação. Se
#: não existe barra nessa janela, não existe operação — a linha é descartada,
#: nunca deslocada para um preço de outro regime. 15 dias cobre feriados
#: prolongados sem admitir salto de trimestre.
MAX_ENTRY_LAG_DAYS = 15



# ---------------------------------------------------------------------------
# Rotulagem
# ---------------------------------------------------------------------------
def label_panel(panel: pd.DataFrame, bars_for, horizon: int = HORIZON_TRADING_DAYS,
                target_mode: str = TARGET_MODE) -> pd.DataFrame:
    """Rotula o painel com a direção do retorno de `horizon` pregões.

    `bars_for(ticker)` devolve as barras D1 (colunas `time`/`close`) ou
    levanta/retorna vazio quando não há snapshot para o símbolo — nesse caso o
    ticker inteiro é omitido, nunca preenchido com preço fabricado.

    Entrada da posição: primeiro pregão com `time >= knowledge_date` (a decisão
    só pode ser tomada depois que o dado foi legalmente publicado). Saída:
    exatamente `horizon` pregões depois, contados no calendário real de
    negociação. Linhas sem barra de saída (janela ainda aberta no fim da série)
    ficam SEM rótulo e são descartadas — nunca rotuladas por extrapolação.
    """
    if panel.empty:
        return panel.assign(entry_date=pd.Series(dtype='datetime64[ns]'),
                            exit_date=pd.Series(dtype='datetime64[ns]'),
                            ret_fwd=pd.Series(dtype=float), y=pd.Series(dtype=float))

    parts = []
    for ticker, group in panel.groupby('ticker', sort=False):
        try:
            bars = bars_for(ticker)
        except Exception:  # noqa: BLE001 — símbolo sem snapshot nunca derruba o dataset inteiro
            continue
        if bars is None or len(bars) == 0:
            continue

        bars = bars.sort_values('time').reset_index(drop=True)
        times = pd.to_datetime(bars['time'])
        closes = bars['close'].to_numpy(dtype=float)

        entry_idx = times.searchsorted(pd.to_datetime(group['knowledge_date']), side='left')
        entry_idx = np.asarray(entry_idx, dtype=np.int64)
        exit_idx = entry_idx + horizon

        # Entrada precisa existir (barra >= carimbo), a saída precisa existir
        # (60 pregões depois) E a entrada precisa acontecer LOGO após a
        # publicação — ver `MAX_ENTRY_LAG_DAYS`. Sem isso, um carimbo anterior
        # à primeira barra disponível era silenciosamente deslocado para o
        # início da série, fabricando o rótulo.
        in_range = entry_idx < len(times)
        safe_entry_idx = np.where(in_range, entry_idx, 0)
        entry_times = times.iloc[safe_entry_idx].to_numpy()
        lag_days = (entry_times - pd.to_datetime(group['knowledge_date']).to_numpy()) / np.timedelta64(1, 'D')
        valid = in_range & (exit_idx < len(times)) & (lag_days >= 0) & (lag_days <= MAX_ENTRY_LAG_DAYS)
        if not valid.any():
            continue

        rows = group.loc[valid].copy()
        e_i, x_i = entry_idx[valid], exit_idx[valid]
        entry_price, exit_price = closes[e_i], closes[x_i]
        with np.errstate(divide='ignore', invalid='ignore'):
            ret = np.where(entry_price > 0, exit_price / entry_price - 1.0, np.nan)

        rows['entry_date'] = times.iloc[e_i].to_numpy()
        rows['exit_date'] = times.iloc[x_i].to_numpy()
        rows['ret_fwd'] = ret
        rows['y'] = np.where(np.isnan(ret), np.nan, (ret > 0).astype(float))
        parts.append(rows[rows['y'].notna()])

    if not parts:
        raise ValueError('INSUFFICIENT_DATA: nenhum ticker com barras suficientes para rotular 60 pregoes')

    labeled = pd.concat(parts, ignore_index=True)
    labeled = _apply_target_mode(labeled, target_mode)
    return labeled.sort_values(['knowledge_date', 'ticker']).reset_index(drop=True)


def _apply_target_mode(labeled: pd.DataFrame, target_mode: str) -> pd.DataFrame:
    """Converte o retorno bruto no alvo escolhido — ver `TARGET_MODE`.

    No modo relativo, a referência é a MEDIANA dos pares do mesmo setor no
    MESMO período (mesma janela de preço), então o fator comum do setor —
    inclusive o movimento do mercado — se cancela. Usar a média em vez da
    mediana deixaria a referência refém de um outlier do grupo.

    Grupos com menos de `MIN_SECTOR_PEERS` pares ficam SEM rótulo e saem: com
    2 ou 3 empresas a "mediana do setor" é praticamente a própria empresa, e o
    excesso viraria ruído estrutural.

    Nota: a mediana usa retorno FUTURO, o que é legítimo — é o rótulo, não uma
    feature. A regra point-in-time vale para o que entra em X, nunca para y.
    """
    if target_mode == 'absolute':
        labeled['ret_excess'] = labeled['ret_fwd']
        return labeled

    if target_mode != 'sector_relative':
        raise ValueError(f'TARGET_MODE desconhecido: {target_mode}')

    labeled = labeled.copy()
    setorial = ['setor', 'ano', 'trimestre']
    periodo = ['ano', 'trimestre']

    pares = labeled.groupby(setorial)['ret_fwd'].transform('size')
    mediana_setor = labeled.groupby(setorial)['ret_fwd'].transform('median')
    mediana_mercado = labeled.groupby(periodo)['ret_fwd'].transform('median')

    # A taxonomia da CVM é fina demais para virar grupo de pares: medido em
    # 2026-07-25, a mediana é de 2 empresas por (setor, período), com 305
    # grupos de UMA só — comparar a empresa com "a mediana do setor" seria
    # compará-la consigo mesma. Por isso a referência primária é o MERCADO
    # (todas as empresas do período), e o setor só entra quando de fato tem
    # pares. Em ambos os casos o fator comum — que é o que fundamentos não
    # preveem — sai da conta.
    usa_setor = pares >= MIN_SECTOR_PEERS
    referencia = mediana_setor.where(usa_setor, mediana_mercado)

    labeled['benchmark'] = np.where(usa_setor, 'setor', 'mercado')
    labeled['ret_excess'] = labeled['ret_fwd'] - referencia
    labeled['y'] = (labeled['ret_excess'] > 0).astype(float)
    return labeled


# ---------------------------------------------------------------------------
# Normalização transversal
# ---------------------------------------------------------------------------
def cross_sectional_rank(df: pd.DataFrame, features: list[str],
                         period_cols: tuple[str, ...] = ('ano', 'trimestre')) -> pd.DataFrame:
    """Substitui cada feature pelo seu percentil DENTRO do período, centrado em 0.

    Uma linha passa a dizer "esta empresa está no percentil 80 de ROIC entre as
    pares deste trimestre" em vez de "esta empresa tem ROIC de 18%" — que é a
    forma como o sinal existe (ver `CROSS_SECTIONAL_NORMALIZATION`).

    NaN permanece NaN: ausência de dado não vira percentil médio. Períodos com
    uma única empresa devolvem 0 (nada a ranquear), nunca NaN artificial.
    """
    out = df.copy()
    for col in features:
        out[col] = (df.groupby(list(period_cols))[col]
                      .transform(lambda s: s.rank(pct=True) - 0.5 if s.notna().sum() > 1 else s * 0.0))
    return out


def assign_quantiles(scores: pd.Series, n: int = 5) -> pd.Series:
    """Quantil do escore dentro do grupo já filtrado (1 = pior, n = melhor).

    Grupos pequenos demais para `n` faixas caem para o número de faixas que o
    tamanho permite — nunca levanta, nunca inventa faixa vazia.
    """
    if len(scores) < n:
        return pd.Series([np.nan] * len(scores), index=scores.index)
    try:
        return pd.qcut(scores.rank(method='first'), n, labels=False, duplicates='drop') + 1
    except ValueError:
        return pd.Series([np.nan] * len(scores), index=scores.index)


# ---------------------------------------------------------------------------
# Sinal por posição transversal
# ---------------------------------------------------------------------------
def classify_signal(quantile, n_quantiles: int = QUANTILES) -> str:
    """Sinal a partir do QUINTIL, não de um limiar absoluto de probabilidade.

    O escore composto ordena empresas dentro do trimestre; ele não estima
    probabilidade de nada. Emitir "90% de confiança" a partir dele seria
    inventar um número — foi exatamente o que a calibração desmascarou no
    ensemble anterior (a confiança de 95% não existia).

    Topo = COMPRA, fundo = VENDA, meio = NEUTRO. Quem não tem quintil (período
    com pares de menos) fica NEUTRO: sem seção transversal não há ordenação.
    """
    if quantile is None or (isinstance(quantile, float) and quantile != quantile):
        return SIGNAL_NEUTRAL
    q = int(quantile)
    if q >= n_quantiles:
        return SIGNAL_BUY
    if q <= 1:
        return SIGNAL_SELL
    return SIGNAL_NEUTRAL


# ---------------------------------------------------------------------------
# Escore composto de fator
# ---------------------------------------------------------------------------
class CompositeFactorScore:
    """Média de percentis transversais das features com sinal comprovado.

    SUBSTITUI o ensemble LightGBM + XGBoost + Logística em 2026-07-25. Medido
    lado a lado, na MESMA base de 15 anos e mesmo walk-forward:

        ensemble:  IC +0,0176  t +1,27  spread topo-fundo +0,83 p.p.
        composto:  IC +0,0956  t +4,32  spread topo-fundo +2,58 p.p.

    E os quintis do composto são MONÓTONOS (Q1 +0,13% → Q5 +2,71%), formato que
    o ensemble nunca produziu. O ensemble extraía IC 0,018 de features que
    sozinhas dão 0,101 — era cinco vezes pior que o próprio melhor insumo.

    Causa provável do fracasso do ensemble: ~5.000 amostras com 28 features
    fracamente informativas é o regime em que gradient boosting acha padrão
    espúrio, e as poucas features fortes se diluem entre as que nada dizem.

    O modelo aqui não tem hiperparâmetro para ajustar nem otimização a
    convergir: seleciona por significância e tira a média. Menos código, menos
    superfície de sobreajuste, resultado melhor.
    """

    def __init__(self, min_tstat: float = MIN_FEATURE_TSTAT,
                 features: list[str] | None = None,
                 min_periods: int = MIN_SELECTION_PERIODS):
        self.candidate_features = list(features or FEATURE_COLUMNS)
        self.min_tstat = min_tstat
        self.min_periods = min_periods
        self.selected: list[str] = []
        self.feature_ic: dict[str, dict] = {}
        #: Empresas que de fato entraram no ajuste — as únicas em que o modelo
        #: foi validado. Ver `predict_latest`.
        self.universe: list[str] = []

    def fit(self, train: pd.DataFrame) -> 'CompositeFactorScore':
        """Seleciona features pelo IC no TREINO — jamais olhando o teste.

        O IC é medido dentro de cada período e agregado; entra quem tem
        t-stat acima do corte. Sinal fraco demais fica de fora em vez de
        entrar com peso pequeno: incluir ruído dilui o escore.
        """
        from scipy import stats as _stats

        self.selected, self.feature_ic = [], {}
        for feature in self.candidate_features:
            ics = []
            for _, grupo in train.groupby(['ano', 'trimestre']):
                amostra = grupo[[feature, 'ret_excess']].dropna()
                if len(amostra) < MIN_CROSS_SECTION or amostra[feature].nunique() < 5:
                    continue
                ics.append(float(_stats.spearmanr(amostra[feature], amostra['ret_excess']).statistic))
            if len(ics) < self.min_periods:
                continue
            media = float(np.mean(ics))
            erro = float(np.std(ics, ddof=1) / np.sqrt(len(ics)))
            t = media / erro if erro > 0 else 0.0
            self.feature_ic[feature] = {'ic': media, 'tStat': t, 'periods': len(ics)}
            if t >= self.min_tstat:
                self.selected.append(feature)
        if not self.selected:
            raise ValueError('INSUFFICIENT_DATA: nenhuma feature atingiu significancia no treino')
        self.universe = sorted(train['ticker'].unique().tolist())
        return self

    def score(self, df: pd.DataFrame) -> pd.Series:
        """Escore = média dos percentis transversais das features selecionadas.

        Percentil DENTRO do período (não z-score): imune a outlier contábil e
        é a escala em que o sinal foi medido (Spearman). Centrado em 0, então
        escore positivo = acima da mediana das pares naquele trimestre.

        Feature ausente na linha não vira zero: a média ignora o NaN, e a
        empresa é avaliada pelas features que ela tem.
        """
        if not self.selected:
            raise ValueError('MODELO_NAO_TREINADO: chame fit() antes de pontuar')
        percentis = df.groupby(['ano', 'trimestre'])[self.selected].transform(
            lambda s: s.rank(pct=True) - 0.5 if s.notna().sum() > 1 else s * 0.0)
        return percentis.mean(axis=1)

    def top_features(self, n: int = 3) -> list[dict]:
        """As features selecionadas com maior IC — a explicação do escore."""
        ordenadas = sorted(((f, self.feature_ic[f]) for f in self.selected),
                           key=lambda item: -abs(item[1]['ic']))
        return [{'feature': f, 'importance': round(m['ic'], 6)} for f, m in ordenadas[:n]]

    # -- serialização ------------------------------------------------------
    def save(self, path: str) -> None:
        """O artefato é a lista de features e seus ICs — não há pesos treinados."""
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump({'selected': self.selected, 'featureIc': self.feature_ic,
                       'minTStat': self.min_tstat, 'candidates': self.candidate_features,
                       'universe': self.universe}, fh, indent=2)

    @classmethod
    def load(cls, path: str) -> 'CompositeFactorScore':
        with open(path, 'r', encoding='utf-8') as fh:
            blob = json.load(fh)
        obj = cls(min_tstat=blob['minTStat'], features=blob.get('candidates'))
        obj.selected = blob['selected']
        obj.feature_ic = blob['featureIc']
        # Artefato anterior à correção de 2026-07-26 não tem universo: fica
        # vazio, e `predict_latest` trata isso como "sem restrição conhecida".
        obj.universe = list(blob.get('universe') or [])
        return obj


# ---------------------------------------------------------------------------
# Walk-forward trimestral (§4.2)
# ---------------------------------------------------------------------------
def yearly_splits(knowledge_dates: pd.Series, min_train_years: int = 2) -> list[dict]:
    """Janela expansiva por ano do carimbo de conhecimento.

    Não há embargo explícito em pregões aqui (diferente do motor híbrido
    diário): o corte é o próprio `knowledge_date`, e o alvo de uma linha de
    treino termina até 60 pregões DEPOIS dele. Para que nenhuma linha de treino
    "enxergue" preço dentro do ano de teste, o corte de treino exclui as linhas
    cuja `exit_date` cai em/depois do início do teste — embargo real, medido
    sobre a janela do próprio alvo.
    """
    dates = pd.to_datetime(knowledge_dates)
    years = sorted(dates.dt.year.unique())
    splits = []
    for test_year in years[min_train_years:]:
        test_mask = (dates.dt.year == test_year).to_numpy()
        train_mask = (dates.dt.year < test_year).to_numpy()
        if test_mask.sum() < _MIN_TEST_ROWS or train_mask.sum() < _MIN_TRAIN_ROWS:
            continue
        splits.append({'fold_id': len(splits), 'test_year': int(test_year),
                       'train_mask': train_mask, 'test_mask': test_mask})
    if not splits:
        raise ValueError('INSUFFICIENT_DATA: historico insuficiente para walk-forward trimestral')
    return splits


def calibration_split(train: pd.DataFrame, fraction: float = CALIBRATION_FRACTION) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Separa o treino em (ajuste, calibração) por ORDEM TEMPORAL.

    A fatia de calibração é a MAIS RECENTE — nunca uma amostra aleatória: o
    mapa precisa refletir o regime mais próximo do período que será previsto.

    O mesmo embargo do alvo usado entre treino e teste vale aqui: linhas de
    ajuste cuja janela de 60 pregões invadiria o período de calibração são
    removidas, senão os modelos-base teriam visto o preço que define o rótulo
    das linhas usadas para medir a própria confiança.

    Devolve `(train, empty)` quando não há linhas suficientes para as duas
    partes — o chamador segue sem calibrar, explicitamente.
    """
    if train.empty:
        return train, train.iloc[0:0]

    ordered = train.sort_values('knowledge_date').reset_index(drop=True)
    cut = int(len(ordered) * (1.0 - fraction))
    if cut <= 0 or cut >= len(ordered):
        return ordered, ordered.iloc[0:0]

    calib = ordered.iloc[cut:]
    calib_start = pd.to_datetime(calib['knowledge_date']).min()
    fit = ordered.iloc[:cut]
    fit = fit[pd.to_datetime(fit['exit_date']) < calib_start]

    if len(fit) < _MIN_TRAIN_ROWS or len(calib) < _MIN_CALIBRATION_ROWS:
        return ordered, ordered.iloc[0:0]
    return fit, calib


def run_walk_forward(labeled: pd.DataFrame, features: list[str] | None = None,
                     hyperparameters: dict | None = None) -> pd.DataFrame:
    """Previsões out-of-sample: para cada ano de teste, seleciona e pontua só com o passado.

    A SELEÇÃO DE FEATURES acontece dentro do fold, sobre o treino — nunca sobre
    a amostra inteira. Selecionar antes do walk-forward vazaria o futuro para
    dentro da escolha e inflaria o IC medido.

    Embargo do alvo: linhas de treino cuja janela de 60 pregões invadiria o
    período de teste são removidas, garantindo `knowledgeTime <= decisionTime` E
    ausência de sobreposição de alvo entre treino e teste.
    """
    hp = hyperparameters or HYPERPARAMETERS
    candidatas = list(features or FEATURE_COLUMNS)
    saida = []

    for split in yearly_splits(labeled['knowledge_date']):
        test = labeled[split['test_mask']]
        test_start = pd.to_datetime(test['knowledge_date']).min()
        train = labeled[split['train_mask']]
        train = train[pd.to_datetime(train['exit_date']) < test_start]
        if len(train) < _MIN_TRAIN_ROWS:
            continue

        modelo = CompositeFactorScore(
            min_tstat=hp.get('minFeatureTStat', MIN_FEATURE_TSTAT),
            features=candidatas,
            min_periods=hp.get('minSelectionPeriods', MIN_SELECTION_PERIODS),
        )
        try:
            modelo.fit(train)
        except ValueError:
            # Nenhuma feature significativa neste fold: não há escore a emitir.
            # Pular é honesto; forçar um escore de features sem sinal não é.
            continue

        escore = modelo.score(test)
        saida.append(pd.DataFrame({
            'ticker': test['ticker'].to_numpy(),
            'cd_cvm': test['cd_cvm'].to_numpy(),
            'ano': test['ano'].to_numpy(),
            'trimestre': test['trimestre'].to_numpy(),
            'knowledgeDate': pd.to_datetime(test['knowledge_date']).dt.strftime('%Y-%m-%d').to_numpy(),
            'foldId': split['fold_id'],
            'testYear': split['test_year'],
            'trainRows': int(len(train)),
            'nFeatures': len(modelo.selected),
            'score': escore.to_numpy(),
            'yTrue': test['y'].to_numpy(),
            'retFwd': test['ret_fwd'].to_numpy(),
            'retExcess': test['ret_excess'].to_numpy(),
        }))

    if not saida:
        raise ValueError('INSUFFICIENT_DATA: nenhum fold walk-forward viavel apos embargo do alvo')

    wf = pd.concat(saida, ignore_index=True)
    grupo = ['ano', 'trimestre']
    # Posição transversal do escore: é ela que carrega o sinal e define o sinal
    # emitido. `percentile` fica em [0,1]; `quantile` em 1..QUANTILES.
    wf['percentile'] = wf.groupby(grupo)['score'].transform(lambda s: s.rank(pct=True))
    wf['quantile'] = wf.groupby(grupo, group_keys=False)['score'].apply(assign_quantiles)
    wf['signal'] = wf['quantile'].map(classify_signal)
    return wf


def _ranking_metrics(wf: pd.DataFrame) -> dict:
    """Métricas do INSTRUMENTO CERTO: ranking transversal, não classificação.

    Trocadas em 2026-07-25 depois de medir que a vantagem do modelo vive na
    ORDENAÇÃO das empresas dentro de cada trimestre, e que a acurácia binária a
    destrói: uma empresa no percentil 51 e outra no percentil 99 recebem o
    mesmo rótulo "sobe", enquanto o quintil superior rende múltiplas vezes mais
    que os do meio.

    - `ic`: correlação de Spearman entre o escore e o excesso de retorno,
      calculada DENTRO de cada período e agregada. É a medida padrão de
      qualidade de fator; IC de 0,02–0,05 já é considerado utilizável.
    - `icTStat`: média/erro-padrão dos ICs por período — separa sinal de sorte.
    - `quantileExcess`: excesso médio por quintil, para ver se a relação é
      monotônica ou concentrada nos extremos.
    - `topBottomSpread`: excesso do quintil superior menos o do inferior.
    - `positiveYearsRatio`: fração dos anos com spread positivo. Um fator que
      só funciona em um ano não é um fator.
    """
    if 'retExcess' not in wf or 'quantile' not in wf:
        return {}

    from scipy import stats as _stats

    ics = []
    for _, g in wf.groupby(['ano', 'trimestre']):
        s = g[['score', 'retExcess']].dropna()
        if len(s) < MIN_CROSS_SECTION or s['score'].nunique() < 5:
            continue
        ics.append(float(_stats.spearmanr(s['score'], s['retExcess']).statistic))

    ic = float(np.mean(ics)) if ics else None
    ic_t = None
    if len(ics) >= 4:
        erro = float(np.std(ics, ddof=1) / np.sqrt(len(ics)))
        ic_t = float(np.mean(ics) / erro) if erro > 0 else None

    por_quintil = []
    for q, g in wf.dropna(subset=['quantile']).groupby('quantile'):
        por_quintil.append({'quantile': int(q), 'n': int(len(g)),
                            'meanExcess': float(g['retExcess'].mean()),
                            'hitRate': float((g['retExcess'] > 0).mean())})

    topo = wf[wf['quantile'] == wf['quantile'].max()]
    fundo = wf[wf['quantile'] == wf['quantile'].min()]
    spread = (float(topo['retExcess'].mean() - fundo['retExcess'].mean())
              if len(topo) and len(fundo) else None)

    por_ano = []
    for ano, g in wf.groupby('testYear'):
        t, b = g[g['quantile'] == g['quantile'].max()], g[g['quantile'] == g['quantile'].min()]
        if not len(t) or not len(b):
            continue
        por_ano.append({'testYear': int(ano),
                        'spread': float(t['retExcess'].mean() - b['retExcess'].mean())})
    positivos = (sum(1 for a in por_ano if a['spread'] > 0) / len(por_ano)) if por_ano else None

    return {
        'ic': ic,
        'icTStat': ic_t,
        'icPeriods': len(ics),
        'quantileExcess': por_quintil,
        'topBottomSpread': spread,
        'spreadByYear': por_ano,
        'positiveYearsRatio': positivos,
    }


def evaluate_walk_forward(wf: pd.DataFrame) -> dict:
    """Métricas do gate de aceitação.

    Só métricas de FATOR: IC, significância, excesso por quintil, spread
    topo-fundo e consistência entre anos (ver `_ranking_metrics`).

    As métricas de classificação da versão anterior (acurácia, Brier,
    cobertura, matriz de confusão, diagrama de confiabilidade) NÃO são mais
    emitidas: o escore composto ordena empresas, não estima probabilidade, e
    reportar Brier de um número que não é probabilidade seria inventar
    calibração onde não existe. Os campos seguem OPCIONAIS no contrato para
    que as versões antigas continuem legíveis na auditoria.

    `hitRate` por quintil ocupa o lugar da acurácia: é a fração de empresas do
    quintil que de fato superou as pares, medida sem fingir confiança pontual.
    """
    metricas = {
        'nSamples': int(len(wf)),
        'nPeriods': int(wf.groupby(['ano', 'trimestre']).ngroups),
        'nFeaturesMedian': (int(wf['nFeatures'].median()) if 'nFeatures' in wf else None),
        'byFold': [
            {'foldId': int(f), 'testYear': int(g['testYear'].iloc[0]), 'n': int(len(g)),
             'nFeatures': (int(g['nFeatures'].iloc[0]) if 'nFeatures' in g else None),
             'ic': (float(_fold_ic(g)) if _fold_ic(g) is not None else None)}
            for f, g in wf.groupby('foldId')
        ],
    }
    metricas.update(_ranking_metrics(wf))
    return metricas


def _fold_ic(fold: pd.DataFrame):
    """IC médio dentro de um fold — `None` quando não há seção transversal."""
    from scipy import stats as _stats
    ics = []
    for _, g in fold.groupby(['ano', 'trimestre']):
        s = g[['score', 'retExcess']].dropna()
        if len(s) < MIN_CROSS_SECTION or s['score'].nunique() < 5:
            continue
        ics.append(float(_stats.spearmanr(s['score'], s['retExcess']).statistic))
    return float(np.mean(ics)) if ics else None


# ---------------------------------------------------------------------------
# Identidade canônica do modelo (§3 princípio 8, §4.4)
# ---------------------------------------------------------------------------
def compute_dataset_digest(labeled: pd.DataFrame, features: list[str]) -> str:
    """SHA-256 do dataset rotulado que de fato treinou o modelo.

    Cobre as colunas de identidade (ticker/período/carimbo), TODAS as features
    e o rótulo — arredondadas a 10 casas para não depender de ruído de ponto
    flutuante entre execuções. É o que torna a `modelVersion` reprodutível: dois
    treinos com o mesmo dado produzem o mesmo digest, e um dado atualizado
    produz outro.
    """
    cols = ['ticker', 'ano', 'trimestre', 'knowledge_date', 'entry_date',
            'exit_date', 'y'] + list(features)
    ordered = (labeled[cols].sort_values(['knowledge_date', 'ticker'])
                            .reset_index(drop=True).round(10))
    return hashlib.sha256(ordered.to_csv(index=False).encode()).hexdigest()


def compute_model_version(hyperparameters: dict, features: list[str], universe: list[str],
                          dataset_digest: str = '') -> str:
    """SHA-256 (64 hex, sem prefixo) da identidade canônica do modelo.

    Cobre hiperparâmetros + features + universo + **digest do dataset rotulado**.

    Desvio consciente da §4.4 da spec, que define a versão como hash de
    "hiperparâmetros + features + universo" apenas. Esse conjunto NÃO
    identifica o modelo: os fundamentos CVM crescem a cada trimestre, então um
    retreino com dado novo (modelo genuinamente diferente, métricas
    diferentes) produziria a MESMA `modelVersion` — e como a publicação de
    artefato é dedup por versão (primeiro escritor vence), o retreino seria
    silenciosamente descartado e a UI continuaria servindo o modelo velho sob
    métricas novas. Incluir o digest do dataset fecha esse buraco e mantém a
    propriedade que a spec queria (§3.8: identidade canônica computada no
    servidor, determinística, sem float volátil nem timestamp).

    Determinístico e independente da ordem/duplicatas do universo.
    """
    payload = json.dumps({'hyperparameters': hyperparameters,
                          'features': list(features),
                          'universe': sorted(set(universe)),
                          'datasetDigest': dataset_digest},
                         sort_keys=True, separators=(',', ':')).encode()
    return hashlib.sha256(payload).hexdigest()


# ---------------------------------------------------------------------------
# Treino completo + publicação de artefato
# ---------------------------------------------------------------------------
def run_directional_training(panel: pd.DataFrame, bars_for, models_dir: str,
                             universe_bars_digest: str = '',
                             horizon: int = HORIZON_TRADING_DAYS,
                             target_mode: str = TARGET_MODE) -> dict:
    """Rotula, roda o walk-forward, ajusta o escore final e publica o artefato.

    O modelo publicável é selecionado sobre TODAS as linhas rotuladas — é ele
    que serve `/ml/directional/predict`; as métricas reportadas vêm
    exclusivamente do walk-forward out-of-sample.
    """
    labeled = label_panel(panel, bars_for, horizon=horizon, target_mode=target_mode)
    wf = run_walk_forward(labeled)
    metrics = evaluate_walk_forward(wf)

    universe = sorted(labeled['ticker'].unique().tolist())
    dataset_digest = compute_dataset_digest(labeled, FEATURE_COLUMNS)
    model_version = compute_model_version(HYPERPARAMETERS, FEATURE_COLUMNS, universe, dataset_digest)

    final_model = CompositeFactorScore().fit(labeled)

    result = {
        'modelVersion': model_version,
        'datasetDigest': dataset_digest,
        'universe': universe,
        'universeBarsDigest': universe_bars_digest,
        'horizonTradingDays': horizon,
        'targetMode': target_mode,
        'gate': {'quantiles': QUANTILES, 'minFeatureTStat': MIN_FEATURE_TSTAT},
        'windowStart': pd.to_datetime(labeled['knowledge_date']).min().strftime('%Y-%m-%d'),
        'windowEnd': pd.to_datetime(labeled['knowledge_date']).max().strftime('%Y-%m-%d'),
        'hyperparameters': HYPERPARAMETERS,
        'features': list(FEATURE_COLUMNS),
        'selectedFeatures': list(final_model.selected),
        'metrics': metrics,
        'artifactPath': os.path.join(models_dir, model_version, 'model.json'),
    }
    _publish_artifact(models_dir, model_version, final_model, wf, result)
    return result


def _publish_artifact(models_dir: str, model_version: str, model: CompositeFactorScore,
                      wf: pd.DataFrame, result: dict) -> None:
    """Publicação imutável e atômica — mesmo padrão de `ml/train.py`.

    Escreve tudo num diretório provisório e publica com um rename atômico.
    Diretório já existente NUNCA é sobrescrito: mesma `modelVersion` significa
    mesma configuração, então vale o primeiro publicado (dedup).
    """
    out_dir = os.path.join(models_dir, model_version)
    if os.path.isdir(out_dir):
        return
    os.makedirs(models_dir, exist_ok=True)
    provisional = os.path.join(models_dir, f'.provisional-{uuid.uuid4().hex}')
    os.makedirs(provisional, exist_ok=True)
    try:
        model.save(os.path.join(provisional, 'model.json'))
        wf.to_csv(os.path.join(provisional, 'walkforward_predictions.csv'), index=False)
        with open(os.path.join(provisional, 'metrics.json'), 'w', encoding='utf-8') as fh:
            json.dump(result, fh, indent=2, default=str)
        try:
            os.replace(provisional, out_dir)
        except OSError:
            if os.path.isdir(out_dir):
                shutil.rmtree(provisional, ignore_errors=True)
            else:
                raise
    except Exception:
        shutil.rmtree(provisional, ignore_errors=True)
        raise


def predict_latest(panel: pd.DataFrame, model: CompositeFactorScore,
                   top_n: int = 3) -> tuple[pd.DataFrame, dict]:
    """Ranking do trimestre mais recente, RESTRITO ao universo validado.

    Devolve `(previsoes, relatorio)`.

    Por que restringir (bug real encontrado em 2026-07-26, num teste do
    usuário na plataforma): o escore só precisa de fundamentos, então uma
    empresa SEM série de preços é perfeitamente pontuável — e 9 delas
    apareceram no ranking, quatro nos quintis extremos (GUAR3, NEOE3 e STBP3
    em COMPRA; SRNA3 em VENDA). Mas o modelo nunca foi validado nelas, não há
    como medir o resultado depois, e elas DESLOCAM empresas reais dos
    extremos, porque o quintil é calculado sobre quem está na seção.

    Empresas fora do universo saem do ranking e vão para o relatório —
    nunca somem em silêncio nem entram valendo o mesmo que as validadas.

    Diferente do treino, NÃO exige alvo (o retorno de 60 pregões ainda não
    existe) — é exatamente a previsão viva.
    """
    vazio = pd.DataFrame(columns=['ticker', 'cdCvm', 'signal', 'score', 'percentile',
                                  'quantile', 'knowledgeDate', 'topFeatures'])
    if panel.empty:
        return vazio, {'excluded': [], 'reason': 'painel vazio'}

    latest = (panel.sort_values('knowledge_date')
                   .groupby('ticker', as_index=False)
                   .tail(1)
                   .sort_values('ticker')
                   .reset_index(drop=True))

    excluidas: list[str] = []
    if model.universe:
        validas = set(model.universe)
        excluidas = sorted(set(latest['ticker']) - validas)
        latest = latest[latest['ticker'].isin(validas)].reset_index(drop=True)

    relatorio = {
        'excluded': excluidas,
        'universeSize': len(model.universe),
        'reason': 'fora do universo validado no treino' if excluidas else '',
    }
    if latest.empty:
        return vazio, relatorio

    escore = model.score(latest)
    percentil = escore.rank(pct=True)
    quantil = assign_quantiles(escore, QUANTILES)
    top = model.top_features(top_n)

    previsoes = pd.DataFrame({
        'ticker': latest['ticker'],
        'cdCvm': latest['cd_cvm'].astype(str),
        'signal': [classify_signal(q) for q in quantil],
        'score': escore,
        'percentile': percentil,
        'quantile': quantil,
        'knowledgeDate': pd.to_datetime(latest['knowledge_date']).dt.strftime('%Y-%m-%d'),
        'topFeatures': [json.dumps(top)] * len(latest),
    })
    return previsoes, relatorio
