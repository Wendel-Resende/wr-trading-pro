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

HYPERPARAMETERS = {
    'lightgbm': {'max_depth': 6, 'num_leaves': 63, 'learning_rate': 0.05,
                 'n_estimators': 400, 'random_state': 42},
    'xgboost': {'max_depth': 5, 'learning_rate': 0.05, 'n_estimators': 400,
                'subsample': 0.8, 'colsample_bytree': 0.8, 'random_state': 42},
    'logistic': {'C': 1.0, 'penalty': 'l2', 'max_iter': 2000, 'random_state': 42},
    'weights': ENSEMBLE_WEIGHTS,
    'horizon': HORIZON_TRADING_DAYS,
    'gate': {'upper': UPPER_GATE, 'lower': LOWER_GATE},
}

_MIN_TRAIN_ROWS = 200
_MIN_TEST_ROWS = 20


# ---------------------------------------------------------------------------
# Rotulagem
# ---------------------------------------------------------------------------
def label_panel(panel: pd.DataFrame, bars_for, horizon: int = HORIZON_TRADING_DAYS) -> pd.DataFrame:
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

        valid = (entry_idx < len(times)) & (exit_idx < len(times))
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
    return labeled.sort_values(['knowledge_date', 'ticker']).reset_index(drop=True)


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

    # -- inferência --------------------------------------------------------
    def predict_proba_by_model(self, X: pd.DataFrame) -> dict[str, np.ndarray]:
        if not self._models:
            raise ValueError('MODELO_NAO_TREINADO: chame fit() antes de prever')
        Xf = X[self.features]
        return {name: np.asarray(model.predict_proba(Xf))[:, 1] for name, model in self._models.items()}

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        """Média ponderada das probabilidades dos 3 modelos (§4.1)."""
        by_model = self.predict_proba_by_model(X)
        return sum(self.weights[name] * probs for name, probs in by_model.items())

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
                         'weights': self.weights, 'models': self._models}, fh)

    @classmethod
    def load(cls, path: str) -> 'DirectionalEnsemble':
        with open(path, 'rb') as fh:
            blob = pickle.load(fh)
        obj = cls(features=blob['features'], hyperparameters=blob['hyperparameters'])
        obj.weights = blob['weights']
        obj._models = blob['models']
        obj._logistic_pipeline = blob['models'].get('logistic')
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

        model = DirectionalEnsemble(features, hyperparameters).fit(train[features], train['y'])
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
            'trainRows': int(len(train)),
            'prob': probs,
            'signal': [c[0] for c in classified],
            'confidence': [c[1] for c in classified],
            'yTrue': test['y'].to_numpy(),
            'retFwd': test['ret_fwd'].to_numpy(),
        }))
    if not out:
        raise ValueError('INSUFFICIENT_DATA: nenhum fold walk-forward viavel apos embargo do alvo')
    return pd.concat(out, ignore_index=True)


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

    accuracy = float(high['_correct'].mean()) if len(high) else float('nan')
    baseline_on_signals = float((high['yTrue'] == 1.0).mean()) if len(high) else float('nan')

    tp = int(((high['signal'] == SIGNAL_BUY) & (high['yTrue'] == 1.0)).sum()) if len(high) else 0
    fp = int(((high['signal'] == SIGNAL_BUY) & (high['yTrue'] == 0.0)).sum()) if len(high) else 0
    tn = int(((high['signal'] == SIGNAL_SELL) & (high['yTrue'] == 0.0)).sum()) if len(high) else 0
    fn = int(((high['signal'] == SIGNAL_SELL) & (high['yTrue'] == 1.0)).sum()) if len(high) else 0

    return {
        'nSamples': int(len(wf)),
        'nHighConfidence': int(len(high)),
        'accuracy': accuracy,
        'accuracyAllSamples': float(wf['_correct'].mean()),
        'brier': brier_score(wf['prob'], wf['yTrue']),
        'coverage': coverage,
        'coveragePeriod': (f'{last_period[0]}T{last_period[1]}' if last_period else None),
        'baselineAllUp': float((wf['yTrue'] == 1.0).mean()),
        'baselineOnSignals': baseline_on_signals,
        'baselineDelta': (accuracy - baseline_on_signals) if len(high) else float('nan'),
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
def compute_model_version(hyperparameters: dict, features: list[str], universe: list[str]) -> str:
    """SHA-256 (64 hex, sem prefixo) de hiperparâmetros + features + universo.

    Determinístico e independente de ordem de entrada do universo — dois
    treinos com a mesma configuração e o mesmo conjunto de empresas produzem a
    MESMA `modelVersion`, por definição. Nunca inclui float de preço nem
    timestamp (princípio fixo 3/8: identidade canônica não carrega verdade
    numérica volátil).
    """
    payload = json.dumps({'hyperparameters': hyperparameters,
                          'features': list(features),
                          'universe': sorted(set(universe))},
                         sort_keys=True, separators=(',', ':')).encode()
    return hashlib.sha256(payload).hexdigest()


# ---------------------------------------------------------------------------
# Treino completo + publicação de artefato
# ---------------------------------------------------------------------------
def run_directional_training(panel: pd.DataFrame, bars_for, models_dir: str,
                             universe_bars_digest: str = '',
                             horizon: int = HORIZON_TRADING_DAYS) -> dict:
    """Rotula, roda o walk-forward, treina o modelo final e publica o artefato.

    Retorna o dicionário de resultado consumido pelo Next (nunca persiste nada
    em banco: governança é do lado Node). O modelo final é treinado sobre TODAS
    as linhas rotuladas — é ele que serve `/ml/directional/predict`; as métricas
    reportadas vêm exclusivamente do walk-forward out-of-sample.
    """
    labeled = label_panel(panel, bars_for, horizon=horizon)
    wf = run_walk_forward(labeled)
    metrics = evaluate_walk_forward(wf)

    universe = sorted(labeled['ticker'].unique().tolist())
    model_version = compute_model_version(HYPERPARAMETERS, FEATURE_COLUMNS, universe)

    final_model = DirectionalEnsemble(FEATURE_COLUMNS, HYPERPARAMETERS).fit(
        labeled[FEATURE_COLUMNS], labeled['y'])

    result = {
        'modelVersion': model_version,
        'universe': universe,
        'universeBarsDigest': universe_bars_digest,
        'horizonTradingDays': horizon,
        'gate': {'upper': UPPER_GATE, 'lower': LOWER_GATE},
        'windowStart': pd.to_datetime(labeled['knowledge_date']).min().strftime('%Y-%m-%d'),
        'windowEnd': pd.to_datetime(labeled['knowledge_date']).max().strftime('%Y-%m-%d'),
        'hyperparameters': HYPERPARAMETERS,
        'features': list(FEATURE_COLUMNS),
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
