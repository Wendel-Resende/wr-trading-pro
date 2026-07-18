"""Adapter TimesFM 2.5 200M: única fronteira com a lib externa.

O modelo real (google/timesfm-2.5-200m-pytorch) é carregado lazy na primeira
chamada sem forecaster injetado. Se a API da lib `timesfm` divergir na versão
instalada, SÓ este arquivo muda. Cache parquet por símbolo: (data do último
close, hash do contexto) → features; invalida sozinho se a série mudar.
"""
import hashlib, os
import pandas as pd

MIN_CONTEXT = 128

class _RealForecaster:
    def __init__(self):
        import timesfm  # noqa: PLC0415 — lazy: só quem prevê de verdade paga o load
        # A classe pública documentada `timesfm.TimesFm_2p5_200M_torch` não existe
        # na versão instalada (timesfm==2.0.2); o nome real é
        # `TimesFM_2p5_200M_torch` no submódulo timesfm_2p5_torch.
        from timesfm.timesfm_2p5.timesfm_2p5_torch import TimesFM_2p5_200M_torch
        self._model = TimesFM_2p5_200M_torch.from_pretrained(
            'google/timesfm-2.5-200m-pytorch')
        self._model.compile(timesfm.ForecastConfig(
            max_context=512, max_horizon=16, use_continuous_quantile_head=True))

    def forecast(self, context, horizon):
        point, quantiles = self._model.forecast(horizon=horizon, inputs=[context])
        return {'median': list(point[0]),
                'q10': list(quantiles[0][:, 1]), 'q90': list(quantiles[0][:, 9])}

class TimesFmFeatureProvider:
    def __init__(self, forecaster=None, cache_dir='data/ml/tfm_cache', max_context=512):
        self._forecaster = forecaster
        self._cache_dir = cache_dir
        self._max_context = max_context
        os.makedirs(cache_dir, exist_ok=True)

    def _get_forecaster(self):
        if self._forecaster is None:
            self._forecaster = _RealForecaster()
        return self._forecaster

    def _cache_path(self, symbol):
        return os.path.join(self._cache_dir, f'{symbol}.parquet')

    def features_for(self, symbol: str, closes: pd.Series) -> dict:
        if len(closes) < MIN_CONTEXT:
            raise ValueError(f'INSUFFICIENT_DATA: contexto {len(closes)} < {MIN_CONTEXT}')
        context = [float(x) for x in closes.iloc[-self._max_context:]]
        key = closes.index[-1].strftime('%Y-%m-%d') + ':' + \
            hashlib.sha256(str(context).encode()).hexdigest()[:16]
        path = self._cache_path(symbol)
        if os.path.exists(path):
            cached = pd.read_parquet(path)
            hit = cached[cached['key'] == key]
            if len(hit):
                return {'tfm_ret_10': float(hit['tfm_ret_10'].iloc[0]),
                        'tfm_iq': float(hit['tfm_iq'].iloc[0])}
        fc = self._get_forecaster().forecast(context, horizon=10)
        last = context[-1]
        feats = {'tfm_ret_10': fc['median'][-1] / last - 1,
                 'tfm_iq': (fc['q90'][-1] - fc['q10'][-1]) / last}
        row = pd.DataFrame([{'key': key, **feats}])
        if os.path.exists(path):
            row = pd.concat([pd.read_parquet(path), row], ignore_index=True)
        row.to_parquet(path, index=False)
        return feats
