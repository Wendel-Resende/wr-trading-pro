import { NextResponse } from 'next/server';
import { z, ZodError, type ZodTypeAny, type TypeOf } from 'zod';
import { ReadModelError } from '../../../../application/read-models-v1';

/**
 * Shared HTTP plumbing for the /api/v1 read-only read-model endpoints
 * (Fase 2 / Item 4). All error responses are sanitized: no stack trace,
 * SQL, or raw Prisma message is ever exposed.
 */

export function extractStrictQuery(request: Request, allowedKeys: readonly string[]): Record<string, string> {
  const url = new URL(request.url);
  const allowed = new Set(allowedKeys);
  const result: Record<string, string> = {};

  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) {
      throw new ReadModelError('INVALID_QUERY', `parâmetro de query desconhecido: ${key}`);
    }
  }

  for (const key of allowed) {
    const values = url.searchParams.getAll(key);
    if (values.length > 1) {
      throw new ReadModelError('INVALID_QUERY', `parâmetro de query duplicado: ${key}`);
    }
    if (values.length === 1) {
      result[key] = values[0];
    }
  }

  return result;
}

export function parseWithSchema<T extends ZodTypeAny>(schema: T, raw: unknown): TypeOf<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ReadModelError('INVALID_QUERY', 'query inválida: ' + summarizeZodError(parsed.error));
  }
  return parsed.data;
}

function summarizeZodError(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`).join('; ');
}

/**
 * Query-string integer parser: accepts ONLY the canonical non-negative
 * decimal string form (no empty string, no leading `+`/`-`, no decimal
 * point, no exponential notation, no leading zeros except the literal
 * "0"). Transforms to a `number` and applies inclusive bounds. Anything
 * outside the canonical form or bounds fails Zod validation, which the
 * route layer turns into 400 INVALID_QUERY — never a 500.
 */
export function decimalIntegerString(minValue: number, maxValue: number) {
  return z
    .string()
    .regex(/^(0|[1-9]\d*)$/, 'deve ser um inteiro decimal não-negativo, sem sinal, ponto ou notação exponencial')
    .transform((value) => Number(value))
    .refine((value) => Number.isSafeInteger(value), 'fora do intervalo seguro de inteiros')
    .refine((value) => value >= minValue && value <= maxValue, `deve estar entre ${minValue} e ${maxValue}`);
}

export function jsonSuccess(data: unknown, meta: Record<string, unknown> = {}, status = 200): NextResponse {
  return NextResponse.json({ success: true, data, meta }, { status });
}

export function jsonError(error: unknown): NextResponse {
  if (error instanceof ReadModelError) {
    return NextResponse.json({ success: false, error: { code: error.code, message: error.message } }, { status: error.status });
  }
  // Any non-ReadModelError (Prisma error, unexpected exception, etc.) is
  // sanitized: never leak stack traces, SQL, or raw driver messages.
  return NextResponse.json(
    { success: false, error: { code: 'INTERNAL_ERROR', message: 'erro interno inesperado' } },
    { status: 500 },
  );
}
