import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { createBacktestRunService } from '../../../../application/backtest-run';
import { BacktestCostsSchema, EntryRuleSchema, TimestampSchema } from '../../../../adapters/prisma/backtest-run';
import { SignalDirectionSchema } from '../../../../adapters/prisma/signal';
import { TimeframeSchema } from '../../../../adapters/prisma/market-bar/schemas';
import { jsonError, jsonSuccess, parseWithSchema } from '../_shared/http';
import { ReadModelError } from '../../../../application/read-models-v1';

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

const ListQuerySchema = z.object({ modelVersionId: z.string().min(1).max(64) }).strict();

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const allowedKeys = ['modelVersionId'] as const;
    const raw: Record<string, string> = {};
    for (const key of url.searchParams.keys()) {
      if (!allowedKeys.includes(key as (typeof allowedKeys)[number])) {
        throw new ReadModelError('INVALID_QUERY', `parâmetro de query desconhecido: ${key}`);
      }
    }
    for (const key of allowedKeys) {
      const value = url.searchParams.get(key);
      if (value !== null) raw[key] = value;
    }
    const query = parseWithSchema(ListQuerySchema, raw);

    const service = createBacktestRunService(prisma);
    const runs = await service.listByModelVersion(query.modelVersionId);
    return jsonSuccess(runs, { count: runs.length });
  } catch (error) {
    return jsonError(error);
  }
}
