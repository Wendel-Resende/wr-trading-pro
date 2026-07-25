"""Worker do treino direcional executado em subprocesso próprio (Item D + Item C).

Sucessor de `ml/train_worker.py` (motor híbrido, removido): mantém EXATAMENTE
o mesmo protocolo de arquivos e o mesmo isolamento por processo, trocando só o
motor. Roda como PROCESSO SEPARADO (nunca thread), para que cancelamento seja
`Popen.kill()` real — encerra o interpretador inteiro do treino, sem depender
de checkpoint cooperativo dentro do LightGBM/XGBoost.

Uso: python -m ml.directional_worker <jobId> <jobsDir> <symbolsJson> <cfgJson>

Escreve, em `jobsDir`:
  - `<jobId>.progress.json` — {"phase": str, "progress": int} (escrita atômica)
  - `<jobId>.result.json`   — resultado completo (mesmo shape de
                               /ml/directional/train), só ao concluir com sucesso
  - `<jobId>.error.json`    — {"code": str} ao falhar (nunca stack trace bruto)

Nunca imprime stack trace/path/segredo em stdout/stderr que o processo pai
(`ml_api.py`) possa repassar ao Next — apenas os arquivos JSON acima.
"""
import json
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def _write_json_atomic(path: str, payload: dict) -> None:
    tmp = f'{path}.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(payload, f, default=str)
    os.replace(tmp, path)


def main() -> int:
    if len(sys.argv) < 5:
        print('uso: directional_worker.py <jobId> <jobsDir> <symbolsJson> <cfgJson>', file=sys.stderr)
        return 2

    job_id, jobs_dir, symbols_json, cfg_json = sys.argv[1:5]
    os.makedirs(jobs_dir, exist_ok=True)
    progress_path = os.path.join(jobs_dir, f'{job_id}.progress.json')
    result_path = os.path.join(jobs_dir, f'{job_id}.result.json')
    error_path = os.path.join(jobs_dir, f'{job_id}.error.json')

    def progress(phase: str, pct: int) -> None:
        _write_json_atomic(progress_path, {'phase': phase, 'progress': pct})

    try:
        symbols = json.loads(symbols_json)
        cfg = json.loads(cfg_json)

        from ml.bars_snapshot import SnapshotNotFoundError, load_snapshot_bars, write_universe_snapshot
        from ml.directional_classifier import run_directional_training
        from ml.directional_features import load_directional_panel

        # Fase mais cara em I/O: congela as barras D1 de todo o universo.
        progress('SNAPSHOT', 10)
        snapshot = write_universe_snapshot(cfg['dbPath'], symbols, cfg['barsSnapshotDir'])

        progress('DATASET', 35)
        panel = load_directional_panel(cfg['cvmDbPath'], symbols)

        def bars_for(ticker: str):
            try:
                return load_snapshot_bars(snapshot['snapshotDir'], ticker)
            except SnapshotNotFoundError:
                return None

        progress('TRAINING', 60)
        result = run_directional_training(
            panel,
            bars_for,
            cfg['directionalModelsDir'],
            universe_bars_digest=snapshot['universeBarsDigest'],
        )

        progress('TRAINING', 95)
        _write_json_atomic(result_path, result)
        return 0
    except ValueError as exc:
        code = 'INSUFFICIENT_DATA' if 'INSUFFICIENT_DATA' in str(exc) else 'TRAINING_ERROR'
        _write_json_atomic(error_path, {'code': code})
        return 1
    except Exception:  # noqa: BLE001 — nunca vazar stack trace ao processo pai/DB público
        _write_json_atomic(error_path, {'code': 'TRAINING_ERROR'})
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
