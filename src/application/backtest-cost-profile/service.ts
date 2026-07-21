import type { BacktestCostProfile, BacktestCostProfileSubmission } from '../../domain/v1/models/backtest-cost-profile';
import type { BacktestCostProfileRepository } from '../../domain/v1/ports/backtest-cost-profile-repository';
import { ReadModelError } from '../read-models-v1/errors';
import { isAdmin } from '../../lib/auth/admin';

export interface BacktestCostProfileServicePorts {
  readonly repository: BacktestCostProfileRepository;
}

/**
 * Item A (D5, revisão 4): criação/arquivamento são Admin-only, com
 * `createdBy`/`archivedBy` sempre derivados da sessão autenticada — nunca
 * aceitos do corpo da requisição (evita spoofing de autoria).
 */
export class BacktestCostProfileService {
  constructor(private readonly ports: BacktestCostProfileServicePorts) {}

  async create(submission: Omit<BacktestCostProfileSubmission, 'createdBy'>, requestedBy: string): Promise<BacktestCostProfile> {
    if (!isAdmin(requestedBy)) {
      throw new ReadModelError('FORBIDDEN', 'apenas administradores podem cadastrar BacktestCostProfile');
    }
    return this.ports.repository.create({ ...submission, createdBy: requestedBy });
  }

  async archive(id: string, requestedBy: string): Promise<BacktestCostProfile> {
    if (!isAdmin(requestedBy)) {
      throw new ReadModelError('FORBIDDEN', 'apenas administradores podem arquivar BacktestCostProfile');
    }
    const existing = await this.ports.repository.findById(id);
    if (!existing) throw new ReadModelError('COST_PROFILE_NOT_FOUND', `BacktestCostProfile ${id} não encontrado`);
    if (existing.archivedAt !== null) return existing; // já arquivado: idempotente, não é erro
    return this.ports.repository.archive(id, new Date().toISOString(), requestedBy);
  }

  /** Usado pelo fluxo de treino ML: falha explícito se o perfil não existe
   *  ou está arquivado — nunca cai para um custo implícito (D5). */
  async resolveActiveForTraining(id: string): Promise<BacktestCostProfile> {
    const profile = await this.ports.repository.findById(id);
    if (!profile) throw new ReadModelError('COST_PROFILE_NOT_FOUND', `BacktestCostProfile ${id} não encontrado`);
    if (profile.archivedAt !== null) {
      throw new ReadModelError('INVALID_COST_PROFILE', `BacktestCostProfile ${id} está arquivado`);
    }
    return profile;
  }
}
