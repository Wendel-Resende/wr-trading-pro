import { z } from 'zod';
import { prisma } from '../../../../../../lib/prisma';
import { createBacktestCostProfileService } from '../../../../../../application/backtest-cost-profile';
import { ReadModelError } from '../../../../../../application/read-models-v1';
import { jsonError, jsonSuccess } from '../../../_shared/http';
import { toCostProfilePublicDTO } from '../_dto';

export const dynamic = 'force-dynamic';

// Achado médio 12 (auditoria final do Guardião, 2026-07-22): mesmo formato
// de `id` gerado por `cuid()` no Prisma — valida ANTES de tocar o banco,
// nunca deixa um id malformado virar erro genérico/500.
const IdParamSchema = z.string().min(1).max(64).regex(/^[a-z0-9]+$/i, 'id inválido');

/**
 * Item B / bloqueador 5: leitura de detalhe de um BacktestCostProfile por
 * id — usada pela UI para resolver os componentes de custo de fato usados
 * em cada BacktestRun histórico (transparência de custo), mesmo que o
 * perfil já esteja arquivado.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id: rawId } = await params;
    const parsedId = IdParamSchema.safeParse(rawId);
    if (!parsedId.success) {
      throw new ReadModelError('INVALID_QUERY', 'id de BacktestCostProfile inválido');
    }
    const service = createBacktestCostProfileService(prisma);
    const profile = await service.get(parsedId.data);
    return jsonSuccess(toCostProfilePublicDTO(profile));
  } catch (error) {
    return jsonError(error);
  }
}
