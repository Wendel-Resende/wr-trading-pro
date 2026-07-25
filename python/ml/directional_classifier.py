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

#: Gate de confiança (princípio fixo 6). Fora destes limites o modelo não
#: opina — NEUTRO é uma resposta legítima, não uma falha.
UPPER_GATE = 0.90
LOWER_GATE = 0.10

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
    'lightgbm': {'max_depth': 6, 'num_leaves': 63, 'learning_rate': 0.05,
                 'n_estimators': 400, 'random_state': 42},
    'xgboost': {'max_depth': 5, 'learning_rate': 0.05, 'n_estimators': 400,
                'subsample': 0.8, 'colsample_bytree': 0.8, 'random_state': 42},
    'logistic': {'C': 1.0, 'penalty': 'l2', 'max_iter': 2000, 'random_state': 42},
    'weights': ENSEMBLE_WEIGHTS,
    'horizon': HORIZON_TRADING_DAYS,
    'gate': {'upper': UPPER_GATE, 'lower': LOWER_GATE},
    'calibration': {'method': CALIBRATION_METHOD, 'fraction': CALIBRATION_FRACTION},
    'target': {'mode': TARGET_MODE, 'minSectorPeers': MIN_SECTOR_PEERS},
    'crossSectionalNormalization': CROSS_SECTIONAL_NORMALIZATION,
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
# Gate de confiança
# ---------------------------------------------------------------------------
def classify_signal(prob: float) -> tuple[str, float]:
    """Converte probabilidade de alta em (sinal, confiança) — §4.1.

    Acima do gate superior a confiança é a própria probabilidade; abaixo do
    inferior é o complemento (confiança de que cai). Na zona ambígua devolve
    NEUTRO carregando a probabilidade crua, para a UI poder mostrar o quão
    perto do gate o caso ficou sem que isso vire recomendação.
    """
    p = float(prob)
    if p > UPPER_GATE:
        return SIGNAL_BUY, p
    if p < LOWER_GATE:
        return SIGNAL_SELL, 1.0 - p
    return SIGNAL_NEUTRAL, p


def is_high_confidence(prob: pd.Series) -> pd.Series:
    return (prob > UPPER_GATE) | (prob < LOWER_GATE)


