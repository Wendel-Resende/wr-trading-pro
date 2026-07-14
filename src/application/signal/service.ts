import type { SignalRepository } from '../../domain/v1/ports/signal-repository';
import type { ModelVersionRepository } from '../../domain/v1/ports/model-version-repository';
import type { SignalSubmission } from '../../domain/v1/models/signal';
import { ReadModelError } from '../read-models-v1/errors';
import { assembleSignal } from './assemblers';
import type { SignalReadModelV1 } from './dto';

export interface SignalServicePorts {
  readonly signalRepository: SignalRepository;
  readonly modelVersionRepository: ModelVersionRepository;
}

/**
 * Application service for Signal (Fase 5 / Item 3). `generate` requires
 * the referenced ModelVersion to exist and not be invalidated. The
 * caller supplies `direction`/`score` already computed against
 * point-in-time data (via the Phase 2 read-model routes); this service
 * enforces provenance (`knowledgeTime <= barTime`, ModelVersion
 * validity) but does not itself re-run feature extraction — see
 * deviation note in the Fase 5 handoff.
 */
export class SignalService {
  constructor(private readonly ports: SignalServicePorts) {}

  async generate(submission: SignalSubmission): Promise<SignalReadModelV1> {
    const modelVersion = await this.ports.modelVersionRepository.findById(submission.modelVersionId);
    if (!modelVersion) {
      throw new ReadModelError('MODEL_VERSION_NOT_FOUND', `ModelVersion ${submission.modelVersionId} não encontrado`);
    }
    if (modelVersion.invalidatedAt !== null) {
      throw new ReadModelError('INVALID_MODEL_VERSION', `ModelVersion ${submission.modelVersionId} está invalidado`);
    }
    try {
      const signal = await this.ports.signalRepository.create(submission);
      return assembleSignal(signal);
    } catch (error) {
      if (error instanceof Error && error.name.includes('Zod')) {
        throw new ReadModelError('INVALID_BODY', 'Signal inválido: ' + error.message);
      }
      throw error;
    }
  }

  async get(signalId: string): Promise<SignalReadModelV1> {
    const signal = await this.ports.signalRepository.findById(signalId);
    if (!signal) throw new ReadModelError('SIGNAL_NOT_FOUND', `Signal ${signalId} não encontrado`);
    return assembleSignal(signal);
  }

  async listByInstrument(instrumentId: string): Promise<readonly SignalReadModelV1[]> {
    const signals = await this.ports.signalRepository.findByInstrument(instrumentId);
    return Object.freeze(signals.map(assembleSignal));
  }
}
