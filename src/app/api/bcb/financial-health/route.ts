import { NextResponse } from 'next/server';
import { getBankHealthRanking } from '@/lib/server/bcb-financial-health';
import {
  BANK_THRESHOLDS,
  BANK_MIN_QUARTERS,
  BANK_RECENT_QUARTERS,
  BANK_PILLAR_KEYS,
  BANK_PILLAR_LABELS,
  BANK_PILLAR_DESCRIPTIONS,
} from '@/lib/server/bcb-financial-health-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/bcb/financial-health — saúde financeira dos bancos B3 (BCB/IFData).
 *
 * Read-only, sem parâmetros. Devolve junto os critérios usados: os limiares
 * são regulatórios, e mostrá-los é o que permite ao leitor conferir a régua em
 * vez de confiar nela.
 */
export async function GET() {
  try {
    const rank = getBankHealthRanking();

    return NextResponse.json({
      bancos: rank.bancos,
      excluidos: rank.excluidos,
      asOf: {
        prudencial: rank.asOfPrudencial,
        financeiro: rank.asOfFinanceiro,
      },
      criterios: {
        limiares: BANK_THRESHOLDS,
        minTrimestres: BANK_MIN_QUARTERS,
        janelaRecente: BANK_RECENT_QUARTERS,
        pilares: BANK_PILLAR_KEYS.map((k) => ({
          key: k,
          label: BANK_PILLAR_LABELS[k],
          descricao: BANK_PILLAR_DESCRIPTIONS[k],
        })),
      },
      provenance: rank.provenance,
    });
  } catch (error) {
    console.error('[api/bcb/financial-health]', error);
    return NextResponse.json(
      { error: 'Não foi possível montar a saúde financeira dos bancos.' },
      { status: 500 },
    );
  }
}
