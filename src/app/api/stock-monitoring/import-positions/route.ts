import { NextRequest, NextResponse } from 'next/server';
import { StockMonitoringServiceSingleton } from '@/services/stockMonitoringService';
import { AssetServiceSingleton } from '@/services/assetService';

const stockMonitoringService = StockMonitoringServiceSingleton.getInstance();
const assetService = AssetServiceSingleton.getInstance();

/**
 * POST /api/stock-monitoring/import-positions
 * Importar posições do MT5 para monitoramento
 * 
 * Este endpoint recebe as posições do frontend (que obtém do MT5) 
 * e as processa para criar monitoramentos
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Receber posições do frontend
    const body = await request.json();
    const positions = body.positions as any[];

    if (!positions || !Array.isArray(positions) || positions.length === 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Nenhuma posição fornecida. Certifique-se de estar conectado ao MT5.' 
        },
        { status: 400 }
      );
    }

    // Obter monitoramentos existentes para evitar duplicatas
    const existingStocks = await stockMonitoringService.getAll();
    const monitoredSymbols = new Set(
      existingStocks
        .filter(s => s.asset?.symbol)
        .map(s => s.asset?.symbol)
    );

    const results = {
      imported: 0,
      skipped: 0,
      failed: 0,
      details: [] as Array<{
        symbol: string;
        volume: number;
        priceOpen: number;
        success: boolean;
        error?: string;
      }>
    };

    // Processar cada posição recebida
    for (const position of positions) {
      try {
        const symbol = position.symbol;

        // Verificar se já está sendo monitorado
        if (monitoredSymbols.has(symbol)) {
          results.skipped++;
          results.details.push({
            symbol,
            volume: position.volume,
            priceOpen: position.priceOpen,
            success: false,
            error: 'Já monitorado'
          });
          continue;
        }

        // Buscar ou criar ativo no sistema
        const asset = await assetService.getOrCreate(
          symbol,
          symbol, // nome inicial pode ser atualizado depois
          'STOCK',
          'B3'
        );

        if (!asset) {
          console.error('Falha ao obter/criar ativo para símbolo:', symbol);
          throw new Error('Falha ao obter/criar ativo para ' + symbol);
        }

        console.log('Ativo obtido/criado:', { id: asset.id, symbol: asset.symbol });

        // Determinar tipo de ação (ON ou PN) com base no símbolo
        const stockType: 'ON' | 'PN' = symbol.endsWith('3') ? 'ON' : 
                                            symbol.endsWith('4') ? 'PN' : 'ON';

        // Criar novo monitoramento
        const valorInvestido = position.volume * position.priceOpen;
        const quantidadeAdquirida = Math.floor(position.volume);
        const precoMedioCompra = valorInvestido / quantidadeAdquirida;

        const newStock = await stockMonitoringService.create({
          assetId: asset.id,
          stockType: stockType,
          composition: 100, // Padrão
          metaPapeis: quantidadeAdquirida,
          quantidadeAdquirida: quantidadeAdquirida,
          precoMedioCompra: precoMedioCompra,
          valorInvestido: valorInvestido,
          valorCarteira: position.priceCurrent * position.volume,
          resultado: position.profit || 0,
          precoAtual: position.priceCurrent,
          status: 'NEUTRO' // Status inicial
        });

        results.imported++;
        results.details.push({
          symbol,
          volume: position.volume,
          priceOpen: position.priceOpen,
          success: true
        });

        monitoredSymbols.add(symbol);
      } catch (error: any) {
        console.error('Erro ao importar posição:', error);
        results.failed++;
        results.details.push({
          symbol: position.symbol,
          volume: position.volume,
          priceOpen: position.priceOpen,
          success: false,
          error: error.message
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Importação concluída: ${results.imported} importadas, ${results.skipped} puladas, ${results.failed} falhas`,
      data: results
    });
  } catch (error: any) {
    console.error('Erro ao importar posições:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao importar posições' },
      { status: 500 }
    );
  }
}
