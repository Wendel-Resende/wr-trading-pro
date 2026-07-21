"""WR Trade Pro — ML API (Flask, loopback-only, porta 5560).

Motor de ML da plataforma: backfill D1 (MT5), dataset point-in-time,
treino walk-forward e inferência. Governança/persistência ficam no Next
(/api/v1/ml/*). Nunca envia ordem; nunca inventa dado.
"""
import os
import re
import lightgbm as lgb
import pandas as pd
from flask import Flask, jsonify, request

from ml.bars_snapshot import SnapshotNotFoundError, load_snapshot_bars, write_universe_snapshot
from ml.candles import Mt5DailyClient, backfill_symbols, load_daily_candles
from ml.dataset import ALL_FEATURES, build_dataset, build_inference_row
from ml.fundamentals import list_universe
from ml.timesfm_adapter import TimesFmFeatureProvider
from ml.train import run_training

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULTS = {
    'db_path': os.path.join(_ROOT, 'prisma', 'dev.db'),
    'cvm_db_path': os.path.join(_ROOT, 'data', 'cvm', 'cvm_fundamentos.db'),
    'models_dir': os.path.join(_ROOT, 'data', 'ml', 'models'),
    'bars_snapshot_dir': os.path.join(_ROOT, 'data', 'ml', 'bars_snapshot'),
    'tfm_provider': None,  # lazy TimesFmFeatureProvider real
    'mt5_client_factory': Mt5DailyClient,
}

# Item A / D7: hash de artefato (64 hex, sem prefixo — D-hash) e símbolo B3
# validados ANTES de qualquer acesso a filesystem, para eliminar risco de
# path traversal via valor de path malformado.
_HASH64_RE = re.compile(r'^[0-9a-f]{64}$')
_TICKER_RE = re.compile(r'^[A-Z]{4}\d{1,2}$')
_MAX_LIMIT = 2000
_DEFAULT_LIMIT = 500

class InvalidSymbolsError(ValueError):
    """G-003 item 1: tickers inválidos/malformados nunca compõem um path de
    snapshot — rejeitados explicitamente antes de qualquer I/O."""

