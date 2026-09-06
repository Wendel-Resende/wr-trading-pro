/**
 * Orquestração das sessões de pesquisa: a camada que lê banco e valida. O
 * cálculo em si vive nos módulos PUROS de domínio, que não conhecem nem
 * Prisma nem Zod.
 */
import type { PrismaClient } from '@prisma/client';
import { PrismaResearchSessionRepository } from '../../adapters/prisma/research-session';
import type { ResearchSessionRepository } from '../../domain/v1/ports/research-session-repository';
import { canTransition } from '../../domain/v1/models/research-session';
import type {
  ResearchSessionKind,
  ResearchSessionPersistedShape,
  ResearchSessionStatus,
} from '../../domain/v1/models/research-session';
import { ruleSignificanceTest } from '../../domain/v1/models/rule-significance';
import { monteCarloTrades } from '../../domain/v1/models/monte-carlo-trades';
import { ReadModelError } from '../read-models-v1/errors';
import { MonteCarloConfigSchema, SignificanceConfigSchema } from './config-schemas';
import type { CreateDraftRequest, ListRequest, ResearchSessionReadModel, UpdateDraftRequest } from './dto';

const MAX_ERROR_SUMMARY = 400;

function parseConfig(kind: ResearchSessionKind, config: unknown): unknown {
  const schema = kind === 'SIGNIFICANCE' ? SignificanceConfigSchema : MonteCarloConfigSchema;
  const parsed = schema.safeParse(config);
  if (!parsed.success) {
    throw new ReadModelError(
      'INVALID_QUERY',
      `config inválida para ${kind}: ` +
        parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`).join('; '),
    );
  }
  return parsed.data;
}

/**
 * Resumo sanitizado: nunca stack trace, path ou mensagem crua do driver —
 * mesmo cuidado já aplicado em `BackfillRun`.
 */
function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'erro desconhecido';
  return raw
    .replace(/[A-Za-z]:\\[^\s]*/g, '<path>')
    .replace(/\/[^\s]*\//g, '<path>')
    .slice(0, MAX_ERROR_SUMMARY);
}

function toReadModel(row: ResearchSessionPersistedShape): ResearchSessionReadModel {
  return {
    sessionId: row.sessionId,
    kind: row.kind as ResearchSessionKind,
    status: row.status as ResearchSessionStatus,
    label: row.label,
    notes: row.notes,
    config: JSON.parse(row.configJson),
    result: row.resultJson === null ? null : JSON.parse(row.resultJson),
    errorSummary: row.errorSummary,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ResearchSessionService {
  constructor(private readonly repository: ResearchSessionRepository) {}

  async createDraft(request: CreateDraftRequest): Promise<ResearchSessionReadModel> {
    const config = parseConfig(request.kind, request.config);
    const row = await this.repository.create({
      kind: request.kind,
      label: request.label,
      notes: request.notes,
      configJson: JSON.stringify(config),
      createdBy: request.createdBy,
    });
    return toReadModel(row);
  }

  async updateDraft(sessionId: string, patch: UpdateDraftRequest): Promise<ResearchSessionReadModel> {
    const existing = await this.repository.findById(sessionId);
    if (existing === null) throw new ReadModelError('RESEARCH_SESSION_NOT_FOUND', 'sessão de pesquisa não encontrada');

    const configJson =
      patch.config === undefined
        ? undefined
        : JSON.stringify(parseConfig(existing.kind as ResearchSessionKind, patch.config));

    const updated = await this.repository.updateDraft(sessionId, {
      ...(patch.label === undefined ? {} : { label: patch.label }),
      ...(patch.notes === undefined ? {} : { notes: patch.notes }),
      ...(configJson === undefined ? {} : { configJson }),
    });
    if (updated === null) {
      throw new ReadModelError('RESEARCH_SESSION_NOT_EDITABLE', `sessão em status ${existing.status} não aceita edição de rascunho`);
    }
    return toReadModel(updated);
  }

  async get(sessionId: string): Promise<ResearchSessionReadModel> {
    const row = await this.repository.findById(sessionId);
    if (row === null) throw new ReadModelError('RESEARCH_SESSION_NOT_FOUND', 'sessão de pesquisa não encontrada');
    return toReadModel(row);
  }

  async list(request: ListRequest): Promise<readonly ResearchSessionReadModel[]> {
    const rows = await this.repository.list(request);
    return rows.map(toReadModel);
  }

  async run(sessionId: string): Promise<ResearchSessionReadModel> {
    const existing = await this.repository.findById(sessionId);
    if (existing === null) throw new ReadModelError('RESEARCH_SESSION_NOT_FOUND', 'sessão de pesquisa não encontrada');

    // Guarda de estado explícita ANTES do claim: dá a mensagem correta
    // ("sessão em status DONE") em vez de deixar o claim falhar mudo. A
    // máquina de estados do domínio é a fonte da regra; o `where` do
    // repositório é o que a torna atômica sob concorrência.
    if (!canTransition(existing.status as ResearchSessionStatus, 'RUNNING')) {
      throw new ReadModelError(
        'RESEARCH_SESSION_ALREADY_RUNNING',
        `sessão em status ${existing.status} não pode ser executada`,
      );
    }

    // CAS: só quem transiciona DRAFT->RUNNING roda. A guarda acima não
    // basta — entre ela e aqui outra chamada pode ter reivindicado a mesma
    // sessão. Uma segunda chamada concorrente perde a corrida e é recusada,
    // em vez de disparar o mesmo processamento duas vezes.
    const claimed = await this.repository.claimForRun(sessionId);
    if (!claimed) {
      throw new ReadModelError('RESEARCH_SESSION_ALREADY_RUNNING', `sessão em status ${existing.status} não pode ser executada`);
    }

    try {
      const kind = existing.kind as ResearchSessionKind;
      const config = parseConfig(kind, JSON.parse(existing.configJson));
      const result =
        kind === 'SIGNIFICANCE'
          ? ruleSignificanceTest(config as Parameters<typeof ruleSignificanceTest>[0])
          : monteCarloTrades(config as Parameters<typeof monteCarloTrades>[0]);

      const finished = await this.repository.finish(sessionId, {
        status: 'DONE',
        resultJson: JSON.stringify(result),
      });
      if (finished === null) throw new ReadModelError('RESEARCH_SESSION_NOT_EDITABLE', 'sessão deixou o estado RUNNING durante a execução');
      return toReadModel(finished);
    } catch (error) {
      const failed = await this.repository.finish(sessionId, {
        status: 'FAILED',
        errorSummary: sanitizeError(error),
      });
      if (failed !== null) return toReadModel(failed);
      throw error;
    }
  }

  async cancel(sessionId: string): Promise<ResearchSessionReadModel> {
    const row = await this.repository.cancel(sessionId);
    if (row === null) throw new ReadModelError('RESEARCH_SESSION_NOT_FOUND', 'sessão de pesquisa não encontrada');
    return toReadModel(row);
  }

  async remove(sessionId: string): Promise<void> {
    const deleted = await this.repository.delete(sessionId);
    if (!deleted) throw new ReadModelError('RESEARCH_SESSION_NOT_FOUND', 'sessão de pesquisa não encontrada');
  }
}

export function createResearchSessionService(prisma: PrismaClient): ResearchSessionService {
  return new ResearchSessionService(new PrismaResearchSessionRepository(prisma));
}
