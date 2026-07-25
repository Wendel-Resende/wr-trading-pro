import { z } from 'zod';
import { prisma } from '../../../../../../../lib/prisma';
import {
  createDirectionalService,
  createHttpDirectionalMlApiPort,
  toDirectionalModelVersionPublicDTO,
} from '../../../../../../../application/ml-directional';
import { ReadModelError } from '../../../../../../../application/read-models-v1';
import { jsonError, jsonSuccess } from '../../../../_shared/http';
import { resolveRequestedBy } from '../../../../agent-runs/_requested-by';

export const dynamic = 'force-dynamic';

/** Item D (§4.5) — detalhe de uma versão: métricas completas + conferência do gate. */

const ModelVersionParam = z.string().regex(/^[a-f0-9]{64}$/);

function mlApiBaseUrl(): string {
  return process.env.WR_ML_API_URL ?? 'http://127.0.0.1:5560';
}

export async function GET(
  request: Request,
  context: { params: Promise<{ modelVersion: string }> },
): Promise<Response> {
  try {
    const requestedBy = await resolveRequestedBy(request);
    if (requestedBy === 'unknown' || requestedBy.length === 0) {
      throw new ReadModelError('UNAUTHENTICATED', 'sessão inválida ou ausente — nenhuma identidade resolvida');
    }

    const { modelVersion } = await context.params;
    const parsed = ModelVersionParam.safeParse(modelVersion);
    if (!parsed.success) {
      // Validado ANTES de qualquer consulta: identidade canônica é sempre
      // 64-hex, e um valor fora disso nunca chega ao banco.
      throw new ReadModelError('INVALID_MODEL_VERSION', 'versão de modelo fora do formato canônico (64 hex)');
    }

    const service = createDirectionalService({ prisma, mlApi: createHttpDirectionalMlApiPort(mlApiBaseUrl()) });
    const model = await service.getModel(parsed.data);
    return jsonSuccess(toDirectionalModelVersionPublicDTO(model));
  } catch (error) {
    return jsonError(error);
  }
}
