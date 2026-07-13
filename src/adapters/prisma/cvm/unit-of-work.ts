import { Prisma, type PrismaClient } from '@prisma/client';
import type { IngestionRunId, IngestionSourceKey } from '../../../domain/v1/models/ingestion';
import type { CvmIngestionBatch, CvmIngestionUnitOfWork } from '../../../domain/v1/ports/cvm-ingestion-unit-of-work';
import { compareInstants } from '../../../domain/v1/time';
import {
  DuplicateFactError,
  DuplicateShareCapitalFactError,
  FilingChainViolationError,
  FilingProtocolConflictError,
  InvalidCvmInputError,
  PredecessorAlreadySupersededError,
  RunChronologyError,
  RunNotFoundError,
  RunNotRunningError,
  UnknownFilingReferenceError,
  UnknownIssuerReferenceError,
  UnknownPredecessorFilingError,
} from './errors';
import { CvmIngestionBatchSchema, IngestionRunIdSchema, SourceKeySchema, SummarySchema } from './schemas';
import { compareCivilDates, requireAdapterInstant } from './timestamps';

const requireChronology = (runId: string, startedAt: Date, completedAt: string): void => {
  const startedAtInstant = requireAdapterInstant(startedAt.toISOString(), 'startedAt');
  const completedAtInstant = requireAdapterInstant(completedAt, 'completedAt');
  if (compareInstants(completedAtInstant, startedAtInstant) < 0) {
    throw new RunChronologyError(`completedAt é anterior a startedAt para run ${runId}: cronologia impossível`);
  }
};

const isUniqueViolationOn = (error: unknown, target: string): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError
  && error.code === 'P2002'
  && Array.isArray(error.meta?.target)
  && (error.meta.target as unknown[]).some((t) => String(t).includes(target));

interface ResolvedFiling {
  readonly id: string;
  readonly issuerId: string;
  readonly documentType: string;
  readonly cvmProtocol: string;
  readonly referenceDate: string;
  readonly fiscalYear: number;
  readonly fiscalQuarter: number | null;
  readonly filedAt: Date;
  readonly publishedAt: Date;
  readonly versionNumber: number;
  readonly isRestatement: boolean;
  readonly supersedesFilingId: string | null;
  readonly sourceUrl: string;
  readonly rawSha256: string;
}

/**
 * Prisma implementation of CvmIngestionUnitOfWork. Holds the only write
 * path into CvmFiling/CvmFact/ShareCapitalFact; read repositories in
 * this directory never mutate these tables. The CVM batch never creates
 * an Issuer — every issuerCvmCode referenced must already exist.
 */
