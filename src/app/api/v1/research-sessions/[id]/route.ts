import { z } from 'zod';
import { prisma } from '../../../../../lib/prisma';
import { createResearchSessionService } from '../../../../../application/research-session';
import { jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';
import { ReadModelError } from '../../../../../application/read-models-v1';

export const dynamic = 'force-dynamic';

const PatchSchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    notes: z.string().max(4000).nullable().optional(),
    config: z.unknown().optional(),
  })
  .strict();

async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ReadModelError('INVALID_BODY', 'corpo da requisição não é um JSON válido');
  }
}

// Next.js 15: `params` é uma Promise.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    return jsonSuccess(await createResearchSessionService(prisma).get(id));
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = parseWithSchema(PatchSchema, await parseBody(request));
    return jsonSuccess(await createResearchSessionService(prisma).updateDraft(id, body));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    await createResearchSessionService(prisma).remove(id);
    return jsonSuccess({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