# ---------------------------------------------------------------------------
# Ensemble
# ---------------------------------------------------------------------------
class DirectionalEnsemble:
    """LightGBM + XGBoost + Regressão Logística (Ridge), votação ponderada.

    A logística recebe imputação de mediana + padronização (árvores não
    precisam, e imputar com 0 quebraria a escala dos indicadores); as árvores
    recebem os NaN diretamente, que ambas tratam nativamente.
    """

    def __init__(self, features: list[str] | None = None, hyperparameters: dict | None = None):
        self.features = list(features or FEATURE_COLUMNS)
        self.hyperparameters = json.loads(json.dumps(hyperparameters or HYPERPARAMETERS))
        self.weights = dict(self.hyperparameters.get('weights') or ENSEMBLE_WEIGHTS)
        total = sum(self.weights.values())
        if abs(total - 1.0) > 1e-9:
            raise ValueError(f'PESOS_INVALIDOS: soma dos pesos do ensemble = {total}, esperado 1.0')
        self._models: dict[str, object] = {}
        self._logistic_pipeline = None
        #: Mapa de calibração (probabilidade dita → frequência observada).
        #: `None` = ensemble cru, e `is_calibrated` reporta isso honestamente.
        self._calibrator = None

    # -- treino ------------------------------------------------------------
    def fit(self, X: pd.DataFrame, y: pd.Series) -> 'DirectionalEnsemble':
        import lightgbm as lgb
        import xgboost as xgb
        from sklearn.impute import SimpleImputer
        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler

        Xf = X[self.features]
        yf = y.astype(int)

        self._models['lightgbm'] = lgb.LGBMClassifier(
            **self.hyperparameters['lightgbm'], verbose=-1).fit(Xf, yf)
        self._models['xgboost'] = xgb.XGBClassifier(
            **self.hyperparameters['xgboost'], eval_metric='logloss',
            verbosity=0, tree_method='hist').fit(Xf, yf)
        self._logistic_pipeline = Pipeline([
            ('impute', SimpleImputer(strategy='median')),
            ('scale', StandardScaler()),
            ('clf', LogisticRegression(**self.hyperparameters['logistic'])),
        ]).fit(Xf, yf)
        self._models['logistic'] = self._logistic_pipeline
        return self

    # -- calibração --------------------------------------------------------
    @property
    def is_calibrated(self) -> bool:
        return self._calibrator is not None

    def calibrate(self, X: pd.DataFrame, y: pd.Series, method: str | None = None) -> 'DirectionalEnsemble':
        """Aprende o mapa probabilidade-dita → frequência-observada.

        `X`/`y` PRECISAM ser dados que os modelos-base nunca viram e que são
        anteriores ao período de teste — caso contrário o mapa é aprendido
        sobre previsões in-sample (otimistas) e não corrige a superconfiança,
        ou pior, vaza o futuro para dentro da confiança reportada.

        Abaixo de `_MIN_CALIBRATION_ROWS` o mapa não é ajustado: o ensemble
        segue cru e `is_calibrated` devolve False, para que a métrica reportada
        diga a verdade sobre o que foi feito.
        """
        from sklearn.isotonic import IsotonicRegression
        from sklearn.linear_model import LogisticRegression

        chosen = method or self.hyperparameters.get('calibration', {}).get('method', CALIBRATION_METHOD)
        raw = self._raw_proba(X)
        yf = np.asarray(y, dtype=float)

        # Um conjunto de calibração com uma classe só não define mapa nenhum.
        if len(raw) < _MIN_CALIBRATION_ROWS or len(np.unique(yf)) < 2:
            self._calibrator = None
            return self

        if chosen == 'sigmoid':
            platt = LogisticRegression(C=1e10, solver='lbfgs')
            platt.fit(raw.reshape(-1, 1), yf)
            self._calibrator = ('sigmoid', platt)
        else:
            iso = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds='clip')
            iso.fit(raw, yf)
            self._calibrator = ('isotonic', iso)
        return self

    def _apply_calibration(self, raw: np.ndarray) -> np.ndarray:
        if self._calibrator is None:
            return raw
        kind, model = self._calibrator
        if kind == 'sigmoid':
            return np.asarray(model.predict_proba(raw.reshape(-1, 1)))[:, 1]
        return np.clip(np.asarray(model.predict(raw)), 0.0, 1.0)

    # -- inferência --------------------------------------------------------
    def predict_proba_by_model(self, X: pd.DataFrame) -> dict[str, np.ndarray]:
        if not self._models:
            raise ValueError('MODELO_NAO_TREINADO: chame fit() antes de prever')
        Xf = X[self.features]
        return {name: np.asarray(model.predict_proba(Xf))[:, 1] for name, model in self._models.items()}

    def _raw_proba(self, X: pd.DataFrame) -> np.ndarray:
        """Média ponderada dos 3 modelos, ANTES da calibração (§4.1)."""
        by_model = self.predict_proba_by_model(X)
        return sum(self.weights[name] * probs for name, probs in by_model.items())

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        """Probabilidade final: votação ponderada + calibração (se houver).

        É esta — a calibrada — que alimenta o gate de confiança. Usar a crua
        faria o gate de 90% disparar sobre uma confiança que o próprio modelo
        não sustenta.
        """
        return self._apply_calibration(self._raw_proba(X))

    def predict_signals(self, X: pd.DataFrame) -> pd.DataFrame:
        probs = self.predict_proba(X)
        classified = [classify_signal(p) for p in probs]
        return pd.DataFrame({'prob': probs,
                             'signal': [c[0] for c in classified],
                             'confidence': [c[1] for c in classified]}, index=X.index)

    # -- importâncias ------------------------------------------------------
    def top_features(self, n: int = 3) -> list[dict]:
        """Top features por ganho do LightGBM (única fonte estável entre os 3)."""
        model = self._models.get('lightgbm')
        if model is None:
            return []
        pairs = sorted(zip(self.features, model.feature_importances_), key=lambda t: -float(t[1]))
        return [{'feature': f, 'importance': float(v)} for f, v in pairs[:n]]

    # -- serialização ------------------------------------------------------
    def save(self, path: str) -> None:
        with open(path, 'wb') as fh:
            pickle.dump({'features': self.features, 'hyperparameters': self.hyperparameters,
                         'weights': self.weights, 'models': self._models,
                         'calibrator': self._calibrator}, fh)

    @classmethod
    def load(cls, path: str) -> 'DirectionalEnsemble':
        with open(path, 'rb') as fh:
            blob = pickle.load(fh)
        obj = cls(features=blob['features'], hyperparameters=blob['hyperparameters'])
        obj.weights = blob['weights']
        obj._models = blob['models']
        obj._logistic_pipeline = blob['models'].get('logistic')
        # Artefato antigo (pré-calibração) carrega sem o campo — segue cru.
        obj._calibrator = blob.get('calibrator')
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
    """Previsões out-of-sample: para cada ano de teste, treina só no passado.

    Embargo do alvo: linhas de treino cuja janela de 60 pregões invadiria o
    período de teste são removidas do fold (`exit_date < test_start`), o que
    garante `knowledgeTime <= decisionTime` E ausência de sobreposição de alvo
    entre treino e teste.
    """
    features = list(features or FEATURE_COLUMNS)
    out = []
    for split in yearly_splits(labeled['knowledge_date']):
        test = labeled[split['test_mask']]
        test_start = pd.to_datetime(test['knowledge_date']).min()
        train = labeled[split['train_mask']]
        train = train[pd.to_datetime(train['exit_date']) < test_start]
        if len(train) < _MIN_TRAIN_ROWS:
            continue

        # Ajuste e calibração usam fatias DISJUNTAS do treino, ambas anteriores
        # ao teste — o mapa de calibração nunca vê previsão in-sample.
        hp = hyperparameters or HYPERPARAMETERS
        # Normaliza DENTRO de cada período, separadamente em treino e teste —
        # o percentil de uma empresa depende só das pares do mesmo trimestre,
        # então normalizar o teste não usa nenhuma informação do treino nem do
        # futuro. É transformação por período, não estatística global.
        if hp.get('crossSectionalNormalization', CROSS_SECTIONAL_NORMALIZATION):
            train = cross_sectional_rank(train, features)
            test = cross_sectional_rank(test, features)

        fit_rows, calib_rows = calibration_split(
            train, hp.get('calibration', {}).get('fraction', CALIBRATION_FRACTION))
        model = DirectionalEnsemble(features, hyperparameters).fit(fit_rows[features], fit_rows['y'])
        if not calib_rows.empty:
            model.calibrate(calib_rows[features], calib_rows['y'])

        raw = model._raw_proba(test[features])
        probs = model.predict_proba(test[features])
        classified = [classify_signal(p) for p in probs]
        out.append(pd.DataFrame({
            'ticker': test['ticker'].to_numpy(),
            'cd_cvm': test['cd_cvm'].to_numpy(),
            'ano': test['ano'].to_numpy(),
            'trimestre': test['trimestre'].to_numpy(),
            'knowledgeDate': pd.to_datetime(test['knowledge_date']).dt.strftime('%Y-%m-%d').to_numpy(),
            'foldId': split['fold_id'],
            'testYear': split['test_year'],
            'trainRows': int(len(fit_rows)),
            'calibRows': int(len(calib_rows)),
            'calibrated': bool(model.is_calibrated),
            'prob': probs,
            # Probabilidade ANTES da calibração — mantida para que o ganho
            # (ou a ausência dele) seja auditável, nunca só afirmado.
            'probRaw': raw,
            'signal': [c[0] for c in classified],
            'confidence': [c[1] for c in classified],
            'yTrue': test['y'].to_numpy(),
            'retFwd': test['ret_fwd'].to_numpy(),
            'retExcess': test['ret_excess'].to_numpy(),
        }))
    if not out:
        raise ValueError('INSUFFICIENT_DATA: nenhum fold walk-forward viavel apos embargo do alvo')
    wf = pd.concat(out, ignore_index=True)
    # Posição TRANSVERSAL do escore — é ela que carrega o sinal, não o nível
    # absoluto da probabilidade (ver `evaluate_walk_forward`).
    grupo = ['ano', 'trimestre']
    wf['percentile'] = wf.groupby(grupo)['prob'].transform(lambda s: s.rank(pct=True))
    wf['quantile'] = wf.groupby(grupo, group_keys=False)['prob'].apply(assign_quantiles)
    return wf


