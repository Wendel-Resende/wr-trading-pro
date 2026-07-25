"""WR Trade Pro — ML API (Flask, loopback-only, porta 5560).

Motor de ML da plataforma: backfill D1 (MT5), dataset point-in-time,
treino walk-forward e inferência. Governança/persistência ficam no Next
(/api/v1/ml/*). Nunca envia ordem; nunca inventa dado.
"""
import json
import os
import re
import sys
import lightgbm as lgb
import pandas as pd
from flask import Flask, jsonify, request

from ml.bars_snapshot import SnapshotNotFoundError, load_snapshot_bars, write_universe_snapshot
from ml.candles import Mt5DailyClient, backfill_symbols, load_daily_candles
from ml.dataset import ALL_FEATURES, build_dataset, build_inference_row
from ml.fundamentals import list_universe
from ml.job_runner import JobRegistry
from ml.timesfm_adapter import TimesFmFeatureProvider
from ml.train import run_training

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULTS = {
    'db_path': os.path.join(_ROOT, 'prisma', 'dev.db'),
    'cvm_db_path': os.path.join(_ROOT, 'data', 'cvm', 'cvm_fundamentos.db'),
    'models_dir': os.path.join(_ROOT, 'data', 'ml', 'models'),
    'bars_snapshot_dir': os.path.join(_ROOT, 'data', 'ml', 'bars_snapshot'),
    'tfm_cache_dir': os.path.join(_ROOT, 'data', 'ml', 'tfm_cache'),
    'jobs_dir': os.path.join(_ROOT, 'data', 'ml', 'training_jobs'),
    'tfm_provider': None,  # lazy TimesFmFeatureProvider real
    'mt5_client_factory': Mt5DailyClient,
    'job_registry_factory': JobRegistry,
}

_JOB_ID_RE = re.compile(r'^[0-9a-f]{32}$')

