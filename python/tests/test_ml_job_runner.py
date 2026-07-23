"""Testes reais (sem mocks) do tree-kill e da persistência/reconciliação de
python/ml/job_runner.py (Item C, correção pós-revisão Guardião).

Nunca aceita ausência de PID de filho como sucesso: se o processo pai não
gravar o PID do filho no arquivo esperado dentro do timeout, o teste FALHA
com erro explícito (não passa silenciosamente).
"""
import os
import sys
import tempfile
import time

import psutil
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from ml.job_runner import JobRegistry  # noqa: E402

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), '_job_runner_fixtures')
PARENT_SCRIPT = os.path.join(FIXTURES_DIR, 'parent_with_child.py')


def _wait_for_file(path: str, timeout: float = 10.0) -> str:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read().strip()
            if content:
                return content
        time.sleep(0.1)
    raise AssertionError(
        f'Processo pai de teste não gravou o PID do filho em {path} dentro de {timeout}s — '
        'teste não pode prosseguir (ausência de PID do filho NUNCA é sucesso).'
    )


def _wait_until(predicate, timeout: float = 10.0, interval: float = 0.1) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()


def test_cancel_kills_parent_and_child_process_tree():
    tmp_dir = tempfile.mkdtemp()
    pid_file = os.path.join(tmp_dir, 'child.pid')
    jobs_dir = os.path.join(tmp_dir, 'jobs')
    os.makedirs(jobs_dir, exist_ok=True)

    registry = JobRegistry(jobs_dir=jobs_dir)
    job_id = registry.start([sys.executable, PARENT_SCRIPT, pid_file])

    parent_pid = registry._meta[job_id].pid  # noqa: SLF001 - inspeção direta em teste
    assert psutil.pid_exists(parent_pid), 'processo pai deveria estar vivo logo após start()'

    # Captura DETERMINÍSTICA do PID do filho via arquivo escrito pelo pai.
    # Se isso falhar, o teste levanta AssertionError (nunca passa em silêncio).
    child_pid = int(_wait_for_file(pid_file))
    assert psutil.pid_exists(child_pid), 'PID do filho capturado mas processo já não existe'

    assert registry.status(job_id) == 'RUNNING'

    ok = registry.cancel(job_id, timeout=8.0)
    assert ok is True, 'cancel() deveria confirmar o encerramento da árvore de processos'

    parent_dead = _wait_until(lambda: not psutil.pid_exists(parent_pid), timeout=5.0)
    child_dead = _wait_until(lambda: not psutil.pid_exists(child_pid), timeout=5.0)
    assert parent_dead, 'processo PAI deveria estar morto após cancel() confirmado'
    assert child_dead, 'processo FILHO deveria estar morto após cancel() confirmado (tree-kill real)'


def test_persisted_metadata_survives_registry_restart_and_reports_running():
    tmp_dir = tempfile.mkdtemp()
    pid_file = os.path.join(tmp_dir, 'child.pid')
    jobs_dir = os.path.join(tmp_dir, 'jobs')
    os.makedirs(jobs_dir, exist_ok=True)

    registry_before_restart = JobRegistry(jobs_dir=jobs_dir)
    job_id = registry_before_restart.start([sys.executable, PARENT_SCRIPT, pid_file])
    parent_pid = registry_before_restart._meta[job_id].pid  # noqa: SLF001
    child_pid = int(_wait_for_file(pid_file))

    meta_path = os.path.join(jobs_dir, f'{job_id}.job.json')
    assert os.path.isfile(meta_path), 'metadados do job deveriam ter sido persistidos em disco'

    try:
        # Simula restart do processo Flask: nova instância de JobRegistry
        # apontando para o MESMO diretório de estado persistido, sem
        # referência ao Popen original.
        registry_after_restart = JobRegistry(jobs_dir=jobs_dir)
        assert registry_after_restart.status(job_id) == 'UNKNOWN', (
            'antes de reconciliar, um registry novo não deve conhecer o job'
        )

        registry_after_restart.reconcile_from_disk()

        state = registry_after_restart.status(job_id)
        assert state == 'ORPHAN_RUNNING', (
            f'job vivo e reconciliado a partir do disco deveria reportar ORPHAN_RUNNING, obteve {state!r}'
        )

        # Job desconhecido (nunca existiu) continua UNKNOWN mesmo após reconciliação.
        assert registry_after_restart.status('job-que-nunca-existiu') == 'UNKNOWN'

        # Cancela via o registry "reiniciado" (sem Popen local) e confirma
        # que a árvore de processos morre de verdade.
        ok = registry_after_restart.cancel(job_id, timeout=8.0)
        assert ok is True

        parent_dead = _wait_until(lambda: not psutil.pid_exists(parent_pid), timeout=5.0)
        child_dead = _wait_until(lambda: not psutil.pid_exists(child_pid), timeout=5.0)
        assert parent_dead
        assert child_dead

        state_after_cancel = registry_after_restart.status(job_id)
        assert state_after_cancel == 'EXITED'
    finally:
        # segurança: garante que não deixamos processos vivos mesmo se uma
        # asserção falhar no meio do teste.
        if psutil.pid_exists(parent_pid):
            try:
                psutil.Process(parent_pid).kill()
            except psutil.NoSuchProcess:
                pass
        if psutil.pid_exists(child_pid):
            try:
                psutil.Process(child_pid).kill()
            except psutil.NoSuchProcess:
                pass


def test_status_reports_orphaned_when_pid_identity_does_not_match():
    """Se o PID persistido foi reciclado por outro processo (create_time
    diferente), o job deve ser reportado como EXITED (identidade não
    confere), nunca como RUNNING."""
    tmp_dir = tempfile.mkdtemp()
    jobs_dir = os.path.join(tmp_dir, 'jobs')
    os.makedirs(jobs_dir, exist_ok=True)

    registry = JobRegistry(jobs_dir=jobs_dir)
    job_id = registry.start([sys.executable, '-c', 'import time; time.sleep(30)'])
    pid = registry._meta[job_id].pid  # noqa: SLF001

    try:
        # Fabrica metadados com create_time incompatível (simula PID reuse).
        registry_after_restart = JobRegistry(jobs_dir=jobs_dir)
        registry_after_restart.reconcile_from_disk()
        registry_after_restart._meta[job_id].create_time = 1.0  # noqa: SLF001
        state = registry_after_restart.status(job_id)
        assert state == 'EXITED', f'identidade de PID incompatível deveria reportar EXITED, obteve {state!r}'
    finally:
        registry.cancel(job_id, timeout=5.0)


if __name__ == '__main__':
    sys.exit(pytest.main([__file__, '-v']))
