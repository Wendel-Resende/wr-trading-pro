import { z } from 'zod';
import { prisma } from '../../../../../lib/prisma';
import {
  createMlTrainingRunService,
  createHttpMlTrainJobPort,
  ensureReconciledOnce,
  scheduleTrainingRun,
  toMlTrainingRunPublicDTO,
} from '../../../../../application/ml-training-run';
import { createBacktestCostProfileService } from '../../../../../application/backtest-cost-profile';
import { ReadModelError } from '../../../../../application/read-models-v1';
import { extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';
import { resolveRequestedBy } from '../../agent-runs/_requested-by';
import { requireKnownPrincipal } from './_authz';
import { isB3Ticker } from '@/lib/b3-ticker';

export const dynamic = 'force-dynamic';

const BodySchema = z
  .object({
    symbols: z
      .array(
        z
          .string()
          .min(1)
          .max(20)
          .transform((s) => s.trim().toUpperCase())
          .refine(isB3Ticker, { message: 'ticker fora do formato B3 (raiz de 4 chars + 1-2 dígitos)' }),
      )
      .min(1)
      .max(200)
      .optional()
      .transform((syms) => (syms ? Array.from(new Set(syms)) : syms)),
    costProfileId: z.string().min(1).max(64),
  })
  .strict();

const ListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(64).optional(),
  })
  .strict();

async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ReadModelError('INVALID_BODY', 'corpo da requisição não é um JSON válido');
  }
}

/**
 * Item C (treino ML assíncrono, persistido e cancelável). Aceita o pedido,
 * valida perfil de custo e símbolos, cria `MlTrainingRun` em `QUEUED` e
 * retorna 202 IMEDIATAMENTE — o worker (`scheduleTrainingRun`) roda fora
 * deste request HTTP. Nunca bloqueia por até 10 minutos como o
 * `/api/v1/ml/train` legado (spec §1/§5).
 */
function mlApiBaseUrl(): string {
  return process.env.WR_ML_API_URL ?? 'http://127.0.0.1:5560';
}

export async function POST(request: Request): Promise<Response> {
  try {
    await ensureReconciledOnce({ prisma, trainJobPort: createHttpMlTrainJobPort(mlApiBaseUrl()), mlApiBaseUrl: mlApiBaseUrl() });
    const raw = await parseBody(request);
    const body = parseWithSchema(BodySchema, raw);
    const requestedBy = requireKnownPrincipal(await resolveRequestedBy(request));

    const costProfileService = createBacktestCostProfileService(prisma);
    const costProfile = await costProfileService.resolveActiveForTraining(body.costProfileId);

    const service = createMlTrainingRunService(prisma);
    const run = await service.requestTraining(requestedBy, costProfile.id, costProfile.version, body.symbols ?? null);

    scheduleTrainingRun(run.trainingRunId, { prisma, trainJobPort: createHttpMlTrainJobPort(mlApiBaseUrl()), mlApiBaseUrl: mlApiBaseUrl() });

    return jsonSuccess(toMlTrainingRunPublicDTO(run), {}, 202);
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Histórico ordenado deterministicamente (`createdAt desc, trainingRunId
 * desc`), paginado por cursor real (spec §7) — inclui `REJECTED`,
 * `FAILED`, `CANCELLED`, `INTERRUPTED` (nunca só os aprovados).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await ensureReconciledOnce({ prisma, trainJobPort: createHttpMlTrainJobPort(mlApiBaseUrl()), mlApiBaseUrl: mlApiBaseUrl() });
    requireKnownPrincipal(await resolveRequestedBy(request));
    const rawQuery = extractStrictQuery(request, ['limit', 'cursor'] as const);
    const query = parseWithSchema(ListQuerySchema, rawQuery);
    const limit = query.limit ?? 20;

    const service = createMlTrainingRunService(prisma);
    const runs = await service.list(limit + 1, query.cursor);
    const hasNext = runs.length > limit;
    const page = hasNext ? runs.slice(0, limit) : runs;
    const nextCursor = hasNext ? page[page.length - 1].trainingRunId : null;

    return jsonSuccess(page.map(toMlTrainingRunPublicDTO), { count: page.length, nextCursor });
  } catch (error) {
    return jsonError(error);
  }
}
