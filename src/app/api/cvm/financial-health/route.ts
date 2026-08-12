import { NextRequest, NextResponse } from 'next/server';
import { financialHealthRanking } from '@/lib/server/cvm-financial-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const asOfRaw = searchParams.get('asOf');
    let asOf: string | undefined;
    if (asOfRaw !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) || Number.isNaN(Date.parse(asOfRaw))) {
        return NextResponse.json({ error: 'Parâmetro "asOf" inválido (YYYY-MM-DD).' }, { status: 400 });
      }
      asOf = asOfRaw;
    }
    return NextResponse.json(financialHealthRanking(asOf));
  } catch (error) {
    console.error('[api/cvm/financial-health]', error);
    return NextResponse.json(
      { error: 'Não foi possível montar o ranking de saúde financeira.' },
      { status: 500 },
    );
  }
}
