import { NextResponse } from 'next/server';
import { StockMonitoringServiceSingleton } from '@/services/stockMonitoringService';
import { stringifyBigInt } from '@/lib/bigint-serializer';

const stockMonitoringService = StockMonitoringServiceSingleton.getInstance();

/**
 * GET /api/stock-monitoring/summary
 * Obter resumo da carteira de ações
 */
export async function GET() {
  try {
    const resumo = await stockMonitoringService.getCarteiraResumo();
    
    // Calcular resultado percentual
    const resultadoPercentual = resumo.totalInvestido > 0 
      ? (resumo.resultadoTotal / resumo.totalInvestido) * 100 
      : 0;

    const summary = {
      totalInvestido: resumo.totalInvestido,
      valorAtual: resumo.valorAtual,
      resultadoTotal: resumo.resultadoTotal,
      resultadoPercentual,
      dividendosRecebidos: 0, // Seria calculado com histórico real
      dividendosProjetados: resumo.dividendosAnuais,
      yieldOnCostMedio: resumo.totalInvestido > 0 
        ? resumo.yieldCarteira 
        : 0,
      quantidadeAcoes: resumo.totalAcoes,
    };

    return NextResponse.json({ 
      success: true, 
      data: stringifyBigInt(summary)
    });
  } catch (error: any) {
    console.error('Erro ao buscar resumo:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao buscar resumo' },
      { status: 500 }
    );
  }
}
