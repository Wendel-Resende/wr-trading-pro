/**
 * Scan de opções (covered call / cash-secured put) — proxy para o `spread_api`.
 *
 * Por que proxy e não chamada direta do navegador: o `spread_api` (Flask) é
 * loopback-only por design, então o cliente não o alcança. E por que Python e
 * não o MCP nativo do MT5: o servidor MCP do terminal **não expõe tool de
 * `symbol_info`** (confirmado por sonda em 2026-08-11), e sem ela não há bid,
 * ask nem vencimento por opção — o scan sairia sem cotação. O pacote
 * `MetaTrader5` do Python tem a API completa.
 *
 * Esta rota faz a UI usar EXATAMENTE o mesmo caminho que o agente de IA já usa
 * pela tool `market.scan_options`. Antes disso, os dois divergiam: o agente
 * escaneava opções normalmente enquanto a aba falava com um protocolo
 * WebSocket removido em 2026-08-02 e não recebia nada.
 *
 * Somente leitura do ponto de vista de trading — nenhuma ordem é enviada. O
 * `spread_api` persiste o resultado em `data/options/options_data.db`.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SPREAD_API_URL = process.env.WR_MCP_SPREAD_API_URL?.trim() || 'http://127.0.0.1:5000';

/** O scan varre todas as opções do ativo no terminal — é lento por natureza. */
const SCAN_TIMEOUT_MS = 120_000;

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Corpo da requisição inválido (JSON esperado).' }, { status: 400 });
  }

  const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
  if (!symbol) {
    return NextResponse.json({ success: false, error: 'Parâmetro "symbol" é obrigatório.' }, { status: 400 });
  }

  // Percentuais "humanos" (10 = 10%), como o handler Flask espera — ele é quem
  // converte para fração. Duplicar a conversão aqui produziria 0,1% no lugar
  // de 10%.
  const payload = {
    symbol,
    capital: typeof body.capital === 'number' ? body.capital : 10_000,
    strike_range_pct: typeof body.strike_range_pct === 'number' ? body.strike_range_pct : 10,
    min_annual_pct: typeof body.min_annual_pct === 'number' ? body.min_annual_pct : 5,
  };

  let response: Response;
  try {
    response = await fetch(`${SPREAD_API_URL}/api/options/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });
  } catch (error) {
    // Estado honesto: serviço fora do ar é dito com todas as letras, nunca
    // devolvido como lista vazia de oportunidades.
    console.error('[api/options/scan] spread_api inacessível:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          'Serviço de opções (spread_api) não respondeu. Verifique se ele está rodando na aba Admin e se o MetaTrader 5 está aberto.',
      },
      { status: 503 },
    );
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && typeof (data as Record<string, unknown>).error === 'string'
        ? ((data as Record<string, unknown>).error as string)
        : null) ?? `Falha no scan de opções (HTTP ${response.status}).`;
    return NextResponse.json({ success: false, error: message }, { status: response.status });
  }

  return NextResponse.json({ success: true, data });
}
