import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { createSignalService } from '../../../../application/signal';
import { SignalDirectionSchema, TimestampSchema } from '../../../../adapters/prisma/signal';
import { jsonError, jsonSuccess, parseWithSchema } from '../_shared/http';
import { ReadModelError } from '../../../../application/read-models-v1';

export const dynamic = 'force-dynamic';

const BodySchema = z
  .object({
    modelVersionId: z.string().min(1).max(64),
    instrumentId: z.string().min(1).max(200),
    barTime: TimestampSchema,
    direction: SignalDirectionSchema,
    score: z.number().finite().nullish(),
    knowledgeTime: TimestampSchema,
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

    const service = createSignalService(prisma);
    const signal = await service.generate(body);

    return jsonSuccess(signal, {}, 201);
  } catch (error) {
    return jsonError(error);
  }
}

const ListQuerySchema = z.object({ instrumentId: z.string().min(1).max(200) }).strict();

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const allowedKeys = ['instrumentId'] as const;
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

    const service = createSignalService(prisma);
    const signals = await service.listByInstrument(query.instrumentId);
    return jsonSuccess(signals, { count: signals.length });
  } catch (error) {
    return jsonError(error);
  }
}
