import { NextRequest, NextResponse } from 'next/server';
import { StockMonitoringServiceSingleton } from '@/services/stockMonitoringService';
import { AssetServiceSingleton } from '@/services/assetService';
import { StockMonitoringInput } from '@/types/stock-monitoring';
import { stringifyBigInt } from '@/lib/bigint-serializer';

const stockMonitoringService = StockMonitoringServiceSingleton.getInstance();
const assetService = AssetServiceSingleton.getInstance();

/**
 * GET /api/stock-monitoring
 * Listar todos os monitoramentos de ações
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let stocks;

    if (status && ['COMPRA', 'VENDA', 'NEUTRO', 'ATENCAO'].includes(status)) {
      stocks = await stockMonitoringService.getByStatus(status as any);
    } else {
      stocks = await stockMonitoringService.getAll();
    }

    return NextResponse.json({ success: true, data: stringifyBigInt(stocks) });
  } catch (error: any) {
    console.error('Erro ao buscar monitoramentos:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao buscar monitoramentos' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/stock-monitoring
 * Criar novo monitoramento de ação
 */
export async function POST(request: NextRequest) {
  try {
    const body: StockMonitoringInput = await request.json();

    // Validações básicas
    if (!body.assetId) {
      return NextResponse.json(
        { success: false, error: 'Código da ação é obrigatório' },
        { status: 400 }
      );
    }

    if (!body.stockType || !['ON', 'PN'].includes(body.stockType)) {
      return NextResponse.json(
        { success: false, error: 'stockType deve ser ON ou PN' },
        { status: 400 }
      );
    }

    // Buscar ou criar o ativo baseado no código digitado
    const asset = await assetService.getOrCreate(
      body.assetId.toUpperCase(), // código da ação (ex: PETR4, VALE3)
      body.assetId.toUpperCase(), // nome (usar o código como nome inicial)
      'STOCK', // tipo
      'B3' // exchange
    );

    // Substituir assetId pelo ID real do ativo
    const stockInput = {
      ...body,
      assetId: asset.id,
    };

    const stock = await stockMonitoringService.create(stockInput);

    return NextResponse.json(
      { success: true, data: stringifyBigInt(stock) },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Erro ao criar monitoramento:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao criar monitoramento' },
      { status: 500 }
    );
  }
}
