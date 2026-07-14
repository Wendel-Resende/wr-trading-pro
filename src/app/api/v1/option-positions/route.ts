import { NextResponse } from 'next/server';
import type { OptionPosition } from '../../../../domain/v1/models/option-position';
import { CreateOptionPositionBodySchema } from '../../../../adapters/prisma/option-position';
import { createOptionPositionService } from '../../../../application/option-position';
import { prisma } from '../../../../lib/prisma';
import { ReadModelError } from '../../../../application/read-models-v1';
import { jsonError, jsonSuccess } from '../_shared/http';

export const dynamic = 'force-dynamic';

/**
 * Fase 6 — Consolidação. Cria/lista `OptionPosition` governadas. Nunca
 * envia ordem ao MT5/API Python: apenas registra o estado auditável.
 */
function toWirePosition(position: OptionPosition) {
  return {
    id: position.id,
    instrumentId: position.instrumentId,
    kind: position.kind,
    strike: position.strike,
    expiration: position.expiration,
    side: position.side,
    quantity: position.quantity,
    source: position.source,
    knowledgeTime: position.knowledgeTime,
    createdAt: position.createdAt,
  };
}

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
    const parsed = CreateOptionPositionBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ReadModelError(
        'INVALID_BODY',
        'corpo inválido: ' + parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`).join('; '),
      );
    }
    const body = parsed.data;

    const service = createOptionPositionService(prisma);
    const position = await service.create(body);

    return NextResponse.json({ success: true, data: toWirePosition(position) }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const allowedKeys = ['instrumentId'] as const;
    for (const key of url.searchParams.keys()) {
      if (!allowedKeys.includes(key as (typeof allowedKeys)[number])) {
        throw new ReadModelError('INVALID_QUERY', `parâmetro de query desconhecido: ${key}`);
      }
    }
    const instrumentId = url.searchParams.get('instrumentId');
    if (!instrumentId) {
      throw new ReadModelError('INVALID_QUERY', 'parâmetro obrigatório ausente: instrumentId');
    }

    const service = createOptionPositionService(prisma);
    const positions = await service.listByInstrumentId(instrumentId);
    return jsonSuccess(positions.map(toWirePosition), { count: positions.length });
  } catch (error) {
    return jsonError(error);
  }
}
