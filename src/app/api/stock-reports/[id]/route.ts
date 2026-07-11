import { NextRequest, NextResponse } from 'next/server';
import { StockMonitoringServiceSingleton } from '@/services/stockMonitoringService';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const service = StockMonitoringServiceSingleton.getInstance();

    const report = await service.getReportById(id);

    if (!report) {
      return NextResponse.json({ error: 'Relatório não encontrado' }, { status: 404 });
    }

    return NextResponse.json(report);
  } catch (error) {
    console.error('Erro ao buscar relatório:', error);
    return NextResponse.json(
      { error: 'Erro ao buscar relatório', details: error instanceof Error ? error.message : String(error) },
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

    await service.deleteReport(id);

    return NextResponse.json({ message: 'Relatório deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar relatório:', error);
    return NextResponse.json(
      { error: 'Erro ao deletar relatório', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
