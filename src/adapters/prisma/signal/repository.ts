import type { PrismaClient } from '@prisma/client';
import type { Signal, SignalSubmission } from '../../../domain/v1/models/signal';
import type { SignalRepository } from '../../../domain/v1/ports/signal-repository';
import { toSignal } from './mapping';
import { SignalSubmissionSchema } from './schemas';

export class PrismaSignalRepository implements SignalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(submission: SignalSubmission): Promise<Signal> {
    const parsed = SignalSubmissionSchema.parse(submission);
    const row = await this.prisma.signal.create({
      data: {
        modelVersionId: parsed.modelVersionId,
        instrumentId: parsed.instrumentId,
        barTime: new Date(parsed.barTime),
        direction: parsed.direction,
        score: parsed.score ?? null,
        knowledgeTime: new Date(parsed.knowledgeTime),
      },
    });
    return toSignal(row);
  }

  async findById(signalId: string): Promise<Signal | null> {
    const row = await this.prisma.signal.findUnique({ where: { signalId } });
    return row ? toSignal(row) : null;
  }

  async findByInstrument(instrumentId: string): Promise<readonly Signal[]> {
    const rows = await this.prisma.signal.findMany({
      where: { instrumentId },
      orderBy: [{ barTime: 'asc' }, { signalId: 'asc' }],
    });
    return Object.freeze(rows.map(toSignal));
  }

  async findByModelVersion(modelVersionId: string): Promise<readonly Signal[]> {
    const rows = await this.prisma.signal.findMany({
      where: { modelVersionId },
      orderBy: [{ barTime: 'asc' }, { signalId: 'asc' }],
    });
    return Object.freeze(rows.map(toSignal));
  }
}