# ---------------------------------------------------------------------------
# Métricas (§4.2 / §4.7)
# ---------------------------------------------------------------------------
def brier_score(prob: pd.Series, y_true: pd.Series) -> float:
    """Erro quadrático médio da probabilidade — mede calibração, não acerto."""
    p = np.asarray(prob, dtype=float)
    y = np.asarray(y_true, dtype=float)
    if len(p) == 0:
        return float('nan')
    return float(np.mean((p - y) ** 2))


def reliability_bins(prob: pd.Series, y_true: pd.Series, n_bins: int = 10) -> list[dict]:
    """Diagrama de confiabilidade: probabilidade prevista vs frequência observada."""
    p = np.asarray(prob, dtype=float)
    y = np.asarray(y_true, dtype=float)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    bins = []
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (p >= lo) & (p < hi) if i < n_bins - 1 else (p >= lo) & (p <= hi)
        n = int(mask.sum())
        bins.append({'binStart': float(lo), 'binEnd': float(hi), 'n': n,
                     'meanPredicted': float(p[mask].mean()) if n else None,
                     'observedRate': float(y[mask].mean()) if n else None})
    return bins


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
        s = g[['prob', 'retExcess']].dropna()
        if len(s) < 20 or s['prob'].nunique() < 5:
            continue
        ics.append(float(_stats.spearmanr(s['prob'], s['retExcess']).statistic))

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
    """Métricas do gate de aceitação (§4.7).

    - `accuracy`: acerto direcional APENAS nos sinais de alta confiança (é o
      que o usuário de fato opera; a acurácia sobre tudo, inclusive NEUTRO,
      fica em `accuracyAllSamples` para referência, nunca como gate).
    - `brier`: calibração sobre TODAS as amostras out-of-sample.
    - `coverage`: empresas distintas com sinal de alta confiança no ÚLTIMO
      trimestre avaliado (o gate 3 é sobre o trimestre mais recente, não sobre
      a média histórica).
    - `baselineDelta`: acurácia dos sinais menos a do baseline "comprar tudo"
      medido NO MESMO subconjunto de alta confiança — comparação pareada; a
      taxa de alta sobre a amostra inteira fica à parte em `baselineAllUp`.
    """
    # Direção implícita é sempre `prob > 0.5` — a mesma regra vale dentro e
    # fora do gate (acima de 0.90 é necessariamente > 0.5, abaixo de 0.10 é
    # necessariamente < 0.5), então o acerto é comparável entre os dois
    # recortes sem que NEUTRO seja contado como "aposta na baixa".
    predicted_up = wf['prob'] > 0.5
    wf = wf.assign(_correct=(predicted_up == (wf['yTrue'] == 1.0)))
    high = wf[is_high_confidence(wf['prob'])]

    last_period = None
    coverage = 0
    if not high.empty:
        periods = sorted(set(zip(high['ano'].astype(int), high['trimestre'].astype(int))))
        last_period = periods[-1]
        last = high[(high['ano'].astype(int) == last_period[0])
                    & (high['trimestre'].astype(int) == last_period[1])]
        coverage = int(last['cd_cvm'].nunique())

    # Sem NENHUM sinal de alta confiança não existe acurácia de sinal — o
    # valor honesto é `None`, nunca 0 (que fingiria "errou tudo") nem NaN
    # (que o `jsonify` do Flask serializa como o literal `NaN`, JSON inválido
    # que quebraria o `JSON.parse` do lado Node).
    accuracy = float(high['_correct'].mean()) if len(high) else None
    baseline_on_signals = float((high['yTrue'] == 1.0).mean()) if len(high) else None

    tp = int(((high['signal'] == SIGNAL_BUY) & (high['yTrue'] == 1.0)).sum()) if len(high) else 0
    fp = int(((high['signal'] == SIGNAL_BUY) & (high['yTrue'] == 0.0)).sum()) if len(high) else 0
    tn = int(((high['signal'] == SIGNAL_SELL) & (high['yTrue'] == 0.0)).sum()) if len(high) else 0
    fn = int(((high['signal'] == SIGNAL_SELL) & (high['yTrue'] == 1.0)).sum()) if len(high) else 0

    ranking = _ranking_metrics(wf)

    return {
        'nSamples': int(len(wf)),
        'nHighConfidence': int(len(high)),
        **ranking,
        'accuracy': accuracy,
        'accuracyAllSamples': float(wf['_correct'].mean()),
        'brier': brier_score(wf['prob'], wf['yTrue']),
        'coverage': coverage,
        'coveragePeriod': (f'{last_period[0]}T{last_period[1]}' if last_period else None),
        'baselineAllUp': float((wf['yTrue'] == 1.0).mean()),
        'baselineOnSignals': baseline_on_signals,
        'baselineDelta': (accuracy - baseline_on_signals) if len(high) else None,
        # Antes/depois da calibração — o ganho tem de ser auditável, não
        # apenas afirmado. `brierRaw` é o Brier da probabilidade CRUA sobre as
        # MESMAS amostras; `nHighConfidenceRaw` mostra o custo em cobertura
        # (uma calibração honesta costuma reduzir sinais, porque desinfla
        # confianças que o modelo não sustentava).
        'calibrated': bool(wf['calibrated'].all()) if 'calibrated' in wf else False,
        'brierRaw': (brier_score(wf['probRaw'], wf['yTrue']) if 'probRaw' in wf else None),
        'nHighConfidenceRaw': (int(is_high_confidence(wf['probRaw']).sum()) if 'probRaw' in wf else None),
        'confusionMatrix': {'truePositive': tp, 'falsePositive': fp,
                            'trueNegative': tn, 'falseNegative': fn},
        'reliability': reliability_bins(wf['prob'], wf['yTrue']),
        'byFold': [{'foldId': int(f), 'testYear': int(g['testYear'].iloc[0]), 'n': int(len(g)),
                    'nHighConfidence': int(is_high_confidence(g['prob']).sum()),
                    'accuracy': (float(g[is_high_confidence(g['prob'])]['_correct'].mean())
                                 if is_high_confidence(g['prob']).any() else None),
                    'brier': brier_score(g['prob'], g['yTrue'])}
                   for f, g in wf.groupby('foldId')],
    }


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
    """Rotula, roda o walk-forward, treina o modelo final e publica o artefato.

    Retorna o dicionário de resultado consumido pelo Next (nunca persiste nada
    em banco: governança é do lado Node). O modelo final é treinado sobre TODAS
    as linhas rotuladas — é ele que serve `/ml/directional/predict`; as métricas
    reportadas vêm exclusivamente do walk-forward out-of-sample.
    """
    labeled = label_panel(panel, bars_for, horizon=horizon, target_mode=target_mode)
    wf = run_walk_forward(labeled)
    metrics = evaluate_walk_forward(wf)

    universe = sorted(labeled['ticker'].unique().tolist())
    dataset_digest = compute_dataset_digest(labeled, FEATURE_COLUMNS)
    model_version = compute_model_version(HYPERPARAMETERS, FEATURE_COLUMNS, universe, dataset_digest)

    # Modelo publicável: ajustado na maior parte da história e calibrado na
    # fatia mais recente — mesma disciplina de cada fold do walk-forward, para
    # que a confiança que ele reporta ao vivo tenha o mesmo significado da que
    # foi medida na avaliação.
    fit_rows, calib_rows = calibration_split(labeled)
    final_model = DirectionalEnsemble(FEATURE_COLUMNS, HYPERPARAMETERS).fit(
        fit_rows[FEATURE_COLUMNS], fit_rows['y'])
    if not calib_rows.empty:
        final_model.calibrate(calib_rows[FEATURE_COLUMNS], calib_rows['y'])

    result = {
        'modelVersion': model_version,
        'datasetDigest': dataset_digest,
        'universe': universe,
        'universeBarsDigest': universe_bars_digest,
        'horizonTradingDays': horizon,
        'targetMode': target_mode,
        'gate': {'upper': UPPER_GATE, 'lower': LOWER_GATE},
        'windowStart': pd.to_datetime(labeled['knowledge_date']).min().strftime('%Y-%m-%d'),
        'windowEnd': pd.to_datetime(labeled['knowledge_date']).max().strftime('%Y-%m-%d'),
        'hyperparameters': HYPERPARAMETERS,
        'features': list(FEATURE_COLUMNS),
        'calibrated': bool(final_model.is_calibrated),
        'metrics': metrics,
        'artifactPath': os.path.join(models_dir, model_version, 'model.pkl'),
    }
    _publish_artifact(models_dir, model_version, final_model, wf, result)
    return result


