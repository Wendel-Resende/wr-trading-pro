import type { PrismaClient } from '@prisma/client';
import type { ResearchRun, ResearchRunSubmission } from '../../../domain/v1/models/research-run';
import type { ResearchRunRepository } from '../../../domain/v1/ports/research-repository';
import { toResearchRun } from './mapping';
import { ResearchRunSubmissionSchema } from './schemas';

export class PrismaResearchRunRepository implements ResearchRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(submission: ResearchRunSubmission, createdBy: string): Promise<ResearchRun> {
    const parsed = ResearchRunSubmissionSchema.parse(submission);
    const row = await this.prisma.researchRun.create({
      data: {
        name: parsed.name,
        hypothesis: parsed.hypothesis,
        datasetId: parsed.datasetId,
        windowStart: new Date(parsed.windowStart),
        windowEnd: new Date(parsed.windowEnd),
        paramsJson: parsed.paramsJson,
        createdBy,
        modelVersionId: parsed.modelVersionId ?? null,
      },
    });
    return toResearchRun(row);
  }

  async findById(runId: string): Promise<ResearchRun | null> {
    const row = await this.prisma.researchRun.findUnique({ where: { runId } });
    return row ? toResearchRun(row) : null;
  }

  async findByDataset(datasetId: string, limit?: number, cursor?: string): Promise<readonly ResearchRun[]> {
    const rows = await this.prisma.researchRun.findMany({
      where: { datasetId },
      orderBy: [{ createdAt: 'asc' }, { runId: 'asc' }],
      ...(limit !== undefined ? { take: limit } : {}),
      ...(cursor ? { cursor: { runId: cursor }, skip: 1 } : {}),
    });
    return Object.freeze(rows.map(toResearchRun));
  }

  async findByModelVersion(modelVersionId: string, limit: number, cursor?: string): Promise<readonly ResearchRun[]> {
    const rows = await this.prisma.researchRun.findMany({
      where: { modelVersionId },
      orderBy: [{ createdAt: 'desc' }, { runId: 'desc' }],
      take: limit,
      ...(cursor ? { cursor: { runId: cursor }, skip: 1 } : {}),
    });
    return Object.freeze(rows.map(toResearchRun));
  }

  async linkModelVersion(runId: string, modelVersionId: string): Promise<ResearchRun> {
    const row = await this.prisma.researchRun.update({ where: { runId }, data: { modelVersionId } });
    return toResearchRun(row);
  }

  async findRecentByName(name: string, limit: number, cursor?: string): Promise<readonly ResearchRun[]> {
    const rows = await this.prisma.researchRun.findMany({
      where: { name },
      orderBy: [{ createdAt: 'desc' }, { runId: 'desc' }],
      take: limit,
      ...(cursor ? { cursor: { runId: cursor }, skip: 1 } : {}),
    });
    return Object.freeze(rows.map(toResearchRun));
  }
}
