import { createBacktestCostProfileService } from '../../../../../application/backtest-cost-profile';
import { BacktestCostProfileSubmissionSchema } from '../../../../../adapters/prisma/backtest-cost-profile';
import { ReadModelError } from '../../../../../application/read-models-v1';
import { prisma } from '../../../../../lib/prisma';
import { jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';
import { resolveRequestedBy } from '../../agent-runs/_requested-by';

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
