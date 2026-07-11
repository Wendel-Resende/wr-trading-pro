import { NextRequest, NextResponse } from 'next/server';
import { StockMonitoringServiceSingleton } from '@/services/stockMonitoringService';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json();
    const { id } = await params;
    const service = StockMonitoringServiceSingleton.getInstance();

    const alert = await service.updateAlert(id, body);

    return NextResponse.json(alert);
  } catch (error) {
    console.error('Erro ao atualizar alerta:', error);
    return NextResponse.json(
      { error: 'Erro ao atualizar alerta', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const service = StockMonitoringServiceSingleton.getInstance();

    await service.deleteAlert(id);

    return NextResponse.json({ message: 'Alerta deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar alerta:', error);
    return NextResponse.json(
      { error: 'Erro ao deletar alerta', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
