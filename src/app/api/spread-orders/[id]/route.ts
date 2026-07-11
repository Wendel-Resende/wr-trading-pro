import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { stringifyBigInt } from '@/lib/bigint-serializer';

/**
 * PATCH /api/spread-orders/[id]
 * Atualiza status, preço executado e tickets MT5
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { status, spreadValue, mt5OrderTicket1, mt5OrderTicket2, price1, price2 } = body;

    const order = await prisma.spreadOrder.update({
      where: { id },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(spreadValue !== undefined ? { spreadValue } : {}),
        ...(price1 !== undefined ? { price1 } : {}),
        ...(price2 !== undefined ? { price2 } : {}),
        ...(mt5OrderTicket1 !== undefined ? { mt5OrderTicket1: Number(mt5OrderTicket1) } : {}),
        ...(mt5OrderTicket2 !== undefined ? { mt5OrderTicket2: Number(mt5OrderTicket2) } : {}),
        ...(status === 'FILLED' ? { filledAt: new Date() } : {}),
      },
    });

    return NextResponse.json(stringifyBigInt({ success: true, order }));
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/spread-orders/[id]
 * Cancela uma ordem específica
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.spreadOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
