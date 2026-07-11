import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { stringifyBigInt } from '@/lib/bigint-serializer';

/**
 * GET /api/spread-orders
 * Lista ordens de spread, opcionalmente filtradas por status (?status=PENDING)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const status = searchParams.get('status');

    const where = status ? { status } : {};

    const orders = await prisma.spreadOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    // Buscar ativos relacionados em lote
    const assetIds = [...new Set([...orders.map(o => o.assetId1), ...orders.map(o => o.assetId2)])];
    const assets = await prisma.asset.findMany({ where: { id: { in: assetIds } } });
    const assetMap = Object.fromEntries(assets.map(a => [a.id, a]));

    const ordersWithAssets = orders.map(order => ({
      ...order,
      asset1: assetMap[order.assetId1] ?? null,
      asset2: assetMap[order.assetId2] ?? null,
    }));

    const total = await prisma.spreadOrder.count({ where });

    return NextResponse.json(stringifyBigInt({
      success: true,
      data: ordersWithAssets,
      meta: { total, limit, offset },
    }));
  } catch (error) {
    console.error('Erro ao buscar ordens de spread:', error);
    return NextResponse.json(
      { error: 'Erro ao buscar ordens de spread', details: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/spread-orders
 * Cria uma ordem de spread (PENDING ou FILLED)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      symbol1,
      symbol2,
      type1,
      type2,
      quantity1,
      quantity2,
      price1,
      price2,
      spreadValue,
      status = 'PENDING',
      isAutomated = false,
      automationTarget = null,
      automationCondition = null,
      mt5OrderTicket1 = null,
      mt5OrderTicket2 = null,
    } = body;

    if (!symbol1 || !symbol2 || !type1 || !type2 || !quantity1 || !quantity2) {
      return NextResponse.json({ error: 'Campos obrigatórios faltando' }, { status: 400 });
    }

    // Buscar ou criar ativos
    let asset1 = await prisma.asset.findUnique({ where: { symbol: symbol1 } });
    if (!asset1) {
      asset1 = await prisma.asset.create({
        data: { symbol: symbol1, name: symbol1, type: 'STOCK', exchange: 'B3' },
      });
    }

    let asset2 = await prisma.asset.findUnique({ where: { symbol: symbol2 } });
    if (!asset2) {
      asset2 = await prisma.asset.create({
        data: { symbol: symbol2, name: symbol2, type: 'STOCK', exchange: 'B3' },
      });
    }

    const spreadOrder = await prisma.spreadOrder.create({
      data: {
        assetId1: asset1.id,
        assetId2: asset2.id,
        type1,
        type2,
        quantity1,
        quantity2,
        price1: price1 ?? 0,
        price2: price2 ?? 0,
        spreadValue: spreadValue ?? (price1 != null && price2 != null ? price1 - price2 : 0),
        status,
        isAutomated,
        automationTarget,
        automationCondition,
        filledAt: status === 'FILLED' ? new Date() : null,
        mt5OrderTicket1,
        mt5OrderTicket2,
      },
    });

    return NextResponse.json(stringifyBigInt({
      success: true,
      data: { ...spreadOrder, asset1, asset2 },
    }));
  } catch (error) {
    console.error('Erro ao salvar ordem de spread:', error);
    return NextResponse.json(
      { error: 'Erro ao salvar ordem de spread', details: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 }
    );
  }
}

