"""WR Trade Pro — ML API (Flask, loopback-only, porta 5560).

Motor de ML da plataforma (Item D): backfill D1 (MT5), painel
fundamentalista point-in-time, treino do classificador direcional
(walk-forward) e inferência. Governança/persistência ficam no Next
(/api/v1/ml/*). Nunca envia ordem; nunca inventa dado.
"""
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

from flask import Flask, jsonify, request

from ml.bars_snapshot import SnapshotNotFoundError, load_snapshot_bars, write_universe_snapshot
from ml.candles import Mt5DailyClient, backfill_symbols
from ml.directional_classifier import (
    CompositeFactorScore, predict_latest, run_directional_training)
from ml.directional_features import load_directional_panel
from ml.fundamentals import list_universe
from ml.job_runner import JobRegistry
from ml.yahoo_history import ingest_symbols

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULTS = {
    'db_path': os.path.join(_ROOT, 'prisma', 'dev.db'),
    'cvm_db_path': os.path.join(_ROOT, 'data', 'cvm', 'cvm_fundamentos.db'),
    'directional_models_dir': os.path.join(_ROOT, 'data', 'ml', 'directional_models'),
    'bars_snapshot_dir': os.path.join(_ROOT, 'data', 'ml', 'bars_snapshot'),
    'jobs_dir': os.path.join(_ROOT, 'data', 'ml', 'training_jobs'),
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
# Âncora final `\Z` (não `$`): o `$` do Python, sem re.MULTILINE, casa ANTES
# de um `\n` final ("PETR4\n" seria aceito por engano), enquanto o `$` do
# JS não tem essa exceção. `\Z` casa apenas no fim absoluto da string,
# replicando a semântica de isB3Ticker() em src/lib/b3-ticker.ts — o corpo
# do padrão continua idêntico a B3_TICKER_PATTERN.
_TICKER_RE = re.compile(r'^[A-Z][A-Z0-9]{3}\d{1,2}\Z')
_MAX_LIMIT = 2000
_DEFAULT_LIMIT = 500

class InvalidSymbolsError(ValueError):
    """G-003 item 1: tickers inválidos/malformados nunca compõem um path de
    snapshot — rejeitados explicitamente antes de qualquer I/O."""

def create_app(deps=None):
    cfg = {**DEFAULTS, **(deps or {})}
    app = Flask(__name__)

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

    @app.post('/ml/yahoo-backfill')
    def yahoo_backfill():
        """Ingere histórico D1 estendido do Yahoo (15-26 anos vs ~5 do MT5).

        Sob demanda e explícito: a API do Yahoo é não-oficial e não pode estar
        no caminho crítico de nenhuma tela. Relatório POR SÍMBOLO — os 9
        tickers sem cobertura lá aparecem em `failed`, nunca somem em silêncio.
        """
        try:
            symbols = symbols_from(request.get_json(silent=True))
        except InvalidSymbolsError as exc:
            return jsonify({'error': 'INVALID_SYMBOLS', 'detail': str(exc)}), 400
        relatorio = ingest_symbols(cfg['db_path'], symbols)
        return jsonify({
            'ok': relatorio['ok'],
            'failed': {k: 'sem cobertura no Yahoo' for k in relatorio['failed']},
            'okCount': len(relatorio['ok']),
            'failedCount': len(relatorio['failed']),
        })

    # -----------------------------------------------------------------
    # Item C — treino assíncrono, cancelável de verdade. Cada job roda em
    # PROCESSO SEPARADO (ml/directional_worker.py via `job_registry.start`),
    # nunca em thread do processo Flask: cancelar mata o processo do SO, não
    # depende de nenhum checkpoint cooperativo dentro do LightGBM/XGBoost.
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
            'directionalModelsDir': cfg['directional_models_dir'],
            'barsSnapshotDir': cfg['bars_snapshot_dir'],
        }
        args = [
            sys.executable, '-u', '-m', 'ml.directional_worker',
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

    # -----------------------------------------------------------------
    # Item D — classificador direcional (ensemble governado, 60 pregões).
    #
    # Fronteira: este serviço TREINA e PREVÊ; nunca persiste governança. O
    # `researchRunId` da §4.3 da spec é criado pelo Next (que é dono do
    # `ResearchRun`), não aqui — devolver um ID de banco a partir do Python
    # exigiria que ele escrevesse no Prisma, quebrando a separação que vale
    # para todo o resto do motor ML.
    # -----------------------------------------------------------------
    def _directional_bars_loader(snapshot_dir):
        def bars_for(ticker: str):
            try:
                return load_snapshot_bars(snapshot_dir, ticker)
            except SnapshotNotFoundError:
                return None
        return bars_for

    @app.post('/ml/directional/train')
    def directional_train():
        body = request.get_json(silent=True) or {}
        try:
            symbols = symbols_from(body)
        except InvalidSymbolsError as exc:
            return jsonify({'error': 'INVALID_SYMBOLS', 'detail': str(exc)}), 400

        try:
            # Mesma disciplina do Item A/D1: snapshot imutável das barras ANTES
            # de qualquer leitura de preço — o rótulo de 60 pregões nunca pode
            # mudar sob um backfill concorrente.
            snapshot = write_universe_snapshot(cfg['db_path'], symbols, cfg['bars_snapshot_dir'])
            panel = load_directional_panel(cfg['cvm_db_path'], symbols)
            result = run_directional_training(
                panel, _directional_bars_loader(snapshot['snapshotDir']),
                cfg['directional_models_dir'],
                universe_bars_digest=snapshot['universeBarsDigest'])
        except ValueError as exc:
            if 'INSUFFICIENT_DATA' in str(exc):
                return jsonify({'error': 'INSUFFICIENT_DATA', 'detail': str(exc)}), 422
            raise
        return jsonify(result)

    @app.post('/ml/directional/predict')
    def directional_predict():
        body = request.get_json(silent=True) or {}
        model_version = body.get('modelVersion')

        # G-003 item 1: versão validada ANTES de compor qualquer path — o valor
        # entra direto em `os.path.join`, então malformado nunca chega ao disco.
        if not isinstance(model_version, str) or not _HASH64_RE.match(model_version):
            return jsonify({'error': 'INVALID_MODEL_VERSION'}), 400

        artifact_path = os.path.join(cfg['directional_models_dir'], model_version, 'model.json')
        if not os.path.exists(artifact_path):
            return jsonify({'error': 'MODEL_NOT_FOUND'}), 404

        try:
            symbols = symbols_from(body)
        except InvalidSymbolsError as exc:
            return jsonify({'error': 'INVALID_SYMBOLS', 'detail': str(exc)}), 400

        try:
            model = CompositeFactorScore.load(artifact_path)
        except Exception:  # noqa: BLE001 — nunca vazar detalhe interno de artefato ao cliente
            app.logger.exception('artefato ilegivel em /ml/directional/predict: %s', model_version)
            return jsonify({'error': 'ARTIFACT_UNREADABLE'}), 422

        # Previsão viva NÃO usa snapshot congelado: o painel é lido do banco CVM
        # no estado atual, e cada linha já carrega o prazo legal de publicação —
        # ponto-no-tempo continua garantido sem congelar nada.
        panel = load_directional_panel(cfg['cvm_db_path'], symbols)
        if panel.empty:
            return jsonify({'error': 'INSUFFICIENT_DATA', 'detail': 'painel fundamentalista vazio'}), 422

        preds, cobertura = predict_latest(panel, model)
        if preds.empty:
            return jsonify({'error': 'INSUFFICIENT_DATA',
                            'detail': 'nenhuma empresa do universo validado tem painel'}), 422
        universe_digest = hashlib.sha256(
            json.dumps(sorted(preds['ticker'].tolist()), separators=(',', ':')).encode()).hexdigest()

        return jsonify({
            'modelVersion': model_version,
            'universeDigest': universe_digest,
            'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z'),
            # Empresas com fundamentos mas FORA do universo em que o modelo foi
            # validado. Reportadas, nunca ranqueadas junto — ver `predict_latest`.
            'excludedFromUniverse': cobertura['excluded'],
            'predictions': [
                {'ticker': r['ticker'], 'cdCvm': r['cdCvm'], 'signal': r['signal'],
                 # `confidence` é a distância da mediana da seção transversal
                 # (|2·p−1|), NÃO probabilidade: o escore ordena, não estima
                 # chance. `prob` carrega o percentil por compatibilidade de
                 # contrato — ver comentário do schema Prisma.
                 'confidence': float(abs(2 * r['percentile'] - 1)),
                 'prob': float(r['percentile']),
                 'score': float(r['score']),
                 'quantile': (int(r['quantile']) if r['quantile'] == r['quantile'] else None),
                 'knowledgeDate': r['knowledgeDate'],
                 'topFeatures': json.loads(r['topFeatures'])}
                for _, r in preds.iterrows()
            ],
        })

    @app.get('/ml/health')
    def health():
        return jsonify({'status': 'ok'})

    return app

def main():
    port = int(os.environ.get('WR_ML_API_PORT', '5560'))
    create_app().run(host='127.0.0.1', port=port, debug=False, use_reloader=False)

if __name__ == '__main__':
    main()
