import { NextResponse } from 'next/server';
import { CVM_LEGACY_PROVENANCE } from '@/lib/server/cvm-legacy-db';
import {
  getDividendQualityRanking,
  getPortfolio12,
  getFinancialHealthLatest,
  getMonteCarloByTicker,
} from '@/lib/server/cvm-exports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const health = getFinancialHealthLatest();
    const monteCarlo = getMonteCarloByTicker();

    const ranking = getDividendQualityRanking().map((q) => ({
      ...q,
      saudeFinanceira: health.get(q.ticker)?.score ?? null,
      saudeClassificacao: health.get(q.ticker)?.classificacao ?? null,
      monteCarlo: monteCarlo.get(q.ticker)?.classificacao ?? null,
    }));

    return NextResponse.json({
      ranking,
      portfolio: getPortfolio12(),
      provenance: CVM_LEGACY_PROVENANCE,
    });
  } catch (error) {
    console.error('[api/cvm/dividends]', error);
    return NextResponse.json(
      { error: 'Não foi possível ler os dados de dividendos.' },
      { status: 500 }
    );
  }
}
