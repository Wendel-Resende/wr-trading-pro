import { NextResponse } from 'next/server';
import type { OrderIntent } from '../../../../domain/v1/models/order-intent';
import { CreateOrderIntentBodySchema } from '../../../../adapters/prisma/order-intent';
import { createOrderIntentService, resolveOrderIntentConfigFromEnv } from '../../../../application/order-intent';
import { prisma } from '../../../../lib/prisma';
import { ReadModelError } from '../../../../application/read-models-v1';
import { jsonError, jsonSuccess } from '../_shared/http';
import { resolveRequestedBy } from '../agent-runs/_requested-by';

export const dynamic = 'force-dynamic';

function toWireIntent(intent: OrderIntent) {
  return {
    intentId: intent.intentId,
    decisionId: intent.decisionId,
    approvalId: intent.approvalId,
    status: intent.status,
    direction: intent.direction,
    quantity: intent.quantity,
    idempotencyKey: intent.idempotencyKey,
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
    const parsed = CreateOrderIntentBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ReadModelError(
        'INVALID_BODY',
        'corpo inválido: ' + parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`).join('; '),
      );
    }
    const body = parsed.data;

    // approvedBy/requestedBy derivam sempre da sessão autenticada (middleware), nunca do corpo.
    const requestedBy = await resolveRequestedBy(request);
    const approvedBy = requestedBy;

    const service = createOrderIntentService(prisma);
    const config = resolveOrderIntentConfigFromEnv();

    const result = await service.create(
      {
        decisionId: body.decisionId,
        idempotencyKey: body.idempotencyKey,
        quantity: body.quantity,
        decisionTime: body.decisionTime,
        requestedBy,
        approvedBy,
      },
      config,
    );

    return NextResponse.json(
      { success: true, replayed: result.replayed, data: toWireIntent(result.intent) },
      { status: result.replayed ? 200 : 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const allowedKeys = ['decisionId'] as const;
    for (const key of url.searchParams.keys()) {
      if (!allowedKeys.includes(key as (typeof allowedKeys)[number])) {
        throw new ReadModelError('INVALID_QUERY', `parâmetro de query desconhecido: ${key}`);
      }
    }
    const decisionId = url.searchParams.get('decisionId');
    if (!decisionId) {
      throw new ReadModelError('INVALID_QUERY', 'parâmetro obrigatório ausente: decisionId');
    }

    const service = createOrderIntentService(prisma);
    const intents = await service.listByDecisionId(decisionId);
    return jsonSuccess(intents, { count: intents.length });
  } catch (error) {
    return jsonError(error);
  }
}
