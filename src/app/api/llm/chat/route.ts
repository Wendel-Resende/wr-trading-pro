/**
 * LLM Proxy API Route - WR Trading Pro
 *
 * GET  /api/llm/chat — lista provedores configurados no servidor (sem segredos)
 * POST /api/llm/chat — encaminha chat para o provedor server-side
 *
 * O cliente NUNCA envia api_key ou endpoint: o schema é estrito e rejeita
 * campos extras. Credenciais e endpoint Ollama vêm de src/lib/server/llm-config.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverLlmService } from '@/lib/server/llm-providers';

const llmMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1).max(20_000),
}).strict();

const llmConfigSchema = z.object({
  provider: z.enum(['OPENAI', 'DEEPSEEK', 'OLLAMA', 'QWEN', 'GROQ', 'MANUS']).optional(),
  model: z.string().trim().regex(/^[\w][\w.\-:/]{0,63}$/, 'Modelo inválido').optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(32_000).optional(),
}).strict();

const marketContextSchema = z.object({
  symbol: z.string().max(32),
  bid: z.number().finite(),
  ask: z.number().finite(),
  spread: z.number().finite(),
  accountBalance: z.number().finite(),
  accountEquity: z.number().finite(),
  dailyResult: z.number().finite(),
  openPositions: z.array(z.object({
    ticket: z.number(),
    symbol: z.string().max(32),
    type: z.string().max(16),
    volume: z.number().finite(),
    openPrice: z.number().finite(),
    currentPrice: z.number().finite(),
    profit: z.number().finite(),
  }).strict()).max(200),
  timestamp: z.string().max(64),
}).strict();

const chatRequestSchema = z.object({
  messages: z.array(llmMessageSchema).min(1).max(100),
  config: llmConfigSchema.optional(),
  context: z.object({
    market: marketContextSchema.optional(),
    marketData: z.unknown().optional(),
    portfolio: z.unknown().optional(),
    indicators: z.unknown().optional(),
  }).strict().optional(),
}).strict();

export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      providers: serverLlmService.getAvailableProviders(),
      timestamp: new Date().toISOString(),
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const parsed = chatRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Payload de chat LLM inválido',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const response = await serverLlmService.chat(parsed.data);
    return NextResponse.json({ success: true, data: response });
  } catch (error) {
    console.error('LLM proxy error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Erro no proxy LLM',
      },
      { status: 502 }
    );
  }
}
