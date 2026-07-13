import type { PrismaClient } from '@prisma/client';
import type { InstrumentVersion } from '../../../domain/v1/models/instrument-version';
import type { InstrumentAsOfView, InstrumentRepository } from '../../../domain/v1/ports/instrument-repository';
import { compareInstants } from '../../../domain/v1/time';
import { ExchangeSchema, SymbolSchema } from './schemas';
import { requireAdapterInstant as requireInstant } from './timestamps';
import { toInstrumentVersion } from './mapping';

/**
 * Prisma implementation of InstrumentRepository. The bitemporal
 * contract lives entirely here: a row's stored `closedByRun` is only
 * honored (i.e. its `validTo` surfaced) when that closing run itself
 * is SUCCEEDED and completed at or before the requested knowledgeTime.
 * A close registered by a run that finishes later than the queried
 * knowledgeTime never leaks into that earlier view — the interval is
 * reported open instead.
 */
export class PrismaInstrumentRepository implements InstrumentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findInstrumentVersions(
    symbol: string,
    exchange: string,
    view: InstrumentAsOfView,
  ): Promise<readonly InstrumentVersion[]> {
    const normalizedSymbol = SymbolSchema.parse(symbol);
    const normalizedExchange = ExchangeSchema.parse(exchange);
    const knowledgeInstant = requireInstant(view.knowledgeTime, 'knowledgeTime');
    const knowledgeDate = new Date(view.knowledgeTime);
    const asOfInstant = view.asOf !== undefined ? requireInstant(view.asOf, 'asOf') : null;

    const rows = await this.prisma.instrumentVersion.findMany({
      where: {
        symbol: normalizedSymbol,
        exchange: normalizedExchange,
        createdByRun: { is: { status: 'SUCCEEDED', completedAt: { lte: knowledgeDate } } },
      },
      include: { closedByRun: true },
      orderBy: { validFrom: 'asc' },
    });

    const visible = rows.map((row) => {
      const closingRun = row.closedByRun;
      const closeVisible =
        closingRun !== null
        && closingRun.status === 'SUCCEEDED'
        && closingRun.completedAt !== null
        && compareInstants(requireInstant(closingRun.completedAt.toISOString(), 'closedByRun.completedAt'), knowledgeInstant) <= 0;
      return toInstrumentVersion(row, closeVisible ? row.validTo?.toISOString() ?? null : null, closeVisible ? row.closedByRunId : null);
    });

    if (asOfInstant === null) return Object.freeze(visible);

    return Object.freeze(
      visible.filter((version) => {
        const fromInstant = requireInstant(version.validFrom, 'validFrom');
        if (compareInstants(asOfInstant, fromInstant) < 0) return false;
        if (version.validTo === null) return true;
        const toInstant = requireInstant(version.validTo, 'validTo');
        return compareInstants(asOfInstant, toInstant) < 0;
      }),
    );
  }
}
