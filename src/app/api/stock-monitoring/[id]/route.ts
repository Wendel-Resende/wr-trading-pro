import { NextRequest, NextResponse } from 'next/server';
import { StockMonitoringServiceSingleton } from '@/services/stockMonitoringService';
import { StockMonitoringUpdate } from '@/types/stock-monitoring';

const stockMonitoringService = StockMonitoringServiceSingleton.getInstance();

/**
 * GET /api/stock-monitoring/[id]
 * Buscar monitoramento por ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const stock = await stockMonitoringService.getById(id);

    if (!stock) {
      return NextResponse.json(
        { success: false, error: 'Monitoramento não encontrado' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: stock });
  } catch (error: any) {
    console.error('Erro ao buscar monitoramento:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao buscar monitoramento' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/stock-monitoring/[id]
 * Atualizar monitoramento existente
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body: StockMonitoringUpdate = await request.json();
    const { id } = await params;

    const stock = await stockMonitoringService.update(id, body);

    return NextResponse.json({ success: true, data: stock });
  } catch (error: any) {
    console.error('Erro ao atualizar monitoramento:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao atualizar monitoramento' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/stock-monitoring/[id]
 * Deletar monitoramento
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await stockMonitoringService.delete(id);

    return NextResponse.json(
      { success: true, message: 'Monitoramento deletado com sucesso' }
    );
  } catch (error: any) {
    console.error('Erro ao deletar monitoramento:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao deletar monitoramento' },
      { status: 500 }
    );
  }
}
