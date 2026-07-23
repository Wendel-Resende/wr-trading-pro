import type { PrismaClient } from '@prisma/client';
import type { BackfillFailureEntry, BackfillRun, BackfillRunSubmission } from '../../../domain/v1/models/backfill-run';
import type { BackfillRunRepository } from '../../../domain/v1/ports/backfill-run-repository';

interface BackfillRunRow {
  backfillRunId: string;
  requestedBy: string;
  createdAt: Date;
  status: string;
  eligibleCount: number;
  updatedCount: number;
  failedCount: number;
  updatedSymbolsJson: string;
  failuresJson: string;
}

function parseStringArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function parseFailures(json: string): BackfillFailureEntry[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is { ticker: unknown; reasonSummary: unknown } => typeof v === 'object' && v !== null)
      .filter((v) => typeof v.ticker === 'string' && typeof v.reasonSummary === 'string')
      .map((v) => ({ ticker: v.ticker as string, reasonSummary: v.reasonSummary as string }));
  } catch {
    return [];
  }
}

function toBackfillRun(row: BackfillRunRow): BackfillRun {
  return {
    backfillRunId: row.backfillRunId,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt.toISOString(),
    status: row.status as BackfillRun['status'],
    eligibleCount: row.eligibleCount,
    updatedCount: row.updatedCount,
    failedCount: row.failedCount,
    updatedSymbols: Object.freeze(parseStringArray(row.updatedSymbolsJson)),
    failures: Object.freeze(parseFailures(row.failuresJson)),
  };
}

export class PrismaBackfillRunRepository implements BackfillRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(submission: BackfillRunSubmission): Promise<BackfillRun> {
    const row = await this.prisma.backfillRun.create({
      data: {
        requestedBy: submission.requestedBy,
        status: submission.status,
        eligibleCount: submission.eligibleCount,
        updatedCount: submission.updatedCount,
        failedCount: submission.failedCount,
        updatedSymbolsJson: JSON.stringify(submission.updatedSymbols),
        failuresJson: JSON.stringify(submission.failures),
      },
    });
    return toBackfillRun(row);
  }

  async findLatest(): Promise<BackfillRun | null> {
    const row = await this.prisma.backfillRun.findFirst({
      orderBy: [{ createdAt: 'desc' }, { backfillRunId: 'desc' }],
    });
    return row ? toBackfillRun(row) : null;
  }
}
