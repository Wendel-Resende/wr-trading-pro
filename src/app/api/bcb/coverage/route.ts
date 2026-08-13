import { NextResponse } from 'next/server';
import { getBcbCoverage, BCB_PROVENANCE, BCB_COVERAGE_TICKERS } from '@/lib/server/bcb-legacy-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/bcb/coverage — cobertura BCB (prudencial/financeiro) por banco.
 * Read-only, sem parâmetros de escrita. Sempre os 10 tickers de referência
 * da integração (ou o subconjunto informado em ?tickers=A,B,C).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const tickersParam = url.searchParams.get('tickers');
    const tickers = tickersParam
      ? tickersParam
          .split(',')
          .map((t) => t.trim().toUpperCase())
          .filter((t) => t.length > 0 && t.length <= 12)
          .slice(0, 50) // limite server-side — nunca aceita lista arbitrariamente grande
      : BCB_COVERAGE_TICKERS;

    const coverage = getBcbCoverage(tickers);
    return NextResponse.json({
      coverage,
      count: coverage.length,
      provenance: BCB_PROVENANCE,
    });
  } catch (error) {
    console.error('[api/bcb/coverage]', error);
    return NextResponse.json(
      { error: 'Não foi possível ler a cobertura BCB.' },
      { status: 500 }
    );
  }
}
