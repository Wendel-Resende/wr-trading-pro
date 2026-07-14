import type { Signal, SignalSubmission } from '../models/signal';

export interface SignalRepository {
  create(submission: SignalSubmission): Promise<Signal>;
  findById(signalId: string): Promise<Signal | null>;
  findByInstrument(instrumentId: string): Promise<readonly Signal[]>;
  findByModelVersion(modelVersionId: string): Promise<readonly Signal[]>;
}
