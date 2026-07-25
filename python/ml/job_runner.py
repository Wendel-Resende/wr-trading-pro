"""WR Trade Pro — registro de jobs em subprocesso (Item C).

Gerencia processos filhos de vida curta/longa (treino ML, ou qualquer script
usado em teste) com cancelamento REAL de ÁRVORE de processos: `cancel()`
tenta terminar o processo principal e todos os descendentes conhecidos no
momento da chamada, confirma o encerramento (poll + verificação de
descendentes quando `psutil` está disponível) e só então reporta sucesso.
Se a confirmação não puder ser feita com certeza, `cancel()` retorna False
em vez de mentir sobre o estado do processo.

Cada job roda em seu próprio grupo de processos (Windows:
`CREATE_NEW_PROCESS_GROUP`; POSIX: `start_new_session`) para que o
encerramento de um job não afete o processo Flask hospedeiro nem outros
jobs. O encerramento nunca usa correspondência por nome de executável
(ex.: matar todo "python.exe" do sistema) — apenas o PID/PGID exato do job
registrado.

Metadados mínimos de cada job (PID, horário de criação do processo,
comando) são persistidos em `<jobsDir>/<jobId>.job.json` para permitir
reconciliação após um restart do processo Flask (ver `reconcile_from_disk`).

Uso interno de `ml_api.py`; também usado diretamente pela suíte de testes do
Item C para provar ausência de processo órfão sem depender da stack completa
do LightGBM/XGBoost.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import uuid

try:
    import psutil  # type: ignore
except ImportError as exc:  # pragma: no cover - ambiente sem psutil instalado
    # Bloqueador 20 (revisão Guardião): psutil é dependência obrigatória
    # (requirements.txt). Sem ela não há como confirmar identidade de
    # processo (defesa contra reuse de PID) nem enumerar descendentes —
    # falha fechado no import em vez de degradar silenciosamente para
    # "PID vivo = processo confirmado", que é inseguro.
    raise ImportError(
        'psutil é obrigatório para python/ml/job_runner.py (cancelamento real de '
        'árvore de processos e confirmação de identidade). Instale com '
        '`pip install psutil` (já listado em python/requirements.txt).'
    ) from exc


class JobMeta:
    __slots__ = ('job_id', 'pid', 'create_time', 'args', 'started_at')

    def __init__(self, job_id: str, pid: int, create_time: float | None, args: list[str], started_at: float):
        self.job_id = job_id
        self.pid = pid
        self.create_time = create_time
        self.args = args
        self.started_at = started_at

    def to_dict(self) -> dict:
        return {
            'jobId': self.job_id,
            'pid': self.pid,
            'createTime': self.create_time,
            'args': self.args,
            'startedAt': self.started_at,
        }

    @staticmethod
    def from_dict(d: dict) -> 'JobMeta':
        return JobMeta(d['jobId'], d['pid'], d.get('createTime'), d.get('args', []), d.get('startedAt', 0.0))


def _process_create_time(pid: int) -> float | None:
    try:
        return psutil.Process(pid).create_time()
    except Exception:  # noqa: BLE001
        return None


def _pid_matches_meta(meta: JobMeta) -> bool:
    """Confirma que o PID salvo ainda se refere ao MESMO processo (defesa
    básica contra reuse de PID após o processo original ter morrido). PID
    vivo por si só NUNCA é tratado como identidade confirmada — psutil é
    obrigatório (ver import no topo do módulo) e `create_time` é sempre
    comparado quando disponível."""
    try:
        proc = psutil.Process(meta.pid)
    except psutil.NoSuchProcess:
        return False
    if meta.create_time is None:
        return True
    return abs(proc.create_time() - meta.create_time) < 1.0


def _kill_tree(pid: int, timeout: float) -> bool:
    """Termina o processo `pid` e toda sua árvore de descendentes.
    Retorna True apenas se conseguir CONFIRMAR que nada ficou vivo."""
    try:
        root = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return True
    procs = root.children(recursive=True) + [root]
    for p in procs:
        try:
            p.terminate()
        except psutil.NoSuchProcess:
            pass
    _, alive = psutil.wait_procs(procs, timeout=timeout)
    for p in alive:
        try:
            p.kill()
        except psutil.NoSuchProcess:
            pass
    _, alive = psutil.wait_procs(procs, timeout=timeout)
    return len(alive) == 0


class JobRegistry:
    def __init__(self, jobs_dir: str | None = None):
        self._lock = threading.Lock()
        self._jobs: dict[str, subprocess.Popen] = {}
        self._meta: dict[str, JobMeta] = {}
        self._cancelled: set[str] = set()
        self._jobs_dir = jobs_dir

    def start(self, args: list[str], job_id: str | None = None, cwd: str | None = None) -> str:
        """Inicia o job. Idempotente em relação a `job_id`: se um job com o
        mesmo `job_id` já existe e ainda está confirmadamente rodando (ou
        seu estado de término ainda não foi consumido), retorna o `job_id`
        existente SEM spawnar um novo processo (Bloqueador 9/19 — o Next
        gera e persiste o jobId antes do POST; um retry por timeout de
        resposta não pode duplicar o processo)."""
        job_id = job_id or uuid.uuid4().hex
        if job_id in self._meta or job_id in self._jobs:
            existing_state = self.status(job_id)
            if existing_state in ('RUNNING', 'ORPHAN_RUNNING', 'EXITED'):
                return job_id
        kwargs: dict = {}
        if cwd is not None:
            kwargs['cwd'] = cwd
        if sys.platform == 'win32':
            kwargs['creationflags'] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs['start_new_session'] = True
        proc = subprocess.Popen(args, **kwargs)
        meta = JobMeta(job_id, proc.pid, _process_create_time(proc.pid), args, time.time())
        with self._lock:
            self._jobs[job_id] = proc
            self._meta[job_id] = meta
        self._persist_meta(meta)
        return job_id

    def _meta_path(self, job_id: str) -> str | None:
        if self._jobs_dir is None:
            return None
        return os.path.join(self._jobs_dir, f'{job_id}.job.json')

    def _persist_meta(self, meta: JobMeta) -> None:
        path = self._meta_path(meta.job_id)
        if path is None:
            return
        tmp = f'{path}.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(meta.to_dict(), f)
        os.replace(tmp, path)

    def reconcile_from_disk(self) -> None:
        """Reconstrói o conhecimento de jobs a partir dos metadados
        persistidos em `jobsDir` (chamado após restart do processo Flask).
        Não recupera o `Popen` original (impossível após restart) — apenas
        o PID/identidade, suficiente para poll()/cancel() funcionarem via
        checagem de SO em vez de `Popen.poll()`."""
        if self._jobs_dir is None or not os.path.isdir(self._jobs_dir):
            return
        for name in os.listdir(self._jobs_dir):
            if not name.endswith('.job.json'):
                continue
            job_id = name[: -len('.job.json')]
            try:
                with open(os.path.join(self._jobs_dir, name), 'r', encoding='utf-8') as f:
                    meta = JobMeta.from_dict(json.load(f))
            except (OSError, ValueError, KeyError):
                continue
            with self._lock:
                if job_id not in self._jobs:
                    self._meta[job_id] = meta

    def status(self, job_id: str) -> str:
        """Retorna um de: 'UNKNOWN' (nunca existiu para este registry),
        'RUNNING' (processo confirmado vivo), 'ORPHAN_RUNNING' (processo de
        uma execução anterior ainda vivo após restart, sem Popen local),
        'EXITED' (processo terminou)."""
        with self._lock:
            proc = self._jobs.get(job_id)
            meta = self._meta.get(job_id)
        if proc is not None:
            return 'RUNNING' if proc.poll() is None else 'EXITED'
        if meta is None:
            return 'UNKNOWN'
        return 'ORPHAN_RUNNING' if _pid_matches_meta(meta) else 'EXITED'

    def poll(self, job_id: str) -> int | None:
        """Retorna None se ainda rodando (ou órfão possivelmente vivo), ou
        o exit code (int) se confirmadamente terminou. Para jobs órfãos
        (sem Popen local, ex.: após restart) sem exit code disponível,
        retorna -1 quando confirmado morto, para diferenciar de
        'ainda rodando' (None)."""
        with self._lock:
            proc = self._jobs.get(job_id)
        if proc is not None:
            return proc.poll()
        st = self.status(job_id)
        if st == 'EXITED':
            return -1
        return None

    def is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._cancelled

    def cancel(self, job_id: str, timeout: float = 5.0) -> bool:
        """Encerra a árvore de processos do job. Retorna True somente se
        confirmar (via psutil quando disponível, ou verificação nativa do
        SO) que o processo principal e seus descendentes conhecidos no
        momento da chamada estão mortos. Nunca reporta sucesso sem essa
        confirmação."""
        with self._lock:
            proc = self._jobs.get(job_id)
            meta = self._meta.get(job_id)
            self._cancelled.add(job_id)
        pid = proc.pid if proc is not None else (meta.pid if meta is not None else None)
        if pid is None:
            return False
        if proc is not None and proc.poll() is not None:
            return True
        if proc is None and meta is not None and not _pid_matches_meta(meta):
            return True  # já morto (ou PID reciclado) — nada a fazer

        killed = _kill_tree(pid, timeout)
        if proc is not None:
            try:
                proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                pass
        return killed

    def forget(self, job_id: str) -> None:
        with self._lock:
            self._jobs.pop(job_id, None)
            self._meta.pop(job_id, None)
            self._cancelled.discard(job_id)
        path = self._meta_path(job_id)
        if path is not None:
            try:
                os.remove(path)
            except OSError:
                pass
