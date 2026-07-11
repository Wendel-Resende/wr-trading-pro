import { NextRequest, NextResponse } from 'next/server';
import { StockMonitoringServiceSingleton } from '@/services/stockMonitoringService';
import { DividendMapInput } from '@/types/stock-monitoring';

const stockMonitoringService = StockMonitoringServiceSingleton.getInstance();

/**
 * PUT /api/dividend-map/[id]
 * Atualizar mapa de dividendos existente
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body: Partial<DividendMapInput> = await request.json();
    const { id } = await params;

    const dividendMap = await stockMonitoringService.updateDividendMap(
      id,
      body
    );

    return NextResponse.json({ success: true, data: dividendMap });
  } catch (error: any) {
    console.error('Erro ao atualizar mapa de dividendos:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao atualizar mapa de dividendos' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/dividend-map/[id]
 * Deletar mapa de dividendos
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await stockMonitoringService.deleteDividendMap(id);

    return NextResponse.json(
      { success: true, message: 'Mapa de dividendos deletado com sucesso' }
    );
  } catch (error: any) {
    console.error('Erro ao deletar mapa de dividendos:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao deletar mapa de dividendos' },
      { status: 500 }
    );
  }
}
