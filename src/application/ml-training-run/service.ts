import type { MlTrainingRun, MlTrainingRunStatus } from '../../domain/v1/models/ml-training-run';
import type { MlTrainingRunRepository, MlTrainingRunUpdate } from '../../domain/v1/ports/ml-training-run-repository';
import { ReadModelError } from '../read-models-v1/errors';
import { canTransition, isTerminalStatus } from './state-machine';

export interface MlTrainingRunServicePorts {
  readonly repository: MlTrainingRunRepository;
}

const MAX_LIST_LIMIT = 100;

/**
 * Item C: aplicação/orquestração de estado do `MlTrainingRun` — toda
 * transição passa por aqui (máquina de estados de `state-machine.ts`),
 * nunca escrita direta de `status` em outro lugar do código (spec §4).
 */
export class MlTrainingRunService {
  constructor(private readonly ports: MlTrainingRunServicePorts) {}

  async requestTraining(requestedBy: string, costProfileId: string, costProfileVersion: number, symbols: readonly string[] | null): Promise<MlTrainingRun> {
    const result = await this.ports.repository.createIfNoneActive({ requestedBy, costProfileId, costProfileVersion, symbols });
    if (result.outcome === 'CONFLICT') {
      throw new ReadModelError('TRAINING_RUN_ALREADY_ACTIVE', `já existe um treino ativo (${result.run.trainingRunId})`);
    }
    return result.run;
  }

  async get(trainingRunId: string): Promise<MlTrainingRun> {
    const run = await this.ports.repository.findById(trainingRunId);
    if (!run) throw new ReadModelError('TRAINING_RUN_NOT_FOUND', `MlTrainingRun ${trainingRunId} não encontrado`);
    return run;
  }

  async list(limit: number, cursor?: string): Promise<readonly MlTrainingRun[]> {
    const boundedLimit = Math.min(Math.max(limit, 1), MAX_LIST_LIMIT);
    return this.ports.repository.list(boundedLimit, cursor);
  }

  /**
   * Idempotente: repetir cancel em CANCEL_REQUESTED/estado terminal apenas
   * devolve o estado atual. `cancelIfActive` é um único statement atômico
   * contra QUEUED/RUNNING — nunca lê o status antes para decidir (isso
   * abriria uma janela de corrida real contra o worker, que faz seu
   * próprio CAS QUEUED -> RUNNING ao mesmo tempo; encontrado e corrigido
   * durante a suíte de testes deste item).
   */
  async requestCancel(trainingRunId: string): Promise<MlTrainingRun> {
    const updated = await this.ports.repository.cancelIfActive(trainingRunId);
    if (updated) return updated;

    // Não havia QUEUED/RUNNING no momento do statement — ou já está em
    // CANCEL_REQUESTED/terminal (idempotente), ou o id não existe.
    const run = await this.get(trainingRunId);
    if (isTerminalStatus(run.status) || run.status === 'CANCEL_REQUESTED') return run;
    throw new ReadModelError('TRAINING_RUN_NOT_CANCELABLE', `MlTrainingRun ${trainingRunId} não está em estado cancelável (${run.status})`);
  }

  /**
   * Transição de baixo nível usada exclusivamente pelo worker
   * (`worker.ts`). Valida a transição contra a máquina de estados ANTES de
   * tentar o compare-and-swap no repositório; `null` de retorno significa
   * que o CAS falhou (outro escritor já mudou o status esperado) — o
   * chamador deve reconsultar o estado real e decidir se prossegue.
   */
  async transition(trainingRunId: string, expectedStatus: MlTrainingRunStatus, patch: MlTrainingRunUpdate): Promise<MlTrainingRun | null> {
    if (patch.status !== undefined && !canTransition(expectedStatus, patch.status)) {
      throw new ReadModelError(
        'INVALID_TRAINING_RUN_TRANSITION',
        `transição inválida ${expectedStatus} -> ${patch.status} para MlTrainingRun ${trainingRunId}`,
      );
    }
    return this.ports.repository.update(trainingRunId, expectedStatus, patch);
  }

  async listNonTerminal(): Promise<readonly MlTrainingRun[]> {
    return this.ports.repository.listNonTerminal();
  }
}
