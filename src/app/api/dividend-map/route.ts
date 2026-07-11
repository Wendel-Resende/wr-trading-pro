import { NextRequest, NextResponse } from 'next/server';
import { StockMonitoringServiceSingleton } from '@/services/stockMonitoringService';
import { DividendMapInput } from '@/types/stock-monitoring';

const stockMonitoringService = StockMonitoringServiceSingleton.getInstance();

/**
 * GET /api/dividend-map?stockId=xxx
 * Buscar mapa de dividendos por stockId
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const stockId = searchParams.get('stockId');
    const ano = searchParams.get('ano');

    if (!stockId) {
      return NextResponse.json(
        { success: false, error: 'stockId é obrigatório' },
        { status: 400 }
      );
    }

    if (ano) {
      // Buscar mapa específico por ano
      const dividendMap = await stockMonitoringService.getDividendMap(
        stockId,
        parseInt(ano)
      );
      return NextResponse.json({ success: true, data: dividendMap });
    } else {
      // Listar todos os mapas do stock
      const dividendMaps = await stockMonitoringService.getDividendMapsByStock(stockId);
      return NextResponse.json({ success: true, data: dividendMaps });
    }
  } catch (error: any) {
    console.error('Erro ao buscar mapa de dividendos:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao buscar mapa de dividendos' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/dividend-map
 * Criar novo mapa de dividendos
 */
export async function POST(request: NextRequest) {
  try {
    const body: DividendMapInput = await request.json();

    // Validações básicas
    if (!body.stockId) {
      return NextResponse.json(
        { success: false, error: 'stockId é obrigatório' },
        { status: 400 }
      );
    }

    if (!body.ano) {
      return NextResponse.json(
        { success: false, error: 'ano é obrigatório' },
        { status: 400 }
      );
    }

    const dividendMap = await stockMonitoringService.createDividendMap(body);

    return NextResponse.json(
      { success: true, data: dividendMap },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Erro ao criar mapa de dividendos:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao criar mapa de dividendos' },
      { status: 500 }
    );
  }
}