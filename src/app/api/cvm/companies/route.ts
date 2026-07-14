import { NextResponse } from 'next/server';
import { listCompanies, CVM_LEGACY_PROVENANCE } from '@/lib/server/cvm-legacy-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const companies = listCompanies();
    return NextResponse.json({
      companies,
      count: companies.length,
      provenance: CVM_LEGACY_PROVENANCE,
    });
  } catch (error) {
    console.error('[api/cvm/companies]', error);
    return NextResponse.json(
      { error: 'Não foi possível ler o banco de fundamentos CVM.' },
      { status: 500 }
    );
  }
}
