import { NextRequest, NextResponse } from 'next/server';
import { buildFundamentalSheet } from '@/lib/server/cvm-fundamentals-sheet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CD_CVM_PATTERN = /^[0-9]{1,10}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ cdCvm: string }> }
) {
  try {
    const { cdCvm } = await params;
    if (!CD_CVM_PATTERN.test(cdCvm)) {
      return NextResponse.json({ error: 'Código CVM inválido.' }, { status: 400 });
    }
    const asOfRaw = new URL(request.url).searchParams.get('asOf');
    let asOf: string | undefined;
    if (asOfRaw !== null) {
      if (!ISO_DATE_PATTERN.test(asOfRaw) || Number.isNaN(Date.parse(asOfRaw))) {
        return NextResponse.json({ error: 'Parâmetro "asOf" inválido (YYYY-MM-DD).' }, { status: 400 });
      }
      asOf = asOfRaw;
    }
    const sheet = buildFundamentalSheet(cdCvm, asOf);
    if (!sheet) {
      return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
    }
    return NextResponse.json(sheet);
  } catch (error) {
    console.error('[api/cvm/companies/:cdCvm/fundamentals]', error);
    return NextResponse.json(
      { error: 'Não foi possível montar a ficha fundamentalista.' },
      { status: 500 }
    );
  }
}
