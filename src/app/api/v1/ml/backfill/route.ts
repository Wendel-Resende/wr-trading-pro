import { z } from 'zod';
import { createHttpMlApiPort } from '../../../../../application/ml-hybrid';
import { createBackfillRunService } from '../../../../../application/backfill-run';
import type { BackfillFailureEntry, BackfillRunStatus } from '../../../../../domain/v1/models/backfill-run';
import { ReadModelError } from '../../../../../application/read-models-v1';
import { prisma } from '../../../../../lib/prisma';
import { jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';
import { normalizeTickerLabel, redactUnsafeText } from '../../_shared/sanitize-text';
import { resolveRequestedBy } from '../../agent-runs/_requested-by';

export const dynamic = 'force-dynamic';

const FAILURE_REASON_MAX_LENGTH = 120;
const REDACTED_FAILURE_REASON = 'falha não detalhável (formato restrito)';

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
    const requestedBy = await resolveRequestedBy(request);

    const mlApi = createHttpMlApiPort(process.env.WR_ML_API_URL ?? 'http://127.0.0.1:5560');
    const result = await mlApi.backfill(body.symbols);

    // Bloqueador crítico 1 (auditoria final do Guardião, 2026-07-22): o
    // relatório precisa sobreviver a reload — persistido aqui, nunca só em
    // estado do navegador. Bloqueador crítico 2: `failed` bruto do Python
    // (`Record<ticker, mensagem livre>`) é sanitizado ANTES de persistir —
    // nunca guardamos path/token/URL/stack trace, mesmo append-only.
    const updatedSymbols = result.ok.map(normalizeTickerLabel);
    const failures: BackfillFailureEntry[] = Object.entries(result.failed).map(([ticker, reason]) => ({
      ticker: normalizeTickerLabel(ticker),
      reasonSummary: redactUnsafeText(reason, FAILURE_REASON_MAX_LENGTH, REDACTED_FAILURE_REASON),
    }));

    const eligibleCount = result.ok.length + failures.length;
    const status: BackfillRunStatus = failures.length === 0 ? 'SUCCESS' : result.ok.length === 0 ? 'FAILED' : 'PARTIAL';

    const backfillRunService = createBackfillRunService(prisma);
    const persisted = await backfillRunService.record({
      requestedBy,
      status,
      eligibleCount,
      updatedCount: result.ok.length,
      failedCount: failures.length,
      updatedSymbols,
      failures,
    });

    // Bloqueador 1 (auditoria focada do Guardião, 2026-07-22): a resposta
    // pública nunca pode espalhar `result` bruto — `result.failed` carrega
    // texto livre do Python (path, URL, token, stack trace). O DTO usa
    // apenas os campos já sanitizados/persistidos acima.
    return jsonSuccess({
      updatedSymbols,
      failures,
      eligibleCount,
      updatedCount: result.ok.length,
      failedCount: failures.length,
      status,
      backfillRunId: persisted.backfillRunId,
    });
  } catch (error) {
    return jsonError(error);
  }
}
