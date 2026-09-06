import type { PrismaClient } from '@prisma/client';
import type { ResearchSessionPersistedShape } from '../../../domain/v1/models/research-session';
import type {
  ResearchSessionDraftPatch,
  ResearchSessionListQuery,
  ResearchSessionOutcome,
  ResearchSessionRepository,
  ResearchSessionSubmission,
} from '../../../domain/v1/ports/research-session-repository';
import { toResearchSession } from './mapping';

export class PrismaResearchSessionRepository implements ResearchSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(submission: ResearchSessionSubmission): Promise<ResearchSessionPersistedShape> {
    const row = await this.prisma.researchSession.create({
      data: {
        kind: submission.kind,
        status: 'DRAFT',
        label: submission.label,
        notes: submission.notes,
        configJson: submission.configJson,
        createdBy: submission.createdBy,
      },
    });
    return toResearchSession(row);
  }

  async findById(sessionId: string): Promise<ResearchSessionPersistedShape | null> {
    const row = await this.prisma.researchSession.findUnique({ where: { sessionId } });
    return row === null ? null : toResearchSession(row);
  }

  async list(query: ResearchSessionListQuery): Promise<readonly ResearchSessionPersistedShape[]> {
    const rows = await this.prisma.researchSession.findMany({
      where: {
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        ...(query.status === undefined ? {} : { status: query.status }),
      },
      orderBy: [{ createdAt: 'desc' }, { sessionId: 'desc' }],
      take: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: { sessionId: query.cursor }, skip: 1 }),
    });
    return rows.map(toResearchSession);
  }

  async updateDraft(
    sessionId: string,
    patch: ResearchSessionDraftPatch,
  ): Promise<ResearchSessionPersistedShape | null> {
    // Condicional em `status: 'DRAFT'` — editar a config de uma sessão já em
    // execução tornaria o resultado impossível de atribuir a uma configuração.
    const affected = await this.prisma.researchSession.updateMany({
      where: { sessionId, status: 'DRAFT' },
      data: {
        ...(patch.label === undefined ? {} : { label: patch.label }),
        ...(patch.notes === undefined ? {} : { notes: patch.notes }),
        ...(patch.configJson === undefined ? {} : { configJson: patch.configJson }),
      },
    });
    if (affected.count === 0) return null;
    return this.findById(sessionId);
  }

  async claimForRun(sessionId: string): Promise<boolean> {
    // CAS: mesma trava que `ModelVersion.publishedAt` já usa neste schema.
    // Nunca read-then-write — duas chamadas concorrentes de run() não podem
    // ambas disparar processamento sobre o mesmo rascunho.
    const affected = await this.prisma.researchSession.updateMany({
      where: { sessionId, status: 'DRAFT' },
      data: { status: 'RUNNING' },
    });
    return affected.count === 1;
  }

  async finish(sessionId: string, outcome: ResearchSessionOutcome): Promise<ResearchSessionPersistedShape | null> {
    const affected = await this.prisma.researchSession.updateMany({
      where: { sessionId, status: 'RUNNING' },
      data:
        outcome.status === 'DONE'
          ? { status: 'DONE', resultJson: outcome.resultJson }
          : { status: 'FAILED', errorSummary: outcome.errorSummary },
    });
    if (affected.count === 0) return null;
    return this.findById(sessionId);
  }

  async cancel(sessionId: string): Promise<ResearchSessionPersistedShape | null> {
    await this.prisma.researchSession.updateMany({
      where: { sessionId, status: { in: ['DRAFT', 'RUNNING'] } },
      data: { status: 'CANCELLED' },
    });
    // Idempotente: cancelar uma sessão já terminal devolve a linha atual, não
    // um erro. Cancelar duas vezes não é um problema a reportar.
    return this.findById(sessionId);
  }

  async delete(sessionId: string): Promise<boolean> {
    const affected = await this.prisma.researchSession.deleteMany({ where: { sessionId } });
    return affected.count === 1;
  }
}
