import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { createAgentRunService } from '../../../../application/agent-run';
import { AgentRunBudgetSchema, AgentRunDagSchema, AgentRunInputSchema, AgentRunKindSchema, TimestampSchema } from '../../../../adapters/prisma/agent-run';
import { jsonError, jsonSuccess, parseWithSchema } from '../_shared/http';
import { ReadModelError } from '../../../../application/read-models-v1';
import { resolveRequestedBy } from './_requested-by';

export const dynamic = 'force-dynamic';

const BodySchema = z
  .object({
    kind: AgentRunKindSchema,
    dag: AgentRunDagSchema,
    input: AgentRunInputSchema,
    budget: AgentRunBudgetSchema.optional(),
    decisionTime: TimestampSchema,
  })
  .strict();

async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ReadModelError('INVALID_QUERY', 'corpo da requisição não é um JSON válido');
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const raw = await parseBody(request);
    const body = parseWithSchema(BodySchema, raw);
    const requestedBy = await resolveRequestedBy(request);

    const service = createAgentRunService(prisma);
    const run = await service.submit({
      requestedBy,
      kind: body.kind,
      dag: body.dag,
      input: body.input,
      budget: body.budget,
      decisionTime: body.decisionTime,
    });

    return jsonSuccess({ runId: run.runId, status: run.status, poll: `/api/v1/agent-runs/${run.runId}` }, {}, 202);
  } catch (error) {
    return jsonError(error);
  }
}

const ListQuerySchema = z
  .object({
    requestedBy: z.string().min(1).max(200).optional(),
    status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']).optional(),
    limit: z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).optional(),
    offset: z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).optional(),
  })
  .strict();

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const allowedKeys = ['requestedBy', 'status', 'limit', 'offset'] as const;
    const raw: Record<string, string> = {};
    for (const key of url.searchParams.keys()) {
      if (!allowedKeys.includes(key as (typeof allowedKeys)[number])) {
        throw new ReadModelError('INVALID_QUERY', `parâmetro de query desconhecido: ${key}`);
      }
    }
    for (const key of allowedKeys) {
      const value = url.searchParams.get(key);
      if (value !== null) raw[key] = value;
    }

    const query = parseWithSchema(ListQuerySchema, raw);
    const service = createAgentRunService(prisma);
    const runs = await service.list(query);
    return jsonSuccess(runs, { count: runs.length });
  } catch (error) {
    return jsonError(error);
  }
}
