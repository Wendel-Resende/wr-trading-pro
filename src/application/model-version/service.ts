import type { ModelVersionRepository } from '../../domain/v1/ports/model-version-repository';
import type { ModelVersionKind, ModelVersionSubmission } from '../../domain/v1/models/model-version';
import { ReadModelError } from '../read-models-v1/errors';
import { assembleModelVersion } from './assemblers';
import type { ModelVersionReadModelV1 } from './dto';

export interface ModelVersionServicePorts {
  readonly modelVersionRepository: ModelVersionRepository;
}

/**
 * Application service for ModelVersion (Fase 5 / Item 2). Rejects
 * kind='ML' submissions without valid trainingEvidenceJson (A20) — the
 * rejection happens in the adapter's Zod schema (superRefine), surfaced
 * here as INVALID_MODEL_VERSION.
 */
export class ModelVersionService {
  constructor(private readonly ports: ModelVersionServicePorts) {}

  async submit(submission: ModelVersionSubmission): Promise<ModelVersionReadModelV1> {
    try {
      const version = await this.ports.modelVersionRepository.create(submission);
      return assembleModelVersion(version);
    } catch (error) {
      if (error instanceof Error && error.name.includes('Zod')) {
        throw new ReadModelError('INVALID_MODEL_VERSION', 'ModelVersion inválido: ' + error.message);
      }
      throw error;
    }
  }

  async get(modelVersion: string): Promise<ModelVersionReadModelV1> {
    const version = await this.ports.modelVersionRepository.findById(modelVersion);
    if (!version) throw new ReadModelError('MODEL_VERSION_NOT_FOUND', `ModelVersion ${modelVersion} não encontrado`);
    return assembleModelVersion(version);
  }

  async listByKind(kind: ModelVersionKind): Promise<readonly ModelVersionReadModelV1[]> {
    const versions = await this.ports.modelVersionRepository.findByKind(kind);
    return Object.freeze(versions.map(assembleModelVersion));
  }

  /** Item B (bloqueador alto 3): paginação server-side para a rota pública de visão ML. */
  async listByKindPaginated(kind: ModelVersionKind, limit: number, cursor?: string): Promise<readonly ModelVersionReadModelV1[]> {
    const versions = await this.ports.modelVersionRepository.listByKindPaginated(kind, limit, cursor);
    return Object.freeze(versions.map(assembleModelVersion));
  }

  async invalidate(modelVersion: string, invalidatedAt: string, reason: string): Promise<ModelVersionReadModelV1> {
    const existing = await this.ports.modelVersionRepository.findById(modelVersion);
    if (!existing) throw new ReadModelError('MODEL_VERSION_NOT_FOUND', `ModelVersion ${modelVersion} não encontrado`);
    const updated = await this.ports.modelVersionRepository.invalidate(modelVersion, invalidatedAt, reason);
    return assembleModelVersion(updated);
  }
}
