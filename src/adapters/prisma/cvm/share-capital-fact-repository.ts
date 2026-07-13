import type { PrismaClient } from '@prisma/client';
import type { CvmPointInTimeView } from '../../../domain/v1/models/cvm-point-in-time-view';
import type {
  ShareCapitalFactQuery,
  ShareCapitalFactRepository,
} from '../../../domain/v1/ports/share-capital-fact-repository';
import type { ShareCapitalFact } from '../../../domain/v1/models/share-capital-fact';
import { toShareCapitalFact } from './mapping';
import { CvmPointInTimeViewSchema, ShareCapitalFactQuerySchema } from './schemas';

/** Prisma implementation of ShareCapitalFactRepository. Visibility and chain-effective selection mirror PrismaCvmFactRepository. */
export class PrismaShareCapitalFactRepository implements ShareCapitalFactRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findShareCapitalFacts(
    query: ShareCapitalFactQuery,
    view: CvmPointInTimeView,
  ): Promise<readonly ShareCapitalFact[]> {
    const normalizedView = CvmPointInTimeViewSchema.parse(view);
    const normalizedQuery = ShareCapitalFactQuerySchema.parse(query);
    const periodFrom = normalizedQuery.periodFrom;
    const periodTo = normalizedQuery.periodTo;

    // Select effective filings before applying fact-level filters so a
    // quantity removed by a restatement cannot leak from its predecessor.
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

    const rows = await this.prisma.shareCapitalFact.findMany({
      where: {
        issuerId: normalizedQuery.issuerId,
        filingId: { in: effectiveFilingIds },
        shareClass: normalizedQuery.shareClass,
        quantityType: normalizedQuery.quantityType,
        periodEnd: { gte: periodFrom, lte: periodTo },
        createdByRun: { is: { status: 'SUCCEEDED', completedAt: { lte: new Date(normalizedView.knowledgeTime) } } },
      },
      orderBy: [{ periodEnd: 'asc' }, { shareClass: 'asc' }],
    });

    return Object.freeze(rows.map(toShareCapitalFact));
  }
}
