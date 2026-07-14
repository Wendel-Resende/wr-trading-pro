import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { OptionPosition, OptionPositionSubmission } from '../../../domain/v1/models/option-position';
import type { OptionPositionRepository } from '../../../domain/v1/ports/option-repository';
import { toOptionPosition } from './mapping';

/**
 * Prisma implementation of `OptionPositionRepository` (Fase 6 —
 * Consolidação). `id` is always generated server-side (`randomUUID()`),
 * never accepted from the caller.
 */
export class PrismaOptionPositionRepository implements OptionPositionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(submission: OptionPositionSubmission): Promise<OptionPosition> {
    const id = randomUUID();
    const row = await this.prisma.optionPosition.create({
      data: {
        id,
        instrumentId: submission.instrumentId,
        kind: submission.kind,
        strike: submission.strike,
        expiration: new Date(submission.expiration),
        side: submission.side,
        quantity: submission.quantity,
        source: submission.source,
        knowledgeTime: new Date(submission.knowledgeTime),
      },
    });
    return toOptionPosition(row);
  }

  async findById(id: string): Promise<OptionPosition | null> {
    const row = await this.prisma.optionPosition.findUnique({ where: { id } });
    return row ? toOptionPosition(row) : null;
  }

  async findByInstrumentId(instrumentId: string): Promise<readonly OptionPosition[]> {
    const rows = await this.prisma.optionPosition.findMany({
      where: { instrumentId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return Object.freeze(rows.map(toOptionPosition));
  }
}
