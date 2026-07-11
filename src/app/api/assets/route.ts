import { NextRequest, NextResponse } from 'next/server';
import { AssetServiceSingleton } from '@/services/assetService';
import { stringifyBigInt } from '@/lib/bigint-serializer';

const assetService = AssetServiceSingleton.getInstance();

/**
 * GET /api/assets
 * Listar todos os ativos
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const exchange = searchParams.get('exchange');

    let assets;

    if (type && exchange) {
      // Filtro por tipo e exchange
      assets = await assetService.getByType(type as any);
      assets = assets.filter(a => a.exchange === exchange);
    } else if (type) {
      // Filtro por tipo
      assets = await assetService.getByType(type as any);
    } else if (exchange) {
      // Filtro por exchange
      assets = await assetService.getByExchange(exchange);
    } else {
      // Todos os ativos
      assets = await assetService.getAll();
    }

    return NextResponse.json({ success: true, data: stringifyBigInt(assets) });
  } catch (error: any) {
    console.error('Erro ao buscar ativos:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao buscar ativos' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/assets
 * Criar novo ativo
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validações básicas
    if (!body.symbol) {
      return NextResponse.json(
        { success: false, error: 'symbol é obrigatório' },
        { status: 400 }
      );
    }

    if (!body.name) {
      return NextResponse.json(
        { success: false, error: 'name é obrigatório' },
        { status: 400 }
      );
    }

    if (!body.type) {
      return NextResponse.json(
        { success: false, error: 'type é obrigatório (STOCK, ETF, CRYPTO, FOREX)' },
        { status: 400 }
      );
    }

    if (!body.exchange) {
      return NextResponse.json(
        { success: false, error: 'exchange é obrigatório' },
        { status: 400 }
      );
    }

    const asset = await assetService.create({
      symbol: body.symbol.toUpperCase(),
      name: body.name,
      type: body.type,
      exchange: body.exchange,
    });

    return NextResponse.json(
      { success: true, data: stringifyBigInt(asset) },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Erro ao criar ativo:', error);
    
    // Verifica se é erro de duplicidade (símbolo único)
    if (error.code === 'P2002') {
      return NextResponse.json(
        { success: false, error: 'Já existe um ativo com este símbolo' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao criar ativo' },
      { status: 500 }
    );
  }
}
