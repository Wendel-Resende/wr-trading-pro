import { z } from 'zod';
import { createHttpMlApiPort, MlHybridService } from '../../../../../application/ml-hybrid';
import { ReadModelError } from '../../../../../application/read-models-v1';
import { prisma } from '../../../../../lib/prisma';
import { jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';
import { resolveRequestedBy } from '../../agent-runs/_requested-by';

export const dynamic = 'force-dynamic';

// G-003 item 1: mesmo formato de ticker validado no Flask (`ml_api.py::_TICKER_RE`)
// — nunca confiar só na validação do lado Python, já que os símbolos aceitos
// aqui compõem diretamente o path do snapshot rio abaixo.
const TICKER_RE = /^[A-Z]{4}\d{1,2}$/;

const BodySchema = z
  .object({
    symbols: z
      .array(
        z
          .string()
          .min(1)
          .max(20)
          .transform((s) => s.trim().toUpperCase())
          .refine((s) => TICKER_RE.test(s), { message: 'ticker fora do formato B3 (4 letras + 1-2 dígitos)' }),
      )
      .min(1)
      .max(200)
      .optional()
      // G-003 item 1: deduplica preservando a primeira ocorrência — mesmo
      // contrato de `ml_api.py::symbols_from` no lado Flask.
      .transform((syms) => (syms ? Array.from(new Set(syms)) : syms)),
    // Item A / D5: obrigatório — nenhum custo default é aceito no fluxo de backtest real.
    costProfileId: z.string().min(1).max(64),
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

    const mlApi = createHttpMlApiPort(process.env.WR_ML_API_URL ?? 'http://127.0.0.1:5560');
    const service = new MlHybridService({ mlApi, prisma });
    const result = await service.runTraining(createdBy, body.costProfileId, body.symbols);

    return jsonSuccess(result, {}, 201);
  } catch (error) {
    return jsonError(error);
  }
}