export class PrismaCvmIngestionUnitOfWork implements CvmIngestionUnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}

  async begin(sourceKey: IngestionSourceKey, startedAt: string): Promise<IngestionRunId> {
    const normalizedSourceKey = SourceKeySchema.parse(sourceKey);
    requireAdapterInstant(startedAt, 'startedAt');
    const run = await this.prisma.ingestionRun.create({
      data: {
        sourceKey: normalizedSourceKey,
        status: 'RUNNING',
        startedAt: new Date(startedAt),
        completedAt: null,
        summary: null,
      },
    });
    return run.id;
  }

  async fail(runId: IngestionRunId, completedAt: string, summary: string): Promise<void> {
    const normalizedRunId = IngestionRunIdSchema.parse(runId);
    requireAdapterInstant(completedAt, 'completedAt');
    const normalizedSummary = SummarySchema.parse(summary);
    await this.prisma.$transaction(async (tx) => {
      const run = await tx.ingestionRun.findUnique({ where: { id: normalizedRunId } });
      if (!run) throw new RunNotFoundError(`run ${normalizedRunId} não encontrada`);
      if (run.status !== 'RUNNING') {
        throw new RunNotRunningError(`run ${normalizedRunId} não está RUNNING (status atual: ${run.status})`);
      }
      requireChronology(normalizedRunId, run.startedAt, completedAt);
      const transitioned = await tx.ingestionRun.updateMany({
        where: { id: normalizedRunId, status: 'RUNNING' },
        data: { status: 'FAILED', completedAt: new Date(completedAt), summary: normalizedSummary },
      });
      if (transitioned.count !== 1) {
        throw new RunNotRunningError(`run ${normalizedRunId} perdeu a transição RUNNING → FAILED`);
      }
    });
  }

  async commit(runId: IngestionRunId, completedAt: string, summary: string, batch: CvmIngestionBatch): Promise<void> {
    const normalizedRunId = IngestionRunIdSchema.parse(runId);
    const completedAtInstant = requireAdapterInstant(completedAt, 'completedAt');
    const normalizedSummary = SummarySchema.parse(summary);
    const parsed = CvmIngestionBatchSchema.parse(batch);

    await this.prisma.$transaction(async (tx) => {
      const run = await tx.ingestionRun.findUnique({ where: { id: normalizedRunId } });
      if (!run) throw new RunNotFoundError(`run ${normalizedRunId} não encontrada`);
      if (run.status !== 'RUNNING') {
        throw new RunNotRunningError(`run ${runId} não está RUNNING (status atual: ${run.status})`);
      }
      requireChronology(normalizedRunId, run.startedAt, completedAt);

      const issuerIdByCvmCode = new Map<string, string>();
      const resolveIssuerId = async (cvmCode: string): Promise<string> => {
        const cached = issuerIdByCvmCode.get(cvmCode);
        if (cached) return cached;
        const existing = await tx.issuer.findUnique({ where: { cvmCode } });
        if (!existing) {
          throw new UnknownIssuerReferenceError(
            `emissor cvmCode=${cvmCode} não existe; o lote CVM nunca cria Issuer`,
          );
        }
        issuerIdByCvmCode.set(cvmCode, existing.id);
        return existing.id;
      };

      // Canonical order: issuerCvmCode, documentType, referenceDate is not
      // enough on its own (issuerId not yet resolved) — resolve issuers
      // first, then sort by (issuerId, documentType, referenceDate, batch
      // position) so predecessors are always processed before successors
      // that reference them by protocol within the same batch, and so the
      // batch's outcome never depends on input array order.
      const filingsWithIssuer = await Promise.all(
        parsed.filings.map(async (submission) => ({
          submission,
          issuerId: await resolveIssuerId(submission.issuerCvmCode),
        })),
      );
      const filingByProtocol = new Map<string, (typeof filingsWithIssuer)[number]>();
      for (const item of filingsWithIssuer) {
        if (filingByProtocol.has(item.submission.cvmProtocol)) {
          throw new FilingProtocolConflictError(`cvmProtocol=${item.submission.cvmProtocol} aparece mais de uma vez no mesmo lote`);
        }
        filingByProtocol.set(item.submission.cvmProtocol, item);
      }
      const depthByProtocol = new Map<string, number>();
      const visiting = new Set<string>();
      const inBatchDepth = (item: (typeof filingsWithIssuer)[number]): number => {
        const protocol = item.submission.cvmProtocol;
        const cached = depthByProtocol.get(protocol);
        if (cached !== undefined) return cached;
        if (visiting.has(protocol)) {
          throw new FilingChainViolationError(`ciclo de retificação detectado no lote em cvmProtocol=${protocol}`);
        }
        visiting.add(protocol);
        let depth = 0;
        if (item.submission.isRestatement && item.submission.supersedesCvmProtocol) {
          const predecessorInBatch = filingByProtocol.get(item.submission.supersedesCvmProtocol);
          depth = predecessorInBatch ? inBatchDepth(predecessorInBatch) + 1 : 1;
        }
        visiting.delete(protocol);
        depthByProtocol.set(protocol, depth);
        return depth;
      };

      const orderedFilings = [...filingsWithIssuer].sort((a, b) => {
        if (a.issuerId !== b.issuerId) return a.issuerId < b.issuerId ? -1 : 1;
        if (a.submission.documentType !== b.submission.documentType) {
          return a.submission.documentType < b.submission.documentType ? -1 : 1;
        }
        if (a.submission.referenceDate !== b.submission.referenceDate) {
          return compareCivilDates(a.submission.referenceDate, b.submission.referenceDate);
        }
        const depthDifference = inBatchDepth(a) - inBatchDepth(b);
        if (depthDifference !== 0) return depthDifference;
        return a.submission.cvmProtocol < b.submission.cvmProtocol ? -1 : a.submission.cvmProtocol > b.submission.cvmProtocol ? 1 : 0;
      });

      const filingIdByProtocol = new Map<string, string>();

      const resolveFiling = async (cvmProtocol: string): Promise<ResolvedFiling | null> => {
        const row = await tx.cvmFiling.findUnique({ where: { cvmProtocol } });
        return row
          ? {
              id: row.id,
              issuerId: row.issuerId,
              documentType: row.documentType,
              cvmProtocol: row.cvmProtocol,
              referenceDate: row.referenceDate,
              fiscalYear: row.fiscalYear,
              fiscalQuarter: row.fiscalQuarter,
              filedAt: row.filedAt,
              publishedAt: row.publishedAt,
              versionNumber: row.versionNumber,
              isRestatement: row.isRestatement,
              supersedesFilingId: row.supersedesFilingId,
              sourceUrl: row.sourceUrl,
              rawSha256: row.rawSha256,
            }
          : null;
      };

      for (const { submission, issuerId } of orderedFilings) {
        const filedAtInstant = requireAdapterInstant(submission.filedAt, 'filedAt');
        const publishedAtInstant = requireAdapterInstant(submission.publishedAt, 'publishedAt');
        if (compareInstants(filedAtInstant, publishedAtInstant) > 0) {
          throw new InvalidCvmInputError(
            `filing ${submission.cvmProtocol}: filedAt deve ser <= publishedAt`,
            ['filedAt', 'publishedAt'],
          );
        }
        if (compareInstants(publishedAtInstant, completedAtInstant) > 0) {
          throw new InvalidCvmInputError(
            `filing ${submission.cvmProtocol}: publishedAt não pode ser posterior ao completedAt da ingestão`,
            ['publishedAt', 'completedAt'],
          );
        }

        const existing = await resolveFiling(submission.cvmProtocol);
        if (existing) {
          let predecessorId: string | null = null;
          let expectedVersionNumber = 1;
          if (submission.isRestatement && submission.supersedesCvmProtocol) {
            const predecessor = await resolveFiling(submission.supersedesCvmProtocol);
            predecessorId = predecessor?.id ?? null;
            expectedVersionNumber = predecessor ? predecessor.versionNumber + 1 : -1;
          }
          const identical =
            existing.issuerId === issuerId
            && existing.documentType === submission.documentType
            && existing.referenceDate === submission.referenceDate
            && existing.fiscalYear === submission.fiscalYear
            && (existing.fiscalQuarter ?? null) === (submission.fiscalQuarter ?? null)
            && existing.filedAt.toISOString() === new Date(submission.filedAt).toISOString()
            && existing.publishedAt.toISOString() === new Date(submission.publishedAt).toISOString()
            && existing.versionNumber === expectedVersionNumber
            && existing.isRestatement === submission.isRestatement
            && existing.supersedesFilingId === predecessorId
            && existing.sourceUrl === submission.sourceUrl
            && existing.rawSha256 === submission.rawSha256;
          if (!identical) {
            throw new FilingProtocolConflictError(
              `cvmProtocol=${submission.cvmProtocol} já existe com conteúdo/metadados divergentes; reenvio idempotente exige identidade total`,
            );
          }
          filingIdByProtocol.set(submission.cvmProtocol, existing.id);
          continue;
        }

        let versionNumber: number;
        let supersedesFilingId: string | null;

        if (submission.isRestatement) {
          const predecessorProtocol = submission.supersedesCvmProtocol as string;
          const predecessor = await resolveFiling(predecessorProtocol);
          if (!predecessor) {
            throw new UnknownPredecessorFilingError(
              `retificação ${submission.cvmProtocol}: predecessor cvmProtocol=${predecessorProtocol} não existe`,
            );
          }
          if (
            predecessor.issuerId !== issuerId
            || predecessor.documentType !== submission.documentType
            || predecessor.referenceDate !== submission.referenceDate
          ) {
            throw new FilingChainViolationError(
              `retificação ${submission.cvmProtocol}: predecessor não compartilha issuer/documentType/referenceDate`,
            );
          }
          if (compareInstants(publishedAtInstant, requireAdapterInstant(predecessor.publishedAt.toISOString(), 'publishedAt predecessor')) <= 0) {
            throw new FilingChainViolationError(
              `retificação ${submission.cvmProtocol}: publishedAt deve ser estritamente posterior ao predecessor`,
            );
          }
          const alreadySuperseded = await tx.cvmFiling.findFirst({ where: { supersedesFilingId: predecessor.id } });
          if (alreadySuperseded) {
            throw new PredecessorAlreadySupersededError(
              `retificação ${submission.cvmProtocol}: predecessor cvmProtocol=${predecessorProtocol} já foi supersedido por outro documento`,
            );
          }
          versionNumber = predecessor.versionNumber + 1;
          supersedesFilingId = predecessor.id;
        } else {
          const existingChainHead = await tx.cvmFiling.findFirst({
            where: { issuerId, documentType: submission.documentType, referenceDate: submission.referenceDate },
          });
          if (existingChainHead) {
            throw new FilingChainViolationError(
              `filing ${submission.cvmProtocol}: já existe uma cadeia para issuer/documentType/referenceDate; envie como retificação`,
            );
          }
          versionNumber = 1;
          supersedesFilingId = null;
        }

        try {
          const created = await tx.cvmFiling.create({
            data: {
              issuerId,
              documentType: submission.documentType,
              cvmProtocol: submission.cvmProtocol,
              referenceDate: submission.referenceDate,
              fiscalYear: submission.fiscalYear,
              fiscalQuarter: submission.fiscalQuarter ?? null,
              filedAt: new Date(submission.filedAt),
              publishedAt: new Date(submission.publishedAt),
              versionNumber,
              isRestatement: submission.isRestatement,
              supersedesFilingId,
              sourceUrl: submission.sourceUrl,
              rawSha256: submission.rawSha256,
              createdByRunId: runId,
            },
          });
          filingIdByProtocol.set(submission.cvmProtocol, created.id);
        } catch (error) {
          if (isUniqueViolationOn(error, 'cvmProtocol')) {
            throw new FilingProtocolConflictError(`cvmProtocol=${submission.cvmProtocol} colidiu na escrita (concorrência)`);
          }
          if (isUniqueViolationOn(error, 'supersedesFilingId')) {
            throw new PredecessorAlreadySupersededError(
              `retificação ${submission.cvmProtocol}: predecessor foi supersedido por outra transação concorrente`,
            );
          }
          if (isUniqueViolationOn(error, 'versionNumber')) {
            throw new FilingChainViolationError(
              `filing ${submission.cvmProtocol}: versão da cadeia colidiu com outra transação concorrente`,
            );
          }
          throw error;
        }
      }

      const resolveFilingReference = async (
        cvmProtocol: string,
      ): Promise<{ filingId: string; issuerId: string }> => {
        const cachedId = filingIdByProtocol.get(cvmProtocol);
        if (cachedId) {
          const row = await tx.cvmFiling.findUnique({ where: { id: cachedId } });
          if (!row) throw new UnknownFilingReferenceError(`filingCvmProtocol=${cvmProtocol} não resolvido`);
          return { filingId: row.id, issuerId: row.issuerId };
        }
        const row = await tx.cvmFiling.findUnique({ where: { cvmProtocol } });
        if (!row) {
          throw new UnknownFilingReferenceError(`filingCvmProtocol=${cvmProtocol} não existe no lote nem no banco`);
        }
        filingIdByProtocol.set(cvmProtocol, row.id);
        return { filingId: row.id, issuerId: row.issuerId };
      };

      const orderedFacts = [...parsed.facts].sort((a, b) => {
        if (a.filingCvmProtocol !== b.filingCvmProtocol) return a.filingCvmProtocol < b.filingCvmProtocol ? -1 : 1;
        if (a.statementType !== b.statementType) return a.statementType < b.statementType ? -1 : 1;
        if (a.scope !== b.scope) return a.scope < b.scope ? -1 : 1;
        if (a.accountCode !== b.accountCode) return a.accountCode < b.accountCode ? -1 : 1;
        if (a.periodStart !== b.periodStart) return compareCivilDates(a.periodStart, b.periodStart);
        return compareCivilDates(a.periodEnd, b.periodEnd);
      });

      const factKeysInBatch = new Set<string>();
      for (const fact of orderedFacts) {
        const batchKey = [fact.filingCvmProtocol, fact.statementType, fact.scope, fact.accountCode, fact.periodStart, fact.periodEnd].join('|');
        if (factKeysInBatch.has(batchKey)) {
          throw new DuplicateFactError(`fato duplicado dentro do mesmo lote: ${batchKey}`);
        }
        factKeysInBatch.add(batchKey);
      }

      for (const fact of orderedFacts) {
        const { filingId, issuerId } = await resolveFilingReference(fact.filingCvmProtocol);
        const existingFact = await tx.cvmFact.findUnique({
          where: {
            filingId_statementType_scope_accountCode_periodStart_periodEnd: {
              filingId,
              statementType: fact.statementType,
              scope: fact.scope,
              accountCode: fact.accountCode,
              periodStart: fact.periodStart,
              periodEnd: fact.periodEnd,
            },
          },
        });
        if (existingFact) {
          const identical = existingFact.issuerId === issuerId
            && existingFact.accountLabel === fact.accountLabel
            && existingFact.durationType === fact.durationType
            && existingFact.valueRaw === fact.valueRaw
            && existingFact.scalePow === fact.scalePow
            && existingFact.originalScale === fact.originalScale
            && existingFact.currency === fact.currency
            && existingFact.quality === fact.quality;
          if (!identical) {
            throw new DuplicateFactError(
              `fato com mesma chave e conteúdo divergente: filing=${fact.filingCvmProtocol} statementType=${fact.statementType} scope=${fact.scope} accountCode=${fact.accountCode} periodStart=${fact.periodStart} periodEnd=${fact.periodEnd}`,
            );
          }
          continue;
        }
        try {
          await tx.cvmFact.create({
            data: {
              filingId,
              issuerId,
              statementType: fact.statementType,
              scope: fact.scope,
              accountCode: fact.accountCode,
              accountLabel: fact.accountLabel,
              periodStart: fact.periodStart,
              periodEnd: fact.periodEnd,
              durationType: fact.durationType,
              valueRaw: fact.valueRaw,
              scalePow: fact.scalePow,
              originalScale: fact.originalScale,
              currency: fact.currency,
              quality: fact.quality,
              createdByRunId: runId,
            },
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError
            && error.code === 'P2002'
          ) {
            throw new DuplicateFactError(
              `fato duplicado: filing=${fact.filingCvmProtocol} statementType=${fact.statementType} scope=${fact.scope} accountCode=${fact.accountCode} periodStart=${fact.periodStart} periodEnd=${fact.periodEnd}`,
            );
          }
          throw error;
        }
      }

      const orderedShareCapitalFacts = [...parsed.shareCapitalFacts].sort((a, b) => {
        if (a.filingCvmProtocol !== b.filingCvmProtocol) return a.filingCvmProtocol < b.filingCvmProtocol ? -1 : 1;
        if (a.shareClass !== b.shareClass) return a.shareClass < b.shareClass ? -1 : 1;
        if (a.periodEnd !== b.periodEnd) return compareCivilDates(a.periodEnd, b.periodEnd);
        return a.quantityType < b.quantityType ? -1 : a.quantityType > b.quantityType ? 1 : 0;
      });

      const shareCapitalKeysInBatch = new Set<string>();
      for (const scf of orderedShareCapitalFacts) {
        const batchKey = [scf.filingCvmProtocol, scf.shareClass, scf.periodEnd, scf.quantityType].join('|');
        if (shareCapitalKeysInBatch.has(batchKey)) {
          throw new DuplicateShareCapitalFactError(`capital social duplicado dentro do mesmo lote: ${batchKey}`);
        }
        shareCapitalKeysInBatch.add(batchKey);
      }

      for (const scf of orderedShareCapitalFacts) {
        const { filingId, issuerId } = await resolveFilingReference(scf.filingCvmProtocol);
        const existingShareCapital = await tx.shareCapitalFact.findUnique({
          where: {
            filingId_shareClass_periodEnd_quantityType: {
              filingId,
              shareClass: scf.shareClass,
              periodEnd: scf.periodEnd,
              quantityType: scf.quantityType,
            },
          },
        });
        if (existingShareCapital) {
          const identical = existingShareCapital.issuerId === issuerId
            && existingShareCapital.periodStart === scf.periodStart
            && existingShareCapital.quantity === scf.quantity
            && existingShareCapital.quality === scf.quality;
          if (!identical) {
            throw new DuplicateShareCapitalFactError(
              `capital social com mesma chave e conteúdo divergente: filing=${scf.filingCvmProtocol} shareClass=${scf.shareClass} periodEnd=${scf.periodEnd} quantityType=${scf.quantityType}`,
            );
          }
          continue;
        }
        try {
          await tx.shareCapitalFact.create({
            data: {
              filingId,
              issuerId,
              shareClass: scf.shareClass,
              periodStart: scf.periodStart,
              periodEnd: scf.periodEnd,
              quantity: scf.quantity,
              quantityType: scf.quantityType,
              quality: scf.quality,
              createdByRunId: runId,
            },
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError
            && error.code === 'P2002'
          ) {
            throw new DuplicateShareCapitalFactError(
              `capital social duplicado: filing=${scf.filingCvmProtocol} shareClass=${scf.shareClass} periodEnd=${scf.periodEnd} quantityType=${scf.quantityType}`,
            );
          }
          throw error;
        }
      }

      const transitioned = await tx.ingestionRun.updateMany({
        where: { id: normalizedRunId, status: 'RUNNING' },
        data: { status: 'SUCCEEDED', completedAt: new Date(completedAt), summary: normalizedSummary },
      });
      if (transitioned.count !== 1) {
        throw new RunNotRunningError(`run ${normalizedRunId} perdeu a transição RUNNING → SUCCEEDED`);
      }
    });
  }
}
