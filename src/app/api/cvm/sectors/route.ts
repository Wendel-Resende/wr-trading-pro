import { NextResponse } from 'next/server';
import { listSectors, indicatorCatalog } from '@/lib/server/cvm-sector-ranking';
import { CVM_LEGACY_PROVENANCE } from '@/lib/server/cvm-legacy-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      sectors: listSectors(),
      indicators: indicatorCatalog,
      provenance: CVM_LEGACY_PROVENANCE,
    });
  } catch (error) {
    console.error('[api/cvm/sectors]', error);
    return NextResponse.json({ error: 'Não foi possível listar os setores CVM.' }, { status: 500 });
  }
}
