import { NextRequest, NextResponse } from 'next/server';
import { StockMonitoringServiceSingleton } from '@/services/stockMonitoringService';
import { StockAlertInput } from '@/types/stock-alerts';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    const type = searchParams.get('type') as 'PRICE' | 'DIVIDEND' | 'STATUS' | 'PORTFOLIO' | null;
    const severity = searchParams.get('severity') as 'INFO' | 'WARNING' | 'CRITICAL' | null;
    const stockId = searchParams.get('stockId');
    const summary = searchParams.get('summary') === 'true';

    const service = StockMonitoringServiceSingleton.getInstance();

    // Retornar resumo
    if (summary) {
      const alertSummary = await service.getAlertSummary();
      return NextResponse.json(alertSummary);
    }

    // Retornar alertas por stock
    if (stockId) {
      const alerts = await service.getAlertsByStock(stockId);
      return NextResponse.json(alerts);
    }

    // Retornar todos os alertas com filtros
    const alerts = await service.getAllAlerts({
      unreadOnly,
      type: type || undefined,
      severity: severity || undefined,
    });

    return NextResponse.json(alerts);
  } catch (error) {
    console.error('Erro ao buscar alertas:', error);
    return NextResponse.json(
      { error: 'Erro ao buscar alertas', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const service = StockMonitoringServiceSingleton.getInstance();

    const alert = await service.createAlert(body);

    return NextResponse.json(alert, { status: 201 });
  } catch (error) {
    console.error('Erro ao criar alerta:', error);
    return NextResponse.json(
      { error: 'Erro ao criar alerta', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { markAllRead } = body;

    const service = StockMonitoringServiceSingleton.getInstance();

    if (markAllRead) {
      await service.markAllAlertsAsRead();
      return NextResponse.json({ message: 'Todos os alertas marcados como lidos' });
    }

    return NextResponse.json({ error: 'Operação não suportada' }, { status: 400 });
  } catch (error) {
    console.error('Erro ao atualizar alertas:', error);
    return NextResponse.json(
      { error: 'Erro ao atualizar alertas', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
