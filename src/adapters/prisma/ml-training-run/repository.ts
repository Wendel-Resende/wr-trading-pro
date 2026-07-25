import type { PrismaClient } from '@prisma/client';
import type {
  MlTrainingRun,
  MlTrainingRunGate,
  MlTrainingRunGateCheck,
  MlTrainingRunMetrics,
  MlTrainingRunPhase,
  MlTrainingRunStatus,
  MlTrainingRunSubmission,
} from '../../../domain/v1/models/ml-training-run';
import { KNOWN_GATE_CHECK_CODES } from '../../../domain/v1/models/ml-training-run';
import type { CreateIfNoneActiveResult, MlTrainingRunRepository, MlTrainingRunUpdate } from '../../../domain/v1/ports/ml-training-run-repository';

const ACTIVE_STATUSES: MlTrainingRunStatus[] = ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'];
const NON_TERMINAL_STATUSES: MlTrainingRunStatus[] = ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'];

interface MlTrainingRunRow {
  trainingRunId: string;
  requestedBy: string;
  costProfileId: string;
  costProfileVersion: number;
  symbolsJson: string;
  status: string;
  phase: string;
  progress: number;
  pythonJobId: string | null;
  researchRunId: string | null;
  modelVersionId: string | null;
  gateJson: string | null;
  metricsJson: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelRequestedAt: Date | null;
}

function parseSymbols(json: string): readonly string[] | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed === null) return null;
    if (!Array.isArray(parsed)) return null;
    return Object.freeze(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return null;
  }
}

function parseGate(json: string | null): MlTrainingRunGate | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { approved?: unknown; checks?: unknown };
    if (typeof parsed.approved !== 'boolean' || !Array.isArray(parsed.checks)) return null;
    const checks: MlTrainingRunGateCheck[] = parsed.checks
      .filter((c): c is { code: unknown; label: unknown; threshold: unknown; observed: unknown; passed: unknown } => typeof c === 'object' && c !== null)
      .filter(
        (c) =>
          typeof c.code === 'string' &&
          KNOWN_GATE_CHECK_CODES.has(c.code) &&
          typeof c.label === 'string' &&
          typeof c.threshold === 'number' &&
          (c.observed === null || typeof c.observed === 'number') &&
          typeof c.passed === 'boolean',
      )
      .map((c) => ({
        code: c.code as string,
        label: c.label as string,
        threshold: c.threshold as number,
        observed: (c.observed ?? null) as number | null,
        passed: c.passed as boolean,
      }));
    return { approved: parsed.approved, checks: Object.freeze(checks) };
  } catch {
    return null;
  }
}

function parseMetrics(json: string | null): MlTrainingRunMetrics | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as {
      nSamples?: unknown;
      nHighConfidence?: unknown;
      accuracy?: unknown;
      brier?: unknown;
      coverage?: unknown;
      baselineDelta?: unknown;
    };
    // `accuracy`/`baselineDelta` são legitimamente `null` quando nenhum sinal
    // de alta confiança foi emitido — aceitar null aqui é honesto; converter
    // para 0 fingiria um resultado que não existe.
    const nullableNumber = (v: unknown): v is number | null => v === null || typeof v === 'number';
    if (
      typeof parsed.nSamples !== 'number' ||
      typeof parsed.nHighConfidence !== 'number' ||
      typeof parsed.brier !== 'number' ||
      typeof parsed.coverage !== 'number' ||
      !nullableNumber(parsed.accuracy) ||
      !nullableNumber(parsed.baselineDelta)
    ) {
      return null;
    }
    return {
      nSamples: parsed.nSamples,
      nHighConfidence: parsed.nHighConfidence,
      accuracy: parsed.accuracy ?? null,
      brier: parsed.brier,
      coverage: parsed.coverage,
      baselineDelta: parsed.baselineDelta ?? null,
    };
  } catch {
    return null;
  }
}

