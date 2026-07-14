import type { ResearchRunRepository } from '../../domain/v1/ports/research-repository';
import type { ResearchRunSubmission } from '../../domain/v1/models/research-run';
import { ReadModelError } from '../read-models-v1/errors';
import { assembleResearchRun } from './assemblers';
import type { ResearchRunReadModelV1 } from './dto';

export interface ResearchRunServicePorts {
  readonly researchRunRepository: ResearchRunRepository;
}

/**
 * Application service for ResearchRun (Fase 5 / Item 1). Depends only on
 * injected ports. `createdBy` always comes from the caller (resolved
 * from the session by the route layer), never from the request body.
 */
export class ResearchRunService {
  constructor(private readonly ports: ResearchRunServicePorts) {}

  async submit(submission: ResearchRunSubmission, createdBy: string): Promise<ResearchRunReadModelV1> {
    try {
      const run = await this.ports.researchRunRepository.create(submission, createdBy);
      return assembleResearchRun(run);
    } catch (error) {
      if (error instanceof Error && error.name.includes('Zod')) {
        throw new ReadModelError('INVALID_BODY', 'ResearchRun inválido: ' + error.message);
      }
      throw error;
    }
  }

  async get(runId: string): Promise<ResearchRunReadModelV1> {
    const run = await this.ports.researchRunRepository.findById(runId);
    if (!run) throw new ReadModelError('RESEARCH_RUN_NOT_FOUND', `ResearchRun ${runId} não encontrado`);
    return assembleResearchRun(run);
  }

  async listByDataset(datasetId: string): Promise<readonly ResearchRunReadModelV1[]> {
    const runs = await this.ports.researchRunRepository.findByDataset(datasetId);
    return Object.freeze(runs.map(assembleResearchRun));
  }
}
