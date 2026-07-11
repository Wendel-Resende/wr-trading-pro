import { NextRequest, NextResponse } from 'next/server';
import { StockMonitoringServiceSingleton } from '@/services/stockMonitoringService';
import { stringifyBigInt } from '@/lib/bigint-serializer';

const stockMonitoringService = StockMonitoringServiceSingleton.getInstance();

/**
 * POST /api/stock-monitoring/sync-prices
 * Sincronizar preços atuais das ações monitoradas com MT5
 * 
 * Este endpoint recebe as posições do frontend (que obtém do MT5)
 * e atualiza os preços dos monitoramentos correspondentes
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Receber posições do frontend
    const body = await request.json();
    const positions = body.positions as any[];

    if (!positions || !Array.isArray(positions)) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Nenhuma posição fornecida.' 
        },
        { status: 400 }
      );
    }

    // Obter todos os monitoramentos
    const stocks = await stockMonitoringService.getAll();

    if (stocks.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Nenhuma ação monitorada para sincronizar',
        data: {
          synced: 0,
          failed: 0,
          details: []
        }
      });
    }

    const results = {
      synced: 0,
      failed: 0,
      details: [] as Array<{
        symbol: string;
        oldPrice: number;
        newPrice: number;
        success: boolean;
        error?: string;
      }>
    };

    // Criar mapa de posições para busca rápida
    const positionsMap = new Map(positions.map(p => [p.symbol, p]));

    // Sincronizar cada monitoramento
    for (const stock of stocks) {
      try {
        const assetSymbol = stock.asset?.symbol;
        if (!assetSymbol) {
          continue;
        }

        // Encontrar posição correspondente
        let position = positionsMap.get(assetSymbol);
        
        // Tentar diferentes variações do símbolo
        if (!position) {
          for (const [symbol, pos] of positionsMap.entries()) {
            if (assetSymbol === symbol || 
                assetSymbol.replace('3', '') === symbol ||
                assetSymbol.replace('4', '') === symbol ||
                symbol.replace('3', '') === assetSymbol ||
                symbol.replace('4', '') === assetSymbol) {
              position = pos;
              break;
            }
          }
        }

        if (position) {
          const oldPrice = stock.precoAtual;
          const newPrice = position.priceCurrent;
          const valorInvestido = stock.valorInvestido || 0;
          const quantidade = stock.quantidadeAdquirida || 0;

          // Atualizar preço atual
          await stockMonitoringService.update(stock.id, {
            precoAtual: newPrice,
            valorCarteira: newPrice * quantidade,
            resultado: (newPrice * quantidade) - valorInvestido
          });

          results.synced++;
          results.details.push({
            symbol: assetSymbol,
            oldPrice: oldPrice || 0,
            newPrice,
            success: true
          });
        }
      } catch (error: any) {
        console.error('Erro ao sincronizar preço:', error);
        results.failed++;
        results.details.push({
          symbol: stock.asset?.symbol || 'Desconhecido',
          oldPrice: stock.precoAtual || 0,
          newPrice: stock.precoAtual || 0,
          success: false,
          error: error.message
        });
      }
    }

    return NextResponse.json(stringifyBigInt({
      success: true,
      message: `Preços sincronizados: ${results.synced} ações`,
      data: results
    }));
  } catch (error: any) {
    console.error('Erro ao sincronizar preços:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao sincronizar preços' },
      { status: 500 }
    );
  }
}
