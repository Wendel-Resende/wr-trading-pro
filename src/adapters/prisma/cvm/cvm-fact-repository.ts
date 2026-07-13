import type { PrismaClient } from '@prisma/client';
import type { CvmFact } from '../../../domain/v1/models/cvm-fact';
import type { CvmPointInTimeView } from '../../../domain/v1/models/cvm-point-in-time-view';
import type { CvmFactQuery, CvmFactRepository } from '../../../domain/v1/ports/cvm-fact-repository';
import { toCvmFact } from './mapping';
import { CvmFactQuerySchema, CvmPointInTimeViewSchema } from './schemas';

/**
 * Prisma implementation of CvmFactRepository. Visibility mirrors
 * CvmFilingRepository (via the owning filing's publishedAt/createdByRun).
 * Chain-effective selection: when multiple filing versions for the same
 * (issuerId, documentType, referenceDate) are visible under the view,
 * only facts belonging to the highest-versionNumber (chain-effective)
 * filing are returned.
 */
export class PrismaCvmFactRepository implements CvmFactRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findFacts(query: CvmFactQuery, view: CvmPointInTimeView): Promise<readonly CvmFact[]> {
    const normalizedView = CvmPointInTimeViewSchema.parse(view);
    const normalizedQuery = CvmFactQuerySchema.parse(query);
    const periodFrom = normalizedQuery.periodFrom;
    const periodTo = normalizedQuery.periodTo;

    // Determine effective filings independently of fact filters. Otherwise a
    // fact removed by a visible restatement would incorrectly survive from
    // the predecessor simply because the new filing has no matching row.
    const visibleFilings = await this.prisma.cvmFiling.findMany({
      where: {
        issuerId: normalizedQuery.issuerId,
        publishedAt: { lte: new Date(normalizedView.decisionTime) },
        createdByRun: { is: { status: 'SUCCEEDED', completedAt: { lte: new Date(normalizedView.knowledgeTime) } } },
      },
      select: { id: true, issuerId: true, documentType: true, referenceDate: true, versionNumber: true },
    });
    const effectiveByChain = new Map<string, { id: string; versionNumber: number }>();
    for (const filing of visibleFilings) {
      const key = `${filing.issuerId}|${filing.documentType}|${filing.referenceDate}`;
      const current = effectiveByChain.get(key);
      if (!current || filing.versionNumber > current.versionNumber) {
        effectiveByChain.set(key, { id: filing.id, versionNumber: filing.versionNumber });
      }
    }
    const effectiveFilingIds = [...effectiveByChain.values()].map((filing) => filing.id);
    if (effectiveFilingIds.length === 0) return Object.freeze([]);

    const rows = await this.prisma.cvmFact.findMany({
      where: {
        issuerId: normalizedQuery.issuerId,
        filingId: { in: effectiveFilingIds },
        statementType: normalizedQuery.statementType,
        scope: normalizedQuery.scope,
        accountCode: normalizedQuery.accountCode,
        periodEnd: { gte: periodFrom, lte: periodTo },
        createdByRun: { is: { status: 'SUCCEEDED', completedAt: { lte: new Date(normalizedView.knowledgeTime) } } },
      },
      orderBy: [{ periodEnd: 'asc' }, { accountCode: 'asc' }],
    });

    return Object.freeze(rows.map(toCvmFact));
  }
}
