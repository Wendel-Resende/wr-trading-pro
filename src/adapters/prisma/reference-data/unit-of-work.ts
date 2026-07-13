import { Prisma, type PrismaClient } from '@prisma/client';
import type { IngestionRunId, IngestionSourceKey } from '../../../domain/v1/models/ingestion';
import type {
  ReferenceDataBatch,
  ReferenceDataIngestionUnitOfWork,
} from '../../../domain/v1/ports/reference-data-ingestion-unit-of-work';
import { compareInstants } from '../../../domain/v1/time';
import {
  DuplicateCnpjError,
  InstrumentIntervalConflictError,
  IssuerIdentityConflictError,
  RunChronologyError,
  RunNotFoundError,
  RunNotRunningError,
  UnknownIssuerReferenceError,
} from './errors';
import { IngestionRunIdSchema, ReferenceDataBatchSchema, SourceKeySchema, SummarySchema } from './schemas';
import { requireAdapterInstant } from './timestamps';

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
  && (error.meta.target as unknown[]).includes(target);

/**
 * Prisma implementation of ReferenceDataIngestionUnitOfWork. Holds the
 * only write path into IngestionRun/Issuer/InstrumentVersion; read
 * repositories in this directory never mutate these tables.
 */
export class PrismaReferenceDataIngestionUnitOfWork implements ReferenceDataIngestionUnitOfWork {
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

  async commit(runId: IngestionRunId, completedAt: string, summary: string, batch: ReferenceDataBatch): Promise<void> {
    const normalizedRunId = IngestionRunIdSchema.parse(runId);
    requireAdapterInstant(completedAt, 'completedAt');
    const normalizedSummary = SummarySchema.parse(summary);
    const parsed = ReferenceDataBatchSchema.parse(batch);

    await this.prisma.$transaction(async (tx) => {
      const run = await tx.ingestionRun.findUnique({ where: { id: normalizedRunId } });
      if (!run) throw new RunNotFoundError(`run ${normalizedRunId} não encontrada`);
      if (run.status !== 'RUNNING') {
        throw new RunNotRunningError(`run ${runId} não está RUNNING (status atual: ${run.status})`);
      }
      requireChronology(normalizedRunId, run.startedAt, completedAt);

      const issuerIdByCvmCode = new Map<string, string>();

      for (const registration of parsed.issuers) {
        const existing = await tx.issuer.findUnique({ where: { cvmCode: registration.cvmCode } });
        if (existing) {
          const sameCnpj = (existing.cnpj ?? null) === (registration.cnpj ?? null);
          const sameName = existing.name === registration.name;
          if (!sameCnpj || !sameName) {
            throw new IssuerIdentityConflictError(
              `emissor cvmCode=${registration.cvmCode} já existe com identidade diferente (cnpj/name não conferem); registro destrutivo (SCD-1) não é permitido`,
            );
          }
          issuerIdByCvmCode.set(registration.cvmCode, existing.id);
          continue;
        }
        try {
          const created = await tx.issuer.create({
            data: {
              cvmCode: registration.cvmCode,
              cnpj: registration.cnpj ?? null,
              name: registration.name,
              createdByRunId: runId,
            },
          });
          issuerIdByCvmCode.set(registration.cvmCode, created.id);
        } catch (error) {
          if (isUniqueViolationOn(error, 'cnpj')) {
            throw new DuplicateCnpjError(`cnpj já está vinculado a outro emissor (cvmCode=${registration.cvmCode})`);
          }
          if (isUniqueViolationOn(error, 'cvmCode')) {
            throw new IssuerIdentityConflictError(`emissor cvmCode=${registration.cvmCode} já existe (conflito de concorrência)`);
          }
          throw error;
        }
      }

      for (const input of parsed.instrumentVersions) {
        if (input.issuerCvmCode && !issuerIdByCvmCode.has(input.issuerCvmCode)) {
          const existing = await tx.issuer.findUnique({ where: { cvmCode: input.issuerCvmCode } });
          if (!existing) {
            throw new UnknownIssuerReferenceError(
              `instrumento ${input.symbol}@${input.exchange} referencia emissor cvmCode=${input.issuerCvmCode} inexistente`,
            );
          }
          issuerIdByCvmCode.set(input.issuerCvmCode, existing.id);
        }
      }

      // Chronological, symbol/exchange-grouped order — independent of the
      // input array's order — so a batch's outcome never depends on how the
      // caller happened to list multiple versions of the same instrument.
      const preparedInstruments = parsed.instrumentVersions.map((input) => {
        const validFromIso = input.validFrom ?? completedAt;
        return { input, validFromIso, validFromInstant: requireAdapterInstant(validFromIso, 'validFrom') };
      });
      const orderedInstruments = [...preparedInstruments].sort((a, b) => {
        if (a.input.symbol !== b.input.symbol) return a.input.symbol < b.input.symbol ? -1 : 1;
        if (a.input.exchange !== b.input.exchange) return a.input.exchange < b.input.exchange ? -1 : 1;
        return compareInstants(a.validFromInstant, b.validFromInstant);
      });

      for (const { input, validFromIso, validFromInstant } of orderedInstruments) {
        const siblings = await tx.instrumentVersion.findMany({
          where: { symbol: input.symbol, exchange: input.exchange },
        });

        const open = siblings.find((sibling) => sibling.validTo === null) ?? null;
        if (open) {
          const openFromInstant = requireAdapterInstant(open.validFrom.toISOString(), 'validFrom existente');
          if (compareInstants(validFromInstant, openFromInstant) <= 0) {
            throw new InstrumentIntervalConflictError(
              `novo validFrom de ${input.symbol}@${input.exchange} deve ser estritamente posterior ao intervalo aberto vigente`,
            );
          }
        }

        for (const sibling of siblings) {
          if (open && sibling.id === open.id) continue;
          if (sibling.validTo === null) continue;
          const siblingFrom = requireAdapterInstant(sibling.validFrom.toISOString(), 'validFrom existente');
          const siblingTo = requireAdapterInstant(sibling.validTo.toISOString(), 'validTo existente');
          if (compareInstants(validFromInstant, siblingFrom) >= 0 && compareInstants(validFromInstant, siblingTo) < 0) {
            throw new InstrumentIntervalConflictError(
              `novo validFrom de ${input.symbol}@${input.exchange} sobrepõe um intervalo já fechado`,
            );
          }
        }

        if (open) {
          await tx.instrumentVersion.update({
            where: { id: open.id },
            data: { validTo: new Date(validFromIso), closedByRunId: runId },
          });
        }

        const issuerId = input.issuerCvmCode ? issuerIdByCvmCode.get(input.issuerCvmCode) ?? null : null;

        try {
          await tx.instrumentVersion.create({
            data: {
              symbol: input.symbol,
              exchange: input.exchange,
              currency: input.currency,
              displayName: input.displayName,
              assetClass: input.assetClass,
              status: input.status,
              priceScalePow: input.priceScalePow ?? null,
              quantityScalePow: input.quantityScalePow ?? null,
              lotSize: input.lotSize ?? null,
              validFrom: new Date(validFromIso),
              validTo: null,
              validFromBasis: input.validFromBasis,
              issuerId,
              createdByRunId: runId,
              closedByRunId: null,
            },
          });
        } catch (error) {
          if (isUniqueViolationOn(error, 'validFrom')) {
            throw new InstrumentIntervalConflictError(
              `já existe uma versão de ${input.symbol}@${input.exchange} com o mesmo validFrom`,
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
