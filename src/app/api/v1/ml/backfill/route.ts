import { z } from 'zod';
import { createHttpMlApiPort } from '../../../../../application/ml-hybrid';
import { ReadModelError } from '../../../../../application/read-models-v1';
import { jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';

export const dynamic = 'force-dynamic';

const BodySchema = z
  .object({
    symbols: z
      .array(z.string().min(1).max(20).transform((s) => s.trim().toUpperCase()))
      .min(1)
      .max(200)
      .optional(),
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

    const mlApi = createHttpMlApiPort(process.env.WR_ML_API_URL ?? 'http://127.0.0.1:5560');
    const result = await mlApi.backfill(body.symbols);

    return jsonSuccess(result);
  } catch (error) {
    return jsonError(error);
  }
}
