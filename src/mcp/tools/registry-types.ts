/**
 * Shared shapes for MCP tool definitions and error translation. Reuses
 * `ReadModelError` (Fase 2/3) so tool error messages stay sanitized —
 * never a raw stack trace, SQL string, or Prisma driver message.
 */
import { z, type ZodRawShape, type ZodTypeAny } from 'zod';
import { ReadModelError } from '../../application/read-models-v1/errors';
import { Mt5McpError } from '../../lib/server/mt5-mcp-client';

export interface McpToolContent {
  readonly type: 'text';
  readonly text: string;
}

export interface McpToolResult {
  readonly content: readonly McpToolContent[];
  readonly isError?: boolean;
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodRawShape;
  readonly handler: (args: Record<string, unknown>) => Promise<McpToolResult>;
  /** Classificação consciente de privilégio: 'free' = agente chama à vontade; 'gated' = exige fluxo de aprovação humana. */
  readonly privilege: 'free' | 'gated';
}

/** Parses/validates raw tool args against a zod raw shape; throws sanitized `ReadModelError('INVALID_QUERY', ...)` on failure. */
export function parseToolArgs<Shape extends ZodRawShape>(shape: Shape, args: Record<string, unknown>): z.infer<z.ZodObject<Shape>> {
  const result = z.object(shape).safeParse(args);
  if (!result.success) {
    throw new ReadModelError('INVALID_QUERY', 'entrada inválida: ' + result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`).join('; '));
  }
  return result.data;
}

/** Translates a thrown error into a sanitized, stable `isError: true` tool result. */
export function toToolError(error: unknown): McpToolResult {
  if (error instanceof Mt5McpError) {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(error.toPayload()) }],
    };
  }
  if (error instanceof ReadModelError) {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ code: error.code, message: error.message }) }],
    };
  }
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'erro interno ao processar a tool' }) }],
  };
}