def create_app(deps=None):
    cfg = {**DEFAULTS, **(deps or {})}
    app = Flask(__name__)

    def tfm():
        if cfg['tfm_provider'] is None:
            cfg['tfm_provider'] = TimesFmFeatureProvider(
                cache_dir=os.path.join(_ROOT, 'data', 'ml', 'tfm_cache'))
        return cfg['tfm_provider']

    def symbols_from(body):
        """G-003 item 1: valida CADA ticker contra `_TICKER_RE` e deduplica
        (preservando a primeira ocorrência) — os símbolos aceitos aqui
        compõem diretamente o path do snapshot (`bars_snapshot/<digest>/
        <symbol>.parquet`), então um ticker malformado nunca pode chegar
        até lá. Levanta `InvalidSymbolsError` com a lista de tickers
        rejeitados; nunca silencia nem tenta "corrigir" o valor."""
        syms = (body or {}).get('symbols')
        if not syms:
            return list_universe(cfg['cvm_db_path'])
        seen: list[str] = []
        invalid: list[str] = []
        for raw in syms:
            upper = str(raw).strip().upper()
            if not _TICKER_RE.match(upper):
                invalid.append(str(raw))
                continue
            if upper not in seen:
                seen.append(upper)
        if invalid:
            raise InvalidSymbolsError(f'tickers invalidos: {invalid}')
        return seen

    @app.post('/ml/backfill')
    def backfill():
        try:
            symbols = symbols_from(request.get_json(silent=True))
        except InvalidSymbolsError as exc:
            return jsonify({'error': 'INVALID_SYMBOLS', 'detail': str(exc)}), 400
        try:
            client = cfg['mt5_client_factory']()
        except Exception:
            return jsonify({'error': 'MT5_DISCONNECTED'}), 503
        report = backfill_symbols(cfg['db_path'], symbols, client)
        return jsonify(report)

    @app.post('/ml/train')
    def train():
        try:
            symbols = symbols_from(request.get_json(silent=True))
        except InvalidSymbolsError as exc:
            return jsonify({'error': 'INVALID_SYMBOLS', 'detail': str(exc)}), 400
        try:
            # Item A / D1: snapshot imutável ANTES de qualquer leitura de
            # feature — build_dataset só enxerga o snapshot, nunca a tabela
            # HistoricalCandle live (que pode mudar sob um backfill concorrente).
            snapshot = write_universe_snapshot(cfg['db_path'], symbols, cfg['bars_snapshot_dir'])
            ds, dataset_digest = build_dataset(snapshot['snapshotDir'], cfg['cvm_db_path'], symbols, tfm())
            result = run_training(ds, cfg['models_dir'], dataset_digest=dataset_digest,
                                   universe_bars_digest=snapshot['universeBarsDigest'],
                                   per_symbol_manifest=snapshot['perSymbol'])
        except ValueError as exc:
            if 'INSUFFICIENT_DATA' in str(exc):
                return jsonify({'error': 'INSUFFICIENT_DATA', 'detail': str(exc)}), 422
            raise
        return jsonify(result)

    @app.post('/ml/predict')
    def predict():
        body = request.get_json(silent=True) or {}
        symbol, artifact_hash = body.get('symbol'), body.get('artifactHash')

        # G-003 item 1: hash e ticker validados ANTES de qualquer acesso a
        # filesystem/DB — nenhum valor malformado chega perto de
        # os.path.join/consulta SQL.
        if not isinstance(artifact_hash, str) or not _HASH64_RE.match(artifact_hash):
            return jsonify({'error': 'INVALID_HASH'}), 400
        if not isinstance(symbol, str) or not _TICKER_RE.match(symbol):
            return jsonify({'error': 'INVALID_SYMBOL'}), 400

        path = os.path.join(cfg['models_dir'], artifact_hash, 'model.txt')
        if not os.path.exists(path):
            return jsonify({'error': 'MODEL_NOT_FOUND'}), 404
        try:
            row = build_inference_row(cfg['db_path'], cfg['cvm_db_path'], symbol, tfm())
        except ValueError as exc:
            if 'INSUFFICIENT_DATA' in str(exc):
                return jsonify({'error': 'INSUFFICIENT_DATA'}), 422
            raise
        try:
            with open(path, 'r') as f:
                model_str = f.read()
            booster = lgb.Booster(model_str=model_str)
            score = float(booster.predict(row[ALL_FEATURES].fillna(0))[0])
        except Exception:  # noqa: BLE001 — G-003 item 1: nunca vazar detalhe interno de artefato ao cliente
            app.logger.exception('artefato ilegivel em /ml/predict: %s', artifact_hash)
            return jsonify({'error': 'ARTIFACT_UNREADABLE'}), 422
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

    @app.get('/ml/predictions/<artifact_hash>')
    def predictions(artifact_hash: str):
        """Item A / D7: previsões out-of-sample do walk-forward, paginadas.

        Consumido pelo Next (MlApiPort.getWalkforwardPredictions) para
        montar os sinais do backtest econômico real — nunca lido pelo
        Next diretamente do CSV em disco (fronteira única com o processo
        Python, mesmo princípio do adapter TimesFM).
        """
        if not _HASH64_RE.match(artifact_hash):
            return jsonify({'error': 'INVALID_HASH'}), 400

        symbol = request.args.get('symbol', '')
        if not _TICKER_RE.match(symbol):
            return jsonify({'error': 'INVALID_SYMBOL'}), 400

        try:
            limit = int(request.args.get('limit', _DEFAULT_LIMIT))
            offset = int(request.args.get('offset', 0))
        except ValueError:
            return jsonify({'error': 'INVALID_QUERY'}), 400
        if not (1 <= limit <= _MAX_LIMIT) or offset < 0:
            return jsonify({'error': 'INVALID_QUERY'}), 400

        csv_path = os.path.join(cfg['models_dir'], artifact_hash, 'walkforward_predictions.csv')
        if not os.path.exists(csv_path):
            return jsonify({'error': 'MODEL_NOT_FOUND'}), 404

        _REQUIRED_COLS = {'symbol', 'date', 'foldId', 'trainEnd', 'testStart', 'embargoCalDays'}
        try:
            wf = pd.read_csv(csv_path)
            if not _REQUIRED_COLS.issubset(wf.columns):
                raise ValueError(f'colunas ausentes: {_REQUIRED_COLS - set(wf.columns)}')
        except Exception:  # noqa: BLE001 — CSV corrompido/incompleto nunca derruba o processo
            # G-003 item 1: detalhe de exceção fica só no log do servidor, nunca no corpo da resposta.
            app.logger.exception('artefato ilegivel em /ml/predictions: %s', artifact_hash)
            return jsonify({'error': 'ARTIFACT_UNREADABLE'}), 422

        rows = wf[wf['symbol'] == symbol]
        if rows.empty:
            return jsonify({'error': 'SYMBOL_NOT_IN_ARTIFACT'}), 404

        # G-007 item 2: ordem física do CSV não é confiável para paginação
        # estável — impõe ordem determinística explícita (data, com
        # desempate por foldId) antes de fatiar por offset/limit.
        rows = rows.sort_values(['date', 'foldId'], kind='stable').reset_index(drop=True)

        total = int(len(rows))
        page = rows.iloc[offset:offset + limit]
        return jsonify({'rows': page.to_dict(orient='records'), 'total': total,
                         'limit': limit, 'offset': offset})

    @app.get('/ml/snapshot-bars/<universe_bars_digest>')
    def snapshot_bars(universe_bars_digest: str):
        """Item A / D1, D7: barras OHLCV cruas do snapshot congelado, paginadas.

        Mesma fronteira única de D7 (`/ml/predictions`) — o Next nunca lê o
        parquet do snapshot diretamente do disco, só via este endpoint,
        validado e paginado do mesmo jeito.
        """
        if not _HASH64_RE.match(universe_bars_digest):
            return jsonify({'error': 'INVALID_HASH'}), 400

        symbol = request.args.get('symbol', '')
        if not _TICKER_RE.match(symbol):
            return jsonify({'error': 'INVALID_SYMBOL'}), 400

        try:
            limit = int(request.args.get('limit', _DEFAULT_LIMIT))
            offset = int(request.args.get('offset', 0))
        except ValueError:
            return jsonify({'error': 'INVALID_QUERY'}), 400
        if not (1 <= limit <= _MAX_LIMIT) or offset < 0:
            return jsonify({'error': 'INVALID_QUERY'}), 400

        snapshot_dir = os.path.join(cfg['bars_snapshot_dir'], universe_bars_digest)
        if not os.path.isdir(snapshot_dir):
            return jsonify({'error': 'ARTIFACT_NOT_FOUND'}), 404

        try:
            bars = load_snapshot_bars(snapshot_dir, symbol)
        except SnapshotNotFoundError:
            return jsonify({'error': 'SYMBOL_NOT_IN_ARTIFACT'}), 404
        except Exception:  # noqa: BLE001 — G-003 item 1: nunca vazar detalhe interno de artefato ao cliente
            app.logger.exception('artefato ilegivel em /ml/snapshot-bars: %s', universe_bars_digest)
            return jsonify({'error': 'ARTIFACT_UNREADABLE'}), 422

        # G-007 item 2: ordem física do parquet não é confiável para
        # paginação estável — impõe ordem determinística por tempo antes de
        # fatiar por offset/limit.
        bars = bars.sort_values('time', kind='stable').reset_index(drop=True)

        total = int(len(bars))
        page = bars.iloc[offset:offset + limit].copy()
        page['time'] = page['time'].dt.strftime('%Y-%m-%dT%H:%M:%S.000Z')
        return jsonify({'rows': page.to_dict(orient='records'), 'total': total,
                         'limit': limit, 'offset': offset})

    @app.get('/ml/health')
    def health():
        return jsonify({'status': 'ok', 'timesfmLoaded': cfg['tfm_provider'] is not None})

    return app

def main():
    port = int(os.environ.get('WR_ML_API_PORT', '5560'))
    create_app().run(host='127.0.0.1', port=port, debug=False, use_reloader=False)

if __name__ == '__main__':
    main()
