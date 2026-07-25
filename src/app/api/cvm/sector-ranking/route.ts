import { NextRequest, NextResponse } from 'next/server';
import { sectorRanking, isIndicatorKey } from '@/lib/server/cvm-sector-ranking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const setor = searchParams.get('setor');
    const indicator = searchParams.get('indicator');
    if (!setor) {
      return NextResponse.json({ error: 'Parâmetro "setor" é obrigatório.' }, { status: 400 });
    }
    if (!indicator || !isIndicatorKey(indicator)) {
      return NextResponse.json({ error: 'Parâmetro "indicator" inválido ou ausente.' }, { status: 400 });
    }
    // ano/trimestre opcionais: só aceitos como par de inteiros válidos.
    const anoRaw = searchParams.get('ano');
    const triRaw = searchParams.get('trimestre');
    let ano: number | undefined;
    let trimestre: number | undefined;
    if (anoRaw !== null || triRaw !== null) {
      const a = Number(anoRaw);
      const t = Number(triRaw);
      if (!Number.isInteger(a) || a < 2000 || a > 2100 || !Number.isInteger(t) || t < 1 || t > 4) {
        return NextResponse.json({ error: 'Parâmetros "ano"/"trimestre" inválidos.' }, { status: 400 });
      }
      ano = a;
      trimestre = t;
    }
    const asOfRaw = searchParams.get('asOf');
    let asOf: string | undefined;
    if (asOfRaw !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) || Number.isNaN(Date.parse(asOfRaw))) {
        return NextResponse.json({ error: 'Parâmetro "asOf" inválido (YYYY-MM-DD).' }, { status: 400 });
      }
      asOf = asOfRaw;
    }

    return NextResponse.json(sectorRanking(setor, indicator, ano, trimestre, asOf));
  } catch (error) {
    console.error('[api/cvm/sector-ranking]', error);
    return NextResponse.json({ error: 'Não foi possível montar o ranking setorial.' }, { status: 500 });
  }
}
