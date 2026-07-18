"""WR Trade Pro — ML API (Flask, loopback-only, porta 5560).

Motor de ML da plataforma: backfill D1 (MT5), dataset point-in-time,
treino walk-forward e inferência. Governança/persistência ficam no Next
(/api/v1/ml/*). Nunca envia ordem; nunca inventa dado.
"""
import os
import lightgbm as lgb
import pandas as pd
from flask import Flask, jsonify, request

from ml.candles import Mt5DailyClient, backfill_symbols, load_daily_candles
from ml.dataset import ALL_FEATURES, build_dataset
from ml.fundamentals import list_universe
from ml.timesfm_adapter import TimesFmFeatureProvider
from ml.train import run_training

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULTS = {
    'db_path': os.path.join(_ROOT, 'prisma', 'dev.db'),
    'cvm_db_path': os.path.join(_ROOT, 'data', 'cvm', 'cvm_fundamentos.db'),
    'models_dir': os.path.join(_ROOT, 'data', 'ml', 'models'),
    'tfm_provider': None,  # lazy TimesFmFeatureProvider real
    'mt5_client_factory': Mt5DailyClient,
}

def create_app(deps=None):
    cfg = {**DEFAULTS, **(deps or {})}
    app = Flask(__name__)

    def tfm():
        if cfg['tfm_provider'] is None:
            cfg['tfm_provider'] = TimesFmFeatureProvider(
                cache_dir=os.path.join(_ROOT, 'data', 'ml', 'tfm_cache'))
        return cfg['tfm_provider']

    def symbols_from(body):
        syms = (body or {}).get('symbols')
        return syms if syms else list_universe(cfg['cvm_db_path'])

    @app.post('/ml/backfill')
    def backfill():
        try:
            client = cfg['mt5_client_factory']()
        except Exception:
            return jsonify({'error': 'MT5_DISCONNECTED'}), 503
        report = backfill_symbols(cfg['db_path'], symbols_from(request.get_json(silent=True)), client)
        return jsonify(report)

    @app.post('/ml/train')
    def train():
        try:
            ds, dhash = build_dataset(cfg['db_path'], cfg['cvm_db_path'],
                                      symbols_from(request.get_json(silent=True)), tfm())
            result = run_training(ds, cfg['models_dir'], dataset_hash=dhash)
        except ValueError as exc:
            if 'INSUFFICIENT_DATA' in str(exc):
                return jsonify({'error': 'INSUFFICIENT_DATA', 'detail': str(exc)}), 422
            raise
        return jsonify(result)

    @app.post('/ml/predict')
    def predict():
        body = request.get_json(silent=True) or {}
        symbol, artifact_hash = body.get('symbol'), body.get('artifactHash')
        path = os.path.join(cfg['models_dir'], artifact_hash or '', 'model.txt')
        if not artifact_hash or not os.path.exists(path):
            return jsonify({'error': 'MODEL_NOT_FOUND'}), 404
        try:
            ds, _ = build_dataset(cfg['db_path'], cfg['cvm_db_path'], [symbol], tfm(), sample_every=1)
        except ValueError as exc:
            return jsonify({'error': 'INSUFFICIENT_DATA', 'detail': str(exc)}), 422
        row = ds.iloc[[-1]]
        with open(path, 'r') as f:
            model_str = f.read()
        booster = lgb.Booster(model_str=model_str)
        score = float(booster.predict(row[ALL_FEATURES].fillna(0))[0])
        imp = sorted(zip(booster.feature_name(), booster.feature_importance('gain')),
                     key=lambda t: -t[1])[:5]
        candles = load_daily_candles(cfg['db_path'], symbol)
        return jsonify({
            'symbol': symbol, 'date': row['date'].iloc[0].strftime('%Y-%m-%d'),
            'direction': 'BUY' if score > 0.5 else 'SELL', 'score': score,
            'topFeatures': [{'name': n, 'importance': float(v)} for n, v in imp],
            'sourceMeta': {'candles': {'from': candles['time'].min().strftime('%Y-%m-%d'),
                                       'to': candles['time'].max().strftime('%Y-%m-%d'),
                                       'source': 'MT5'},
                           'model': artifact_hash, 'timesfm': 'google/timesfm-2.5-200m-pytorch'}})

    @app.get('/ml/health')
    def health():
        return jsonify({'status': 'ok', 'timesfmLoaded': cfg['tfm_provider'] is not None})

    return app

def main():
    port = int(os.environ.get('WR_ML_API_PORT', '5560'))
    create_app().run(host='127.0.0.1', port=port, debug=False, use_reloader=False)

if __name__ == '__main__':
    main()
