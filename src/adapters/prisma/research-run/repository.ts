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

  async findByDataset(datasetId: string): Promise<readonly ResearchRun[]> {
    const rows = await this.prisma.researchRun.findMany({
      where: { datasetId },
      orderBy: [{ createdAt: 'asc' }, { runId: 'asc' }],
    });
    return Object.freeze(rows.map(toResearchRun));
  }
}
