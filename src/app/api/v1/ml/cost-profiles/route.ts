import { z } from 'zod';
import { createBacktestCostProfileService } from '../../../../../application/backtest-cost-profile';
import { BacktestCostProfileSubmissionSchema } from '../../../../../adapters/prisma/backtest-cost-profile';
import { ReadModelError } from '../../../../../application/read-models-v1';
import { prisma } from '../../../../../lib/prisma';
import { extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';
import { resolveRequestedBy } from '../../agent-runs/_requested-by';
import { toCostProfilePublicDTO } from './_dto';

export const dynamic = 'force-dynamic';

async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ReadModelError('INVALID_BODY', 'corpo da requisição não é um JSON válido');
  }
}

/**
 * Item A / D5: cria um BacktestCostProfile. Admin-only (checado dentro do
 * service, nunca só na UI); `createdBy` vem sempre da sessão autenticada.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const raw = await parseBody(request);
    const body = parseWithSchema(BacktestCostProfileSubmissionSchema, raw);
    const requestedBy = await resolveRequestedBy(request);

    const service = createBacktestCostProfileService(prisma);
    const profile = await service.create(body, requestedBy);

    return jsonSuccess(profile, {}, 201);
  } catch (error) {
    return jsonError(error);
  }
}

const ListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(64).optional(),
  })
  .strict();

/**
 * Item B: leitura paginada de BacktestCostProfile ativos (não arquivados),
 * para a UI de treino selecionar `costProfileId` explicitamente. Qualquer
 * usuário autenticado pode ler; criação continua admin-only no POST acima.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const raw = extractStrictQuery(request, ['limit', 'cursor'] as const);
    const query = parseWithSchema(ListQuerySchema, raw);
    const limit = query.limit ?? 20;

    // Bloqueador 4 (revisão Guardião): busca limit+1 para saber com certeza
    // se há próxima página — nunca produzir `nextCursor` fantasma.
    const service = createBacktestCostProfileService(prisma);
    const profiles = await service.listActive(limit + 1, query.cursor);
    const hasNext = profiles.length > limit;
    const page = hasNext ? profiles.slice(0, limit) : profiles;
    const nextCursor = hasNext ? page[page.length - 1].id : null;

    return jsonSuccess(page.map(toCostProfilePublicDTO), { count: page.length, nextCursor });
  } catch (error) {
    return jsonError(error);
  }
}
