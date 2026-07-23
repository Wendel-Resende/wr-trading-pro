import { z } from 'zod';
import { createHttpMlApiPort, MlHybridService } from '../../../../../application/ml-hybrid';
import { ReadModelError } from '../../../../../application/read-models-v1';
import { prisma } from '../../../../../lib/prisma';
import { jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';
import { toPredictLivePublicDTO } from './_dto';

export const dynamic = 'force-dynamic';

const BodySchema = z
  .object({
    symbol: z
      .string()
      .min(1)
      .max(20)
      .transform((s) => s.trim().toUpperCase()),
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
    const service = new MlHybridService({ mlApi, prisma });
    const result = await service.predictLive(body.symbol);

    return jsonSuccess(toPredictLivePublicDTO(result), {}, 201);
  } catch (error) {
    return jsonError(error);
  }
}
