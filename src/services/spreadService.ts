/**
 * Serviço para análise de Spread entre ações da B3
 * Usa API Python para análise de dados
 */

import {
  SpreadConfig,
  SpreadResult,
  SpreadOpportunity,
  SpreadMetrics,
  SpreadPairAnalysis,
  SpreadRanking,
  SpreadDataPoint,
  PARES_SUGERIDOS
} from '@/types/spread';

// URL da API Python de spread
const SPREAD_API_URL = 'http://localhost:5000/api/spread';

class SpreadCalculator {
  /**
   * Verifica se a API está funcionando
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${SPREAD_API_URL}/health`);
      const result = await response.json();
      return result.status === 'ok' && result.mt5_initialized;
    } catch (error) {
      console.error('[SPREAD_API] Erro ao verificar saúde da API:', error);
      return false;
    }
  }

  /**
   * Calcula spread entre dois ativos usando a API Python
   */
  async calcularSpread(config: SpreadConfig): Promise<SpreadResult | null> {
    try {
      console.log(`[SPREAD_API] Calculando spread para ${config.symbol1}-${config.symbol2}`);

      const requestBody = {
        symbol1: config.symbol1,
        symbol2: config.symbol2,
        data_inicial: config.startDate.toISOString().split('T')[0],
        data_final: config.endDate.toISOString().split('T')[0],
        ganho_minimo: config.ganhoMinimo
      };

      const response = await fetch(`${SPREAD_API_URL}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();

      if (!result.success) {
        console.error(`[SPREAD_API] Erro na resposta:`, result.error);
        return null;
      }

      const data = result.data;
      console.log(`[SPREAD_API] Dados recebidos:`, data);

      // Converte oportunidades do formato Python para TypeScript
      const oportunidades: SpreadOpportunity[] = data.oportunidades.map((op: any) => ({
        dataEntrada: new Date(op.data_entrada),
        dataSaida: new Date(op.data_saida),
        precoVendaA1: op.preco_venda_a1,
        precoCompraB1: op.preco_compra_b1,
        precoVendaB2: op.preco_venda_b2,
        precoCompraA2: op.preco_compra_a2,
        ganho: op.ganho,
        volumeMedioA: op.volume_medio_a,
        volumeMedioB: op.volume_medio_b,
        retornoPercentual: op.retorno_percentual
      }));

      // Cria arrays de dados históricos (simplificado - podemos melhorar depois)
      const hist1: SpreadDataPoint[] = [];
      const hist2: SpreadDataPoint[] = [];
      const spread: number[] = [];

      // Cria spread array baseado nas oportunidades
      oportunidades.forEach(op => {
        spread.push(Math.abs(op.precoVendaA1 - op.precoCompraB1));
      });

      return {
        hist1,
        hist2,
        spread,
        oportunidades,
        currentPrice1: data.current_price1,
        currentPrice2: data.current_price2,
        symbol1: config.symbol1,
        symbol2: config.symbol2,
        oportunidadesPorMes: data.oportunidades_por_mes
      };
    } catch (error) {
      console.error('[SPREAD_API] Erro ao calcular spread:', error);
      return null;
    }
  }

  /**
   * Encontra os melhores pares para arbitragem usando a API Python
   */
  async encontrarMelhoresPares(
    startDate: Date,
    endDate: Date,
    ganhoMinimo: number = 0.10
  ): Promise<SpreadPairAnalysis[]> {
    try {
      console.log(`[SPREAD_API] Buscando melhores pares (ganho_minimo: ${ganhoMinimo})`);

      const requestBody = {
        data_inicial: startDate.toISOString().split('T')[0],
        data_final: endDate.toISOString().split('T')[0],
        ganho_minimo: ganhoMinimo
      };

      const response = await fetch(`${SPREAD_API_URL}/find-best-pairs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();

      if (!result.success) {
        console.error('[SPREAD_API] Erro na resposta:', result.error);
        return [];
      }

      console.log(`[SPREAD_API] ${result.data.length} pares analisados`);

      // Converte resultados do formato Python para TypeScript
      const melhoresPares: SpreadPairAnalysis[] = result.data.map((data: any) => ({
        par: data.par,
        oportunidades: data.oportunidades,
        maiorGanho: data.maior_ganho,
        melhorRetorno: data.melhor_retorno,
        spreadAtual: data.spread_atual,
        currentPrice1: data.current_price1,
        currentPrice2: data.current_price2,
        symbol1: data.symbol1,
        symbol2: data.symbol2,
        ideal: data.ideal,
        classificacaoOperacional: data.classificacao_operacional,
        score: data.score,
        motivos: data.motivos,
        sinal: data.sinal,
        direcaoEntrada: data.direcao_entrada,
        periodos: data.periodos,
        correlacao: data.correlacao,
        correlacaoPrecos: data.correlacao_precos,
        correlacaoRetornos: data.correlacao_retornos,
        zscore: data.zscore,
        spreadMedio: data.spread_medio,
        desvioSpread: data.desvio_spread,
        spreadAtualAssinado: data.spread_atual_assinado,
        halfLife: data.half_life,
        cruzamentosMedia: data.cruzamentos_media
      }));

      console.log(`[SPREAD_API] Pares com oportunidades: ${melhoresPares.length}`);

      return melhoresPares;
    } catch (error) {
      console.error('[SPREAD_API] Erro ao buscar melhores pares:', error);
      return [];
    }
  }

  /**
   * Calcula métricas estatísticas das oportunidades
   */
  calcularMetrics(resultado: SpreadResult): SpreadMetrics {
    if (resultado.oportunidades.length === 0) {
      return {
        ganhoMedio: 0,
        retornoMedio: 0,
        spreadAtual: Math.abs(resultado.currentPrice1 - resultado.currentPrice2),
        totalOportunidades: 0,
        maiorGanho: 0,
        melhorRetorno: 0
      };
    }

    const totalGanho = resultado.oportunidades.reduce(
      (sum, op) => sum + op.ganho,
      0
    );
    const totalRetorno = resultado.oportunidades.reduce(
      (sum, op) => sum + op.retornoPercentual,
      0
    );

    const ganhoMedio = totalGanho / resultado.oportunidades.length;
    const retornoMedio = totalRetorno / resultado.oportunidades.length;
    const spreadAtual = Math.abs(resultado.currentPrice1 - resultado.currentPrice2);
    const maiorGanho = Math.max(
      ...resultado.oportunidades.map(op => op.ganho)
    );
    const melhorRetorno = Math.max(
      ...resultado.oportunidades.map(op => op.retornoPercentual)
    );

    return {
      ganhoMedio,
      retornoMedio,
      spreadAtual,
      totalOportunidades: resultado.oportunidades.length,
      maiorGanho,
      melhorRetorno
    };
  }

  /**
   * Cria ranking dos melhores pares
   */
  async criarRanking(
    startDate: Date,
    endDate: Date,
    ganhoMinimo: number = 0.10
  ): Promise<SpreadRanking> {
    const pares = await this.encontrarMelhoresPares(
      startDate,
      endDate,
      ganhoMinimo
    );

    return this.criarRankingDePares(pares);
  }

  criarRankingDePares(pares: SpreadPairAnalysis[]): SpreadRanking {
    const paresComOportunidades = pares.filter(p => p.oportunidades > 0);
    const paresIdeais = pares.filter(p =>
      p.classificacaoOperacional === 'Ideal Forte'
      || p.classificacaoOperacional === 'Ideal Limite'
      || p.ideal
    );

    const rankingScore = [...(paresIdeais.length > 0 ? paresIdeais : pares)]
      .sort((a, b) => {
        const rank = (pair: SpreadPairAnalysis) => {
          if (pair.classificacaoOperacional === 'Ideal Forte') return 3;
          if (pair.classificacaoOperacional === 'Ideal Limite') return 2;
          if (pair.classificacaoOperacional === 'Acompanhar') return 1;
          return 0;
        };

        return rank(b) - rank(a) || (b.score ?? 0) - (a.score ?? 0);
      })
      .slice(0, 5);

    // Ranking por maior ganho
    const rankingGanho = [...paresComOportunidades]
      .sort((a, b) => b.maiorGanho - a.maiorGanho)
      .slice(0, 5);

    // Ranking por melhor retorno
    const rankingRetorno = [...paresComOportunidades]
      .sort((a, b) => b.melhorRetorno - a.melhorRetorno)
      .slice(0, 5);

    // Ranking por mais oportunidades
    const rankingOportunidades = [...paresComOportunidades]
      .sort((a, b) => b.oportunidades - a.oportunidades)
      .slice(0, 5);

    return {
      rankingScore,
      rankingGanho,
      rankingRetorno,
      rankingOportunidades
    };
  }

  /**
   * Obtém todos os pares analisados (com ou sem oportunidades)
   */
  async obterTodosPares(
    startDate: Date,
    endDate: Date,
    ganhoMinimo: number = 0.10
  ): Promise<SpreadPairAnalysis[]> {
    return this.encontrarMelhoresPares(startDate, endDate, ganhoMinimo);
  }
}

// Exporta instância única do serviço
export const spreadService = new SpreadCalculator();
