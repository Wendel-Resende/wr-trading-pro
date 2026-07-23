import type { BackfillRun, BackfillRunSubmission } from '../../domain/v1/models/backfill-run';
import type { BackfillRunRepository } from '../../domain/v1/ports/backfill-run-repository';

export interface BackfillRunServicePorts {
  readonly repository: BackfillRunRepository;
}

/**
 * Item B (auditoria final do Guardião, 2026-07-22, bloqueador crítico 1):
 * cada backfill executado persiste um relatório server-side, append-only —
 * a UI hidrata a partir daqui em vez de depender de estado local perdido a
 * cada reload. Sanitização de tickers/mensagens acontece ANTES desta
 * camada (fronteira HTTP) — este serviço só persiste/lê o que já chegou
 * seguro.
 */
export class BackfillRunService {
  constructor(private readonly ports: BackfillRunServicePorts) {}

  async record(submission: BackfillRunSubmission): Promise<BackfillRun> {
    return this.ports.repository.create(submission);
  }

  async getLatest(): Promise<BackfillRun | null> {
    return this.ports.repository.findLatest();
  }
}
