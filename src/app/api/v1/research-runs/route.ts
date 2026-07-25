import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { createResearchRunService } from '../../../../application/research-run';
import { createModelVersionService, isTrainingEvidenceApproved } from '../../../../application/model-version';
import { PrismaDirectionalRepository } from '../../../../adapters/prisma/ml-directional';
import { TimestampSchema } from '../../../../adapters/prisma/research-run';
import { extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../_shared/http';
import { ReadModelError } from '../../../../application/read-models-v1';
import { resolveRequestedBy } from '../agent-runs/_requested-by';
import { toResearchRunPublicDTO } from './_dto';

export const dynamic = 'force-dynamic';

/**
 * Achado médio 7 (auditoria final do Guardião, 2026-07-22): `modelVersionId`
 * REMOVIDO do corpo aceito por este POST público — vincular um ResearchRun a
 * uma versão "aprovada" só pode acontecer pelo caminho interno
 * `DirectionalService.finalizeTraining` → `linkModelVersion` (após o gate
 * aprovar de fato), nunca por um cliente forjando o campo no corpo da
 * requisição. Sem isso, qualquer chamador autenticado poderia produzir um
 * `outcome: 'APROVADO'` falso apontando para qualquer ModelVersion existente.
 */
const BodySchema = z
  .object({
    name: z.string().min(1).max(200),
    hypothesis: z.string().min(1).max(5000),
    datasetId: z.string().min(1).max(200),
    windowStart: TimestampSchema,
    windowEnd: TimestampSchema,
    paramsJson: z.string().min(1).max(20_000),
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

    const service = createResearchRunService(prisma);
    const run = await service.submit(body, createdBy);

    return jsonSuccess(run, {}, 201);
  } catch (error) {
    return jsonError(error);
  }
}

const ListQuerySchema = z
  .object({
    datasetId: z.string().min(1).max(200).optional(),
    modelVersionId: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(64).optional(),
  })
  .strict();

/**
 * Item B: os três seletores (`datasetId`/`modelVersionId`/`name`) são
 * mutuamente exclusivos — exigir exatamente um. Todos, incluindo o caminho
 * legado `datasetId` (revisão final do Guardião, bloqueador 2), devolvem o
 * DTO público allowlist (bloqueador 3) e paginação `limit+1` (bloqueador 4).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const raw = extractStrictQuery(request, ['datasetId', 'modelVersionId', 'name', 'limit', 'cursor'] as const);
    const query = parseWithSchema(ListQuerySchema, raw);

    const selectors = [query.datasetId, query.modelVersionId, query.name].filter((v) => v !== undefined);
    if (selectors.length !== 1) {
      throw new ReadModelError('INVALID_QUERY', 'informe exatamente um de: datasetId, modelVersionId ou name');
    }

    const service = createResearchRunService(prisma);

    const limit = query.limit ?? 20;

    // Revisão final do Guardião (2026-07-22, bloqueador 2): o caminho legado
    // `datasetId` também é rota pública autenticada — não pode devolver
    // ResearchRun cru (`paramsJson`, `datasetId`, `createdBy`, `hypothesis`).
    // Aplica o mesmo DTO público e a mesma paginação `limit+1` dos caminhos
    // novos; ordenação permanece `createdAt asc` (comportamento pré-existente).
    const runs = query.datasetId !== undefined
      ? await service.listByDataset(query.datasetId, limit + 1, query.cursor)
      : query.modelVersionId !== undefined
        ? await service.listByModelVersion(query.modelVersionId, limit + 1, query.cursor)
        : await service.listRecentByName(query.name as string, limit + 1, query.cursor);

    const hasNext = runs.length > limit;
    const page = hasNext ? runs.slice(0, limit) : runs;
    const nextCursor = hasNext ? page[page.length - 1].runId : null;

    // Achado médio 7: resolve, para cada modelVersionId REALMENTE linkado
    // nesta página, se a evidência persistida da ModelVersion tem
    // `gate.approved === true` — nunca confia em `modelVersionId !== null`
    // sozinho (ver `_dto.ts`).
    const modelVersionService = createModelVersionService(prisma);
    const uniqueModelVersionIds = [...new Set(page.map((r) => r.modelVersionId).filter((id): id is string => id !== null))];
    const gateApprovedByModelVersionId = new Map<string, boolean>();
    // Item D: um ResearchRun pode apontar para uma `DirectionalModelVersion`
    // (motor atual) ou para uma `ModelVersion` histórica (motor híbrido,
    // removido — mas as linhas seguem no banco e precisam continuar legíveis).
    // Consulta o direcional primeiro; só cai no legado se não encontrar.
    const directionalRepository = new PrismaDirectionalRepository(prisma);
    for (const modelVersionId of uniqueModelVersionIds) {
      const directional = await directionalRepository.findModelVersionById(modelVersionId).catch(() => null);
      if (directional) {
        gateApprovedByModelVersionId.set(modelVersionId, directional.status === 'ACTIVE');
        continue;
      }
      try {
        const version = await modelVersionService.get(modelVersionId);
        gateApprovedByModelVersionId.set(modelVersionId, isTrainingEvidenceApproved(version.trainingEvidenceJson));
      } catch {
        gateApprovedByModelVersionId.set(modelVersionId, false);
      }
    }

    return jsonSuccess(page.map((r) => toResearchRunPublicDTO(r, gateApprovedByModelVersionId)), { count: page.length, nextCursor });
  } catch (error) {
    return jsonError(error);
  }
}
