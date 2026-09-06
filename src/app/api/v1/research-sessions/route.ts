import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { createResearchSessionService } from '../../../../application/research-session';
import {
  ResearchSessionKindSchema,
  ResearchSessionStatusSchema,
} from '../../../../adapters/prisma/research-session';
import { extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../_shared/http';
import { ReadModelError } from '../../../../application/read-models-v1';

export const dynamic = 'force-dynamic';

const BodySchema = z
  .object({
    kind: ResearchSessionKindSchema,
    label: z.string().min(1).max(200),
    notes: z.string().max(4000).nullable().optional(),
    config: z.unknown(),
    createdBy: z.string().min(1).max(120),
  })
  .strict();

const ListQuerySchema = z
  .object({
    kind: ResearchSessionKindSchema.optional(),
    status: ResearchSessionStatusSchema.optional(),
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

export async function POST(request: Request): Promise<Response> {
  try {
    const body = parseWithSchema(BodySchema, await parseBody(request));
    const service = createResearchSessionService(prisma);
    const session = await service.createDraft({
      kind: body.kind,
      label: body.label,
      notes: body.notes ?? null,
      config: body.config,
      createdBy: body.createdBy,
    });
    return jsonSuccess(session, {}, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const raw = extractStrictQuery(request, ['kind', 'status', 'limit', 'cursor'] as const);
    const query = parseWithSchema(ListQuerySchema, raw);
    const service = createResearchSessionService(prisma);
    const limit = query.limit ?? 20;

    const sessions = await service.list({
      ...(query.kind === undefined ? {} : { kind: query.kind }),
      ...(query.status === undefined ? {} : { status: query.status }),
      limit: limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });

    const hasNext = sessions.length > limit;
    const page = hasNext ? sessions.slice(0, limit) : sessions;
    const nextCursor = hasNext ? page[page.length - 1].sessionId : null;

    return jsonSuccess(page, { nextCursor });
  } catch (error) {
    return jsonError(error);
  }
}
