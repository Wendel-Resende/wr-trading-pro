import type { PrismaClient } from '@prisma/client';
import type { KnowledgeView } from '../../../domain/v1/models/ingestion';
import type { Issuer } from '../../../domain/v1/models/issuer';
import type { IssuerRepository } from '../../../domain/v1/ports/issuer-repository';
import { toIssuer } from './mapping';
import { CvmCodeSchema } from './schemas';
import { requireAdapterInstant } from './timestamps';

const knowledgeDate = (view: KnowledgeView): Date => {
  requireAdapterInstant(view.knowledgeTime, 'knowledgeTime');
  return new Date(view.knowledgeTime);
};

/** As-known-at read repository: only rows created by a SUCCEEDED run completed at or before knowledgeTime are visible. */
export class PrismaIssuerRepository implements IssuerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getIssuerByCvmCode(cvmCode: string, view: KnowledgeView): Promise<Issuer | null> {
    const normalizedCvmCode = CvmCodeSchema.parse(cvmCode);
    const asOf = knowledgeDate(view);
    const row = await this.prisma.issuer.findFirst({
      where: {
        cvmCode: normalizedCvmCode,
        createdByRun: { is: { status: 'SUCCEEDED', completedAt: { lte: asOf } } },
      },
    });
    return row ? toIssuer(row) : null;
  }

  async findIssuers(view: KnowledgeView): Promise<readonly Issuer[]> {
    const asOf = knowledgeDate(view);
    const rows = await this.prisma.issuer.findMany({
      where: { createdByRun: { is: { status: 'SUCCEEDED', completedAt: { lte: asOf } } } },
      orderBy: { cvmCode: 'asc' },
    });
    return Object.freeze(rows.map(toIssuer));
  }
}