# Item A / D7: hash de artefato (64 hex, sem prefixo — D-hash) e símbolo B3
# validados ANTES de qualquer acesso a filesystem, para eliminar risco de
# path traversal via valor de path malformado.
_HASH64_RE = re.compile(r'^[0-9a-f]{64}$')
# Padrão canônico de ticker B3 — DEVE ser idêntico ao de src/lib/b3-ticker.ts
# (B3_TICKER_PATTERN): raiz 1 letra + 3 alfanuméricos + 1-2 dígitos. Aceita
# B3SA3, rejeita número puro; path-safe (sem / . .. separadores) — os símbolos
# aceitos aqui compõem diretamente o path do snapshot.
_TICKER_RE = re.compile(r'^[A-Z][A-Z0-9]{3}\d{1,2}$')
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

    # -----------------------------------------------------------------
    # Item C — treino assíncrono, cancelável de verdade. Cada job roda em
    # PROCESSO SEPARADO (ml/train_worker.py via `job_registry.start`), nunca
    # em thread do processo Flask: cancelar mata o processo do SO, não
    # depende de nenhum checkpoint cooperativo dentro de TimesFM/LightGBM.
    # Governança (ResearchRun/ModelVersion/gate) continua inteiramente no
    # Next — este endpoint só expõe start/status/cancel do trabalho Python.
    # -----------------------------------------------------------------
    os.makedirs(cfg['jobs_dir'], exist_ok=True)
    job_registry = cfg['job_registry_factory'](jobs_dir=cfg['jobs_dir'])
    # Reconcilia jobs de uma execucao anterior do processo Flask (restart):
    # sem isso, um job iniciado antes do restart seria "esquecido" e
    # reportado como UNKNOWN mesmo que o processo do SO ainda esteja vivo.
    job_registry.reconcile_from_disk()

    @app.post('/ml/train-jobs')
    def start_train_job():
        body = request.get_json(silent=True)
        try:
            symbols = symbols_from(body)
        except InvalidSymbolsError as exc:
            return jsonify({'error': 'INVALID_SYMBOLS', 'detail': str(exc)}), 400

        # Bloqueador 9/19 (revisão Guardião): o jobId é gerado e persistido
        # pelo Next ANTES deste POST (no MlTrainingRun), não aqui — elimina
        # a janela persistência→efeito em que uma resposta perdida deixaria
        # um processo Python órfão sem ID conhecido do lado Node. `start()`
        # do JobRegistry é idempotente para este jobId: um retry por timeout
        # nunca spawna um segundo processo.
        raw_job_id = (body or {}).get('jobId') if isinstance(body, dict) else None
        if not isinstance(raw_job_id, str) or not _JOB_ID_RE.match(raw_job_id):
            return jsonify({'error': 'INVALID_JOB_ID'}), 400
        job_id = raw_job_id

        os.makedirs(cfg['jobs_dir'], exist_ok=True)
        worker_cfg = {
            'dbPath': cfg['db_path'],
            'cvmDbPath': cfg['cvm_db_path'],
            'modelsDir': cfg['models_dir'],
            'barsSnapshotDir': cfg['bars_snapshot_dir'],
            'tfmCacheDir': cfg['tfm_cache_dir'],
        }
        args = [
            sys.executable, '-u', '-m', 'ml.train_worker',
            job_id, cfg['jobs_dir'], json.dumps(symbols), json.dumps(worker_cfg),
        ]
        job_registry.start(args, job_id=job_id, cwd=os.path.dirname(os.path.abspath(__file__)))
        return jsonify({'jobId': job_id}), 202

    @app.get('/ml/train-jobs/<job_id>')
    def get_train_job(job_id: str):
        if not _JOB_ID_RE.match(job_id):
            return jsonify({'error': 'INVALID_JOB_ID'}), 400

        job_state = job_registry.status(job_id)
        progress_path = os.path.join(cfg['jobs_dir'], f'{job_id}.progress.json')
        result_path = os.path.join(cfg['jobs_dir'], f'{job_id}.result.json')
        error_path = os.path.join(cfg['jobs_dir'], f'{job_id}.error.json')

        phase, progress = 'SNAPSHOT', 0
        if os.path.exists(progress_path):
            try:
                with open(progress_path, 'r', encoding='utf-8') as f:
                    snap = json.load(f)
                phase, progress = snap.get('phase', phase), int(snap.get('progress', progress))
            except Exception:  # noqa: BLE001 — arquivo de progresso corrompido nunca derruba o status
                pass

        # Nunca existiu neste registry (nem em disco): distinto de RUNNING,
        # para que o chamador nao trate um ID desconhecido como em progresso.
        if job_state == 'UNKNOWN':
            return jsonify({'state': 'UNKNOWN', 'phase': phase, 'progress': progress}), 404

        if job_state in ('RUNNING', 'ORPHAN_RUNNING'):
            return jsonify({'state': 'RUNNING', 'phase': phase, 'progress': progress,
                             'orphan': job_state == 'ORPHAN_RUNNING'})

        if job_registry.is_cancelled(job_id):
            return jsonify({'state': 'CANCELLED', 'phase': phase, 'progress': progress})

        if os.path.exists(result_path):
            try:
                with open(result_path, 'r', encoding='utf-8') as f:
                    result = json.load(f)
                return jsonify({'state': 'SUCCEEDED', 'phase': 'TRAINING', 'progress': 100, 'result': result})
            except Exception:  # noqa: BLE001 — resultado corrompido vira erro sanitizado, nunca stack trace
                return jsonify({'state': 'FAILED', 'phase': phase, 'progress': progress, 'errorCode': 'TRAINING_ERROR'})

        if os.path.exists(error_path):
            try:
                with open(error_path, 'r', encoding='utf-8') as f:
                    err = json.load(f)
                code = err.get('code', 'TRAINING_ERROR')
            except Exception:  # noqa: BLE001
                code = 'TRAINING_ERROR'
            return jsonify({'state': 'FAILED', 'phase': phase, 'progress': progress, 'errorCode': code})

        return jsonify({'state': 'FAILED', 'phase': phase, 'progress': progress, 'errorCode': 'TRAINING_ERROR'})

    @app.post('/ml/train-jobs/<job_id>/cancel')
    def cancel_train_job(job_id: str):
        if not _JOB_ID_RE.match(job_id):
            return jsonify({'error': 'INVALID_JOB_ID'}), 400
        # Bloqueador 17 (revisão Guardião): 'state' só é 'CANCELLED' quando a
        # árvore de processos foi CONFIRMADAMENTE encerrada. Sem confirmação,
        # reporta 'RUNNING' (o processo pode continuar vivo) — nunca mente
        # sobre o estado para o chamador Node.
        confirmed = job_registry.cancel(job_id)
        state = 'CANCELLED' if confirmed else 'RUNNING'
        return jsonify({'state': state, 'processConfirmedTerminated': confirmed}), 200

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