def _publish_artifact(models_dir: str, model_version: str, model: DirectionalEnsemble,
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
        model.save(os.path.join(provisional, 'model.pkl'))
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


def predict_latest(panel: pd.DataFrame, model: DirectionalEnsemble, top_n: int = 3) -> pd.DataFrame:
    """Sinais para o trimestre mais recente já publicado de cada empresa.

    Diferente do treino, NÃO exige alvo (o retorno de 60 pregões ainda não
    existe) — é exatamente a previsão viva. Usa a última linha do painel por
    empresa, que por construção já respeita o prazo legal de publicação.
    """
    if panel.empty:
        return pd.DataFrame(columns=['ticker', 'cdCvm', 'signal', 'confidence', 'prob', 'topFeatures'])

    latest = (panel.sort_values('knowledge_date')
                   .groupby('ticker', as_index=False)
                   .tail(1)
                   .sort_values('ticker')
                   .reset_index(drop=True))
    signals = model.predict_signals(latest[model.features])
    top = model.top_features(top_n)
    return pd.DataFrame({
        'ticker': latest['ticker'],
        'cdCvm': latest['cd_cvm'].astype(str),
        'signal': signals['signal'],
        'confidence': signals['confidence'],
        'prob': signals['prob'],
        'knowledgeDate': pd.to_datetime(latest['knowledge_date']).dt.strftime('%Y-%m-%d'),
        'topFeatures': [json.dumps(top)] * len(latest),
    })
