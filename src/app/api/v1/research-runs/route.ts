import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { createResearchRunService } from '../../../../application/research-run';
import { TimestampSchema } from '../../../../adapters/prisma/research-run';
import { jsonError, jsonSuccess, parseWithSchema } from '../_shared/http';
import { ReadModelError } from '../../../../application/read-models-v1';
import { resolveRequestedBy } from '../agent-runs/_requested-by';

export const dynamic = 'force-dynamic';

const BodySchema = z
  .object({
    name: z.string().min(1).max(200),
    hypothesis: z.string().min(1).max(5000),
    datasetId: z.string().min(1).max(200),
    windowStart: TimestampSchema,
    windowEnd: TimestampSchema,
    paramsJson: z.string().min(1).max(20_000),
    modelVersionId: z.string().min(1).max(64).nullish(),
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
    const createdBy = await resolveRequestedBy(request);

    const service = createResearchRunService(prisma);
    const run = await service.submit(body, createdBy);

    return jsonSuccess(run, {}, 201);
  } catch (error) {
    return jsonError(error);
  }
}

const ListQuerySchema = z.object({ datasetId: z.string().min(1).max(200) }).strict();

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const allowedKeys = ['datasetId'] as const;
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

    const service = createResearchRunService(prisma);
    const runs = await service.listByDataset(query.datasetId);
    return jsonSuccess(runs, { count: runs.length });
  } catch (error) {
    return jsonError(error);
  }
}
