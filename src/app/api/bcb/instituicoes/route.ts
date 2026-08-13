import { NextResponse } from 'next/server';
import { getBcbEntityLinks, BCB_PROVENANCE } from '@/lib/server/bcb-legacy-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/bcb/instituicoes[?ticker=ITUB4] — vínculo ticker → empresa/CNPJ
 * → instituição/conglomerado BCB (prudencial e financeiro separados).
 * Read-only, DTO allowlist (só os campos de BcbEntityLink), limite
 * server-side quando nenhum ticker é informado.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const tickerParam = url.searchParams.get('ticker');
    const ticker = tickerParam ? tickerParam.trim().toUpperCase().slice(0, 12) : undefined;

    const links = getBcbEntityLinks(ticker);
    const LIMIT = 200; // teto server-side quando não filtrado por ticker
    const limited = links.slice(0, LIMIT);

    return NextResponse.json({
      links: limited.map((l) => ({
        cdCvm: l.cdCvm,
        ticker: l.ticker,
        cnpjCompanhia: l.cnpjCompanhia,
        nomeCompanhia: l.nomeCompanhia,
        codInst: l.codInst,
        tipoInstituicao: l.tipoInstituicao,
        perimetro: l.perimetro,
        tipoConsolidacao: l.tipoConsolidacao,
        cnpjLiderBcb: l.cnpjLiderBcb,
        nomeEntidadeBcb: l.nomeEntidadeBcb,
        fonte: l.fonte,
      })),
      count: limited.length,
      truncated: links.length > LIMIT,
      provenance: BCB_PROVENANCE,
    });
  } catch (error) {
    console.error('[api/bcb/instituicoes]', error);
    return NextResponse.json(
      { error: 'Não foi possível ler o vínculo de identidade BCB.' },
      { status: 500 }
    );
  }
}
