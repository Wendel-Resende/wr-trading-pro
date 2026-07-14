import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { createModelVersionService } from '../../../../application/model-version';
import { ModelVersionKindSchema, TimestampSchema } from '../../../../adapters/prisma/model-version';
import { jsonError, jsonSuccess, parseWithSchema } from '../_shared/http';
import { ReadModelError } from '../../../../application/read-models-v1';

export const dynamic = 'force-dynamic';

const BodySchema = z
  .object({
    kind: ModelVersionKindSchema,
    label: z.string().min(1).max(200),
    asOf: TimestampSchema,
    hyperparametersJson: z.string().min(1).max(20_000),
    trainingEvidenceJson: z.string().min(1).max(20_000).nullish(),
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

    const service = createModelVersionService(prisma);
    const version = await service.submit(body);

    return jsonSuccess(version, {}, 201);
  } catch (error) {
    return jsonError(error);
  }
}

const ListQuerySchema = z.object({ kind: ModelVersionKindSchema }).strict();

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const allowedKeys = ['kind'] as const;
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

    const service = createModelVersionService(prisma);
    const versions = await service.listByKind(query.kind);
    return jsonSuccess(versions, { count: versions.length });
  } catch (error) {
    return jsonError(error);
  }
}
