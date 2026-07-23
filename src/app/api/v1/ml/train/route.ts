import { z } from 'zod';
import { createBacktestCostProfileService } from '../../../../../application/backtest-cost-profile';
import { createHttpMlTrainJobPort, createMlTrainingRunService, ensureReconciledOnce, scheduleTrainingRun, toMlTrainingRunPublicDTO } from '../../../../../application/ml-training-run';
import { ReadModelError } from '../../../../../application/read-models-v1';
import { prisma } from '../../../../../lib/prisma';
import { jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';
import { resolveRequestedBy } from '../../agent-runs/_requested-by';

export const dynamic = 'force-dynamic';

/**
 * Item C (spec §7): rota legada. A UI NUNCA mais chama este endpoint —
 * usa `POST /api/v1/ml/training-runs`. Mantido apenas para compatibilidade
 * de qualquer integrador externo remanescente: em vez de bloquear a
 * requisição por até 600000ms (o bug documentado na spec — o Flask
 * continuava computando um treino órfão depois do abort do Node), este
 * endpoint agora delega ao mesmo fluxo assíncrono/persistido e responde
 * 202 imediatamente com o `trainingRunId` para acompanhamento via
 * `GET /api/v1/ml/training-runs/{id}`. Nunca mais volta ao bloqueio
 * síncrono órfão.
 */
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
      .transform((syms) => (syms ? Array.from(new Set(syms)) : syms)),
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

function mlApiBaseUrl(): string {
  return process.env.WR_ML_API_URL ?? 'http://127.0.0.1:5560';
}

/**
 * Bloqueador 4 (revisão Guardião): a rota legada também precisa reconciliar
 * antes de aceitar um novo pedido — sem isso, um restart do Node deixaria
 * runs anteriores presos em `RUNNING` mesmo quando acessados só por aqui.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await ensureReconciledOnce({ prisma, trainJobPort: createHttpMlTrainJobPort(mlApiBaseUrl()), mlApiBaseUrl: mlApiBaseUrl() });
    const raw = await parseBody(request);
    const body = parseWithSchema(BodySchema, raw);
    const requestedBy = await resolveRequestedBy(request);

    const costProfileService = createBacktestCostProfileService(prisma);
    const costProfile = await costProfileService.resolveActiveForTraining(body.costProfileId);

    const service = createMlTrainingRunService(prisma);
    const run = await service.requestTraining(requestedBy, costProfile.id, costProfile.version, body.symbols ?? null);

    scheduleTrainingRun(run.trainingRunId, {
      prisma,
      trainJobPort: createHttpMlTrainJobPort(mlApiBaseUrl()),
      mlApiBaseUrl: mlApiBaseUrl(),
    });

    return jsonSuccess(
      {
        deprecated: true,
        message: 'POST /api/v1/ml/train está depreciado — use POST /api/v1/ml/training-runs e acompanhe via GET /api/v1/ml/training-runs/{id}.',
        ...toMlTrainingRunPublicDTO(run),
      },
      {},
      202,
    );
  } catch (error) {
    return jsonError(error);
  }
}
