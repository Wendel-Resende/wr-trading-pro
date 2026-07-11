import { NextResponse } from 'next/server';
import register, { updateSystemMetrics } from '@/lib/prometheus-metrics';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Atualizar métricas do sistema antes de retornar
    updateSystemMetrics();
    
    // Obter métricas no formato Prometheus
    const metrics = await register.metrics();
    
    return new NextResponse(metrics, {
      status: 200,
      headers: {
        'Content-Type': register.contentType,
      },
    });
  } catch (error) {
    console.error('Erro ao obter métricas:', error);
    return NextResponse.json(
      { error: 'Erro ao obter métricas' },
      { status: 500 }
    );
  }
}
