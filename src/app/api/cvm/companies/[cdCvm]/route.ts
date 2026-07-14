import { NextRequest, NextResponse } from 'next/server';
import {
  getCompany,
  getQuarters,
  getShareCapital,
  CVM_LEGACY_PROVENANCE,
} from '@/lib/server/cvm-legacy-db';
import {
  getDividendQuarters,
  getDividendSummary,
  getDividendQualityRanking,
  getFinancialHealthLatest,
} from '@/lib/server/cvm-exports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CD_CVM_PATTERN = /^[0-9]{1,10}$/;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ cdCvm: string }> }
) {
  try {
    const { cdCvm } = await params;
    if (!CD_CVM_PATTERN.test(cdCvm)) {
      return NextResponse.json({ error: 'Código CVM inválido.' }, { status: 400 });
    }

    const company = getCompany(cdCvm);
    if (!company) {
      return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
    }

    // Dividendos e scores são opcionais: a resposta base não pode falhar se
    // os exports analíticos não estiverem presentes no snapshot local.
    let dividends = null;
    try {
      dividends = {
        quarters: getDividendQuarters(company.ticker),
        summary: getDividendSummary(company.ticker),
        quality: getDividendQualityRanking().find((q) => q.ticker === company.ticker) ?? null,
        health: getFinancialHealthLatest().get(company.ticker) ?? null,
      };
    } catch (error) {
      console.warn('[api/cvm/companies/:cdCvm] exports analíticos indisponíveis:', error);
    }

    return NextResponse.json({
      company,
      quarters: getQuarters(cdCvm),
      shareCapital: getShareCapital(cdCvm),
      dividends,
      provenance: CVM_LEGACY_PROVENANCE,
    });
  } catch (error) {
    console.error('[api/cvm/companies/:cdCvm]', error);
    return NextResponse.json(
      { error: 'Não foi possível ler o banco de fundamentos CVM.' },
      { status: 500 }
    );
  }
}
