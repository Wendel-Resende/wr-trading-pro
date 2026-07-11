import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { symbol, days = 365 } = body;

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: 'Símbolo não fornecido' },
        { status: 400 }
      );
    }

    // Fazer requisição para a API Python
    const pythonApiUrl = 'http://localhost:5555/api/volatility';
    
    try {
      const response = await fetch(pythonApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ symbol, days }),
        // Timeout de 30 segundos para cálculo de volatilidade
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorData = await response.json();
        return NextResponse.json(
          { 
            success: false, 
            error: errorData.error || 'Erro ao calcular volatilidade' 
          },
          { status: response.status }
        );
      }

      const data = await response.json();
      return NextResponse.json(data);

    } catch (error: any) {
      console.error('Erro ao conectar com API Python:', error);
      
      return NextResponse.json(
        { 
          success: false, 
          error: 'Não foi possível conectar com o serviço de volatilidade. Verifique se o servidor Python está rodando na porta 5555.' 
        },
        { status: 500 }
      );
    }

  } catch (error: any) {
    console.error('Erro no endpoint de volatilidade:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
