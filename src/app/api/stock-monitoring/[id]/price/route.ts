import { NextRequest, NextResponse } from 'next/server';
import { StockMonitoringServiceSingleton } from '@/services/stockMonitoringService';

const stockMonitoringService = StockMonitoringServiceSingleton.getInstance();

/**
 * PUT /api/stock-monitoring/[id]/price
 * Atualizar preço atual de uma ação
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json();
    const { precoAtual } = body;
    const { id } = await params;

    if (typeof precoAtual !== 'number' || precoAtual <= 0) {
      return NextResponse.json(
        { success: false, error: 'precoAtual deve ser um número positivo' },
        { status: 400 }
      );
    }

    const stock = await stockMonitoringService.updatePrecoAtual(id, precoAtual);

    return NextResponse.json({ success: true, data: stock });
  } catch (error: any) {
    console.error('Erro ao atualizar preço:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao atualizar preço' },
      { status: 500 }
    );
  }
}
