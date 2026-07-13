import type { PrismaClient } from '@prisma/client';
import type { CvmDocumentType, CvmFiling } from '../../../domain/v1/models/cvm-filing';
import type { CvmPointInTimeView } from '../../../domain/v1/models/cvm-point-in-time-view';
import type { IssuerId } from '../../../domain/v1/models/issuer';
import type { CvmFilingRepository } from '../../../domain/v1/ports/cvm-filing-repository';
import { toCvmFiling } from './mapping';
import { CivilDateSchema, CvmPointInTimeViewSchema, CvmProtocolSchema, IssuerIdSchema } from './schemas';

const DOCUMENT_TYPES = ['DFP', 'ITR', 'FRE'] as const;

/**
 * Prisma implementation of CvmFilingRepository. A row is visible only
 * when `publishedAt <= decisionTime` AND `createdByRun` is SUCCEEDED
 * with `completedAt <= knowledgeTime`. The chain-effective filing is the
 * highest-versionNumber row visible under the view.
 */
export class PrismaCvmFilingRepository implements CvmFilingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getFilingByCvmProtocol(cvmProtocol: string, view: CvmPointInTimeView): Promise<CvmFiling | null> {
    const normalizedProtocol = CvmProtocolSchema.parse(cvmProtocol);
    const normalizedView = CvmPointInTimeViewSchema.parse(view);
    const row = await this.prisma.cvmFiling.findFirst({
      where: {
        cvmProtocol: normalizedProtocol,
        publishedAt: { lte: new Date(normalizedView.decisionTime) },
        createdByRun: { is: { status: 'SUCCEEDED', completedAt: { lte: new Date(normalizedView.knowledgeTime) } } },
      },
    });
    return row ? toCvmFiling(row) : null;
  }

  async findFilingChain(
    issuerId: IssuerId,
    documentType: CvmDocumentType,
    referenceDate: string,
    view: CvmPointInTimeView,
  ): Promise<readonly CvmFiling[]> {
    const normalizedIssuerId = IssuerIdSchema.parse(issuerId);
    const normalizedReferenceDate = CivilDateSchema.parse(referenceDate);
    const normalizedView = CvmPointInTimeViewSchema.parse(view);
    if (!DOCUMENT_TYPES.includes(documentType)) {
      throw new Error(`documentType inválido: ${documentType}`);
    }
    const rows = await this.prisma.cvmFiling.findMany({
      where: {
        issuerId: normalizedIssuerId,
        documentType,
        referenceDate: normalizedReferenceDate,
        publishedAt: { lte: new Date(normalizedView.decisionTime) },
        createdByRun: { is: { status: 'SUCCEEDED', completedAt: { lte: new Date(normalizedView.knowledgeTime) } } },
      },
      orderBy: { versionNumber: 'asc' },
    });
    return Object.freeze(rows.map(toCvmFiling));
  }

  async findEffectiveFiling(
    issuerId: IssuerId,
    documentType: CvmDocumentType,
    referenceDate: string,
    view: CvmPointInTimeView,
  ): Promise<CvmFiling | null> {
    const chain = await this.findFilingChain(issuerId, documentType, referenceDate, view);
    if (chain.length === 0) return null;
    return chain.reduce((best, current) => (current.versionNumber > best.versionNumber ? current : best));
  }
}
