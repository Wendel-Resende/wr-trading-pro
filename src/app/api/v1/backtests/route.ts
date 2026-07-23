import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { createBacktestRunService } from '../../../../application/backtest-run';
import { BacktestCostsSchema, EntryRuleSchema, TimestampSchema } from '../../../../adapters/prisma/backtest-run';
import { SignalDirectionSchema } from '../../../../adapters/prisma/signal';
import { TimeframeSchema } from '../../../../adapters/prisma/market-bar/schemas';
import { extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../_shared/http';
import { ReadModelError } from '../../../../application/read-models-v1';
import { toBacktestRunPublicDTO } from './_dto';

export const dynamic = 'force-dynamic';

const BacktestBarSchema = z
  .object({
    time: TimestampSchema,
    open: z.number().finite(),
    high: z.number().finite(),
    low: z.number().finite(),
    close: z.number().finite(),
    knowledgeTime: TimestampSchema,
  })
  .strict();

const BacktestSignalSchema = z
  .object({
    barTime: TimestampSchema,
    direction: SignalDirectionSchema,
    knowledgeTime: TimestampSchema,
    stopPrice: z.number().finite().nullish(),
    takeProfitPrice: z.number().finite().nullish(),
  })
  .strict();

const BodySchema = z
  .object({
    researchRunId: z.string().min(1).max(64),
    modelVersionId: z.string().min(1).max(64),
    instrumentId: z.string().min(1).max(200),
    timeframe: TimeframeSchema,
    entryRule: EntryRuleSchema,
    costs: BacktestCostsSchema,
    windowStart: TimestampSchema,
    windowEnd: TimestampSchema,
    embargoDays: z.number().int().min(0).max(3650),
    bars: z.array(BacktestBarSchema).min(1).max(20_000),
    signals: z.array(BacktestSignalSchema).max(20_000),
  })
  .strict();

async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ReadModelError('INVALID_BODY', 'corpo da requisição não é um JSON válido');
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const raw = await parseBody(request);
    const body = parseWithSchema(BodySchema, raw);

    const service = createBacktestRunService(prisma);
    const run = await service.run(
      {
        researchRunId: body.researchRunId,
        modelVersionId: body.modelVersionId,
        instrumentId: body.instrumentId,
        entryRule: body.entryRule,
        costs: body.costs,
        windowStart: body.windowStart,
        windowEnd: body.windowEnd,
        embargoDays: body.embargoDays,
        bars: body.bars,
        signals: body.signals,
      },
      body.timeframe,
    );

    return jsonSuccess(run, {}, 201);
  } catch (error) {
    return jsonError(error);
  }
}

const ListQuerySchema = z
  .object({
    modelVersionId: z.string().min(1).max(64),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(64).optional(),
  })
  .strict();

/**
 * Bloqueador 3 (revisão final do Guardião): paginação server-side estável
 * (`limit+1`/cursor, ordenação `createdAt desc, backtestId desc`) — o
 * cliente nunca mais recebe a coleção inteira de uma vez.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const raw = extractStrictQuery(request, ['modelVersionId', 'limit', 'cursor'] as const);
    const query = parseWithSchema(ListQuerySchema, raw);

    const service = createBacktestRunService(prisma);
    const limit = query.limit ?? 20;
    const runs = await service.listByModelVersion(query.modelVersionId, limit + 1, query.cursor);

    const hasNext = runs.length > limit;
    const page = hasNext ? runs.slice(0, limit) : runs;
    const nextCursor = hasNext ? page[page.length - 1].backtestId : null;

    // Achado médio 8: DTO resumido — nunca `trades`/`entryRule`/`embargoDays`/
    // `costs` bruto/`provenance.foldsCovered` na listagem pública.
    return jsonSuccess(page.map(toBacktestRunPublicDTO), { count: page.length, nextCursor });
  } catch (error) {
    return jsonError(error);
  }
}
