import { NextRequest, NextResponse } from 'next/server';
import { StockMonitoringServiceSingleton } from '@/services/stockMonitoringService';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') as 'PORTFOLIO' | 'PERFORMANCE' | 'DIVIDENDS' | 'STATUS' | null;
    const generate = searchParams.get('generate') as 'portfolio' | 'performance' | 'dividends' | 'status' | null;

    const service = StockMonitoringServiceSingleton.getInstance();

    // Gerar relatório on-demand
    if (generate) {
      let reportData;

      switch (generate) {
        case 'portfolio':
          reportData = await service.generatePortfolioReport();
          break;
        case 'dividends':
          reportData = await service.generateDividendReport();
          break;
        case 'status':
          reportData = await service.generateStatusReport();
          break;
        case 'performance':
          // Performance report ainda precisa ser implementado
          return NextResponse.json({ error: 'Relatório de performance em desenvolvimento' }, { status: 501 });
        default:
          return NextResponse.json({ error: 'Tipo de relatório inválido' }, { status: 400 });
      }

      return NextResponse.json(reportData);
    }

    // Listar relatórios salvos
    const reports = await service.getReports({
      type: type || undefined,
    });

    return NextResponse.json(reports);
  } catch (error) {
    console.error('Erro ao buscar relatórios:', error);
    return NextResponse.json(
      { error: 'Erro ao buscar relatórios', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, type, startDate, endDate, data, generatedBy } = body;
    const service = StockMonitoringServiceSingleton.getInstance();

    // Validar campos obrigatórios
    if (!name || !type || !startDate || !endDate || !data) {
      return NextResponse.json(
        { error: 'Campos obrigatórios: name, type, startDate, endDate, data' },
        { status: 400 }
      );
    }

    const report = await service.createReport({
      name,
      type,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      data,
      generatedBy,
    });

    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    console.error('Erro ao criar relatório:', error);
    return NextResponse.json(
      { error: 'Erro ao criar relatório', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
