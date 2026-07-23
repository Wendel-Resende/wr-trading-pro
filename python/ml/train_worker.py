"""WR Trade Pro — worker de treino ML executado em subprocesso próprio (Item C).

Roda como PROCESSO SEPARADO (nunca em thread), para que cancelamento seja
`Popen.kill()` real — encerra o interpretador Python inteiro do treino, sem
depender de nenhum checkpoint cooperativo dentro de TimesFM/LightGBM.

Uso: python -m ml.train_worker <jobId> <jobsDir> <symbolsJson> <cfgJson>

Escreve, em `jobsDir`:
  - `<jobId>.progress.json` — {"phase": str, "progress": int} (escrita atômica via os.replace)
  - `<jobId>.result.json`   — corpo completo do resultado (mesmo shape de /ml/train), só ao concluir com sucesso
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
        json.dump(payload, f)
    os.replace(tmp, path)


def main() -> int:
    if len(sys.argv) < 5:
        print('uso: train_worker.py <jobId> <jobsDir> <symbolsJson> <cfgJson>', file=sys.stderr)
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

        from ml.bars_snapshot import write_universe_snapshot
        from ml.dataset import build_dataset
        from ml.timesfm_adapter import TimesFmFeatureProvider
        from ml.train import run_training

        progress('SNAPSHOT', 10)
        snapshot = write_universe_snapshot(cfg['dbPath'], symbols, cfg['barsSnapshotDir'])

        progress('DATASET', 35)
        tfm = TimesFmFeatureProvider(cache_dir=cfg['tfmCacheDir'])
        ds, dataset_digest = build_dataset(snapshot['snapshotDir'], cfg['cvmDbPath'], symbols, tfm)

        progress('TRAINING', 60)
        result = run_training(
            ds,
            cfg['modelsDir'],
            dataset_digest=dataset_digest,
            universe_bars_digest=snapshot['universeBarsDigest'],
            per_symbol_manifest=snapshot['perSymbol'],
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