const KNOWN_STATUSES = new Set<string>(['QUEUED', 'RUNNING', 'SUCCEEDED', 'REJECTED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'INTERRUPTED']);
const KNOWN_PHASES = new Set<string>(['QUEUED', 'SNAPSHOT', 'DATASET', 'TRAINING', 'GATE', 'BACKTESTS', 'FINALIZING']);

/**
 * Bloqueador 13 (revisão Guardião): leitura ESTRITA do ledger — status/fase
 * fora do enum conhecido, ou progresso fora de 0..100 (inteiro), nunca
 * chegam ao DTO via cast permissivo (`as MlTrainingRunStatus`). Um valor
 * corrompido no banco vira erro explícito aqui, não um estado silenciosamente
 * inventado na camada de leitura.
 */
function assertKnownStatus(status: string): MlTrainingRunStatus {
  if (!KNOWN_STATUSES.has(status)) throw new Error(`MlTrainingRun.status desconhecido no banco: ${status}`);
  return status as MlTrainingRunStatus;
}
function assertKnownPhase(phase: string): MlTrainingRunPhase {
  if (!KNOWN_PHASES.has(phase)) throw new Error(`MlTrainingRun.phase desconhecida no banco: ${phase}`);
  return phase as MlTrainingRunPhase;
}
function assertValidProgress(progress: number): number {
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    throw new Error(`MlTrainingRun.progress fora de 0..100 no banco: ${progress}`);
  }
  return progress;
}

function toModel(row: MlTrainingRunRow): MlTrainingRun {
  return {
    trainingRunId: row.trainingRunId,
    requestedBy: row.requestedBy,
    costProfileId: row.costProfileId,
    costProfileVersion: row.costProfileVersion,
    symbols: parseSymbols(row.symbolsJson),
    status: assertKnownStatus(row.status),
    phase: assertKnownPhase(row.phase),
    progress: assertValidProgress(row.progress),
    pythonJobId: row.pythonJobId,
    researchRunId: row.researchRunId,
    modelVersionId: row.modelVersionId,
    gate: parseGate(row.gateJson),
    metrics: parseMetrics(row.metricsJson),
    errorCode: row.errorCode,
    errorSummary: row.errorSummary,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
  };
}

export class PrismaMlTrainingRunRepository implements MlTrainingRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(submission: MlTrainingRunSubmission): Promise<MlTrainingRun> {
    const row = await this.prisma.mlTrainingRun.create({
      data: {
        requestedBy: submission.requestedBy,
        costProfileId: submission.costProfileId,
        costProfileVersion: submission.costProfileVersion,
        symbolsJson: JSON.stringify(submission.symbols),
        status: 'QUEUED',
        phase: 'QUEUED',
        progress: 0,
      },
    });
    return toModel(row);
  }

  async createIfNoneActive(submission: MlTrainingRunSubmission): Promise<CreateIfNoneActiveResult> {
    return this.prisma.$transaction(async (tx) => {
      const activeRow = await tx.mlTrainingRun.findFirst({
        where: { status: { in: ACTIVE_STATUSES } },
        orderBy: [{ createdAt: 'desc' }],
      });
      if (activeRow) {
        return { outcome: 'CONFLICT', run: toModel(activeRow) } as const;
      }
      const row = await tx.mlTrainingRun.create({
        data: {
          requestedBy: submission.requestedBy,
          costProfileId: submission.costProfileId,
          costProfileVersion: submission.costProfileVersion,
          symbolsJson: JSON.stringify(submission.symbols),
          status: 'QUEUED',
          phase: 'QUEUED',
          progress: 0,
        },
      });
      return { outcome: 'CREATED', run: toModel(row) } as const;
    });
  }

  async findById(trainingRunId: string): Promise<MlTrainingRun | null> {
    const row = await this.prisma.mlTrainingRun.findUnique({ where: { trainingRunId } });
    return row ? toModel(row) : null;
  }

  async findActive(): Promise<MlTrainingRun | null> {
    const row = await this.prisma.mlTrainingRun.findFirst({
      where: { status: { in: ACTIVE_STATUSES } },
      orderBy: [{ createdAt: 'desc' }],
    });
    return row ? toModel(row) : null;
  }

  async list(limit: number, cursor?: string): Promise<readonly MlTrainingRun[]> {
    const rows = await this.prisma.mlTrainingRun.findMany({
      take: limit,
      orderBy: [{ createdAt: 'desc' }, { trainingRunId: 'desc' }],
      ...(cursor ? { cursor: { trainingRunId: cursor }, skip: 1 } : {}),
    });
    return Object.freeze(rows.map(toModel));
  }

  async listNonTerminal(): Promise<readonly MlTrainingRun[]> {
    const rows = await this.prisma.mlTrainingRun.findMany({ where: { status: { in: NON_TERMINAL_STATUSES } } });
    return Object.freeze(rows.map(toModel));
  }

  async cancelIfActive(trainingRunId: string): Promise<MlTrainingRun | null> {
    const { count } = await this.prisma.mlTrainingRun.updateMany({
      where: { trainingRunId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'CANCEL_REQUESTED', cancelRequestedAt: new Date() },
    });
    if (count === 0) return null;
    return this.findById(trainingRunId);
  }

  async update(trainingRunId: string, expectedStatus: MlTrainingRunStatus, patch: MlTrainingRunUpdate): Promise<MlTrainingRun | null> {
    const { count } = await this.prisma.mlTrainingRun.updateMany({
      where: { trainingRunId, status: expectedStatus },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
        ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
        ...(patch.pythonJobId !== undefined ? { pythonJobId: patch.pythonJobId } : {}),
        ...(patch.researchRunId !== undefined ? { researchRunId: patch.researchRunId } : {}),
        ...(patch.modelVersionId !== undefined ? { modelVersionId: patch.modelVersionId } : {}),
        ...(patch.gate !== undefined ? { gateJson: patch.gate === null ? null : JSON.stringify(patch.gate) } : {}),
        ...(patch.metrics !== undefined ? { metricsJson: patch.metrics === null ? null : JSON.stringify(patch.metrics) } : {}),
        ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
        ...(patch.errorSummary !== undefined ? { errorSummary: patch.errorSummary } : {}),
        ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
        ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
        ...(patch.cancelRequestedAt !== undefined ? { cancelRequestedAt: patch.cancelRequestedAt } : {}),
      },
    });
    if (count === 0) return null;
    return this.findById(trainingRunId);
  }
}
