/**
 * Serviço de comunicação com o sistema de Machine Learning
 */
import { 
  MLModelConfig, 
  MLTrainingConfig, 
  MLTrainingResult,
  MLBacktestResult,
  AssetScore,
  PricePrediction,
  TrendPrediction,
  VolatilityPrediction,
  MLSystemStatus
} from '@/types/ml';

// URLs do servidor ML
const ML_API_URL = process.env.NEXT_PUBLIC_ML_API_URL || 'http://127.0.0.1:8767';

export class MLService {
  /**
   * Verifica se o servidor ML está online
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    const response = await fetch(`${ML_API_URL}/health`);
    if (!response.ok) {
      throw new Error('Servidor ML não está respondendo');
    }
    return response.json();
  }

  /**
   * Obtém símbolos disponíveis
   */
  async getAvailableSymbols(): Promise<string[]> {
    const response = await fetch(`${ML_API_URL}/api/ml/symbols`);
    if (!response.ok) {
      throw new Error('Erro ao obter símbolos disponíveis');
    }
    const data = await response.json();
    return data.symbols;
  }

  /**
   * Obtém timeframes disponíveis
   */
  async getAvailableTimeframes(): Promise<string[]> {
    const response = await fetch(`${ML_API_URL}/api/ml/timeframes`);
    if (!response.ok) {
      throw new Error('Erro ao obter timeframes disponíveis');
    }
    const data = await response.json();
    return data.timeframes;
  }

  /**
   * Lista todos os modelos treinados
   */
  async listModels(): Promise<any[]> {
    const response = await fetch(`${ML_API_URL}/api/ml/models`);
    if (!response.ok) {
      throw new Error('Erro ao listar modelos');
    }
    const data = await response.json();
    return data.models;
  }

  /**
   * Obtém detalhes de um modelo específico
   */
  async getModelDetails(modelId: string): Promise<any> {
    const response = await fetch(`${ML_API_URL}/api/ml/models/${modelId}`);
    if (!response.ok) {
      throw new Error('Erro ao obter detalhes do modelo');
    }
    const data = await response.json();
    return data.model;
  }

  /**
   * Inicia o treinamento de um novo modelo
   */
  async trainModel(config: MLTrainingConfig): Promise<{
    success: boolean;
    model_id: string;
    message: string;
    status: string;
    process_id: number;
  }> {
    const response = await fetch(`${ML_API_URL}/api/ml/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: config.symbol,
        timeframe: config.timeframe,
        model_type: config.modelType || 'price_predictor',
        epochs: config.epochs || 100,
        sequence_length: config.sequenceLength || 100,
        prediction_horizon: config.predictionHorizon || 5,
      }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Erro ao iniciar treinamento: ${error}`);
    }
    return response.json();
  }

  /**
   * Obtém status do treinamento atual
   */
  async getTrainingStatus(): Promise<{
    success: boolean;
    status: 'idle' | 'training' | 'completed';
    message: string;
    process_id?: number;
  }> {
    const response = await fetch(`${ML_API_URL}/api/ml/training-status`);
    if (!response.ok) {
      throw new Error('Erro ao obter status do treinamento');
    }
    return response.json();
  }

  /**
   * Retreina um modelo existente
   */
  async retrainModel(modelId: string): Promise<{
    success: boolean;
    message: string;
    status: string;
    process_id: number;
  }> {
    const response = await fetch(`${ML_API_URL}/api/ml/models/${modelId}/retrain`, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Erro ao retreinar modelo: ${error}`);
    }
    return response.json();
  }

  /**
   * Executa backtest de um modelo
   */
  async runBacktest(modelId: string): Promise<{
    success: boolean;
    backtest_results: {
      total_trades: number;
      winning_trades: number;
      losing_trades: number;
      win_rate: number;
      total_profit: number;
      total_loss: number;
      net_profit: number;
      profit_factor: number;
      max_drawdown: number;
      sharpe_ratio: number;
      avg_trade: number;
      start_date: string;
      end_date: string;
    };
  }> {
    const response = await fetch(`${ML_API_URL}/api/ml/models/${modelId}/backtest`, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Erro ao executar backtest: ${error}`);
    }
    return response.json();
  }

  // Métodos removidos - endpoints não implementados na API
  // async deleteModel(), async exportModel(), async getTrainingHistory(), etc.
}

// Instância singleton do serviço
export const mlService = new MLService();

// Funções helper para uso rápido
export const mlUtils = {
  /**
   * Formata confiança como porcentagem
   */
  formatConfidence(confidence: number): string {
    return `${(confidence * 100).toFixed(1)}%`;
  },

  /**
   * Formata direção
   */
  formatDirection(direction: 'bullish' | 'bearish' | 'neutral'): string {
    const map = {
      bullish: '🐂 Alta',
      bearish: '🐻 Baixa',
      neutral: '⏸️ Neutro'
    };
    return map[direction];
  },

  /**
   * Formata nível de risco
   */
  formatRiskLevel(level: 'low' | 'medium' | 'high' | 'extreme'): string {
    const map = {
      low: '🟢 Baixo',
      medium: '🟡 Médio',
      high: '🟠 Alto',
      extreme: '🔴 Extremo'
    };
    return map[level];
  },

  /**
   * Formata recomendação
   */
  formatRecommendation(rec: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell'): string {
    const map = {
      strong_buy: '🚀 COMPRA FORTE',
      buy: '✅ COMPRA',
      hold: '⏸️ MANTER',
      sell: '⛔ VENDA',
      strong_sell: '💥 VENDA FORTE'
    };
    return map[rec];
  },

  /**
   * Retorna cor baseada na confiança
   */
  getConfidenceColor(confidence: number): string {
    if (confidence >= 0.8) return 'text-green-500';
    if (confidence >= 0.6) return 'text-yellow-500';
    return 'text-red-500';
  },

  /**
   * Retorna cor baseada na direção
   */
  getDirectionColor(direction: 'bullish' | 'bearish' | 'neutral'): string {
    if (direction === 'bullish') return 'text-green-500';
    if (direction === 'bearish') return 'text-red-500';
    return 'text-gray-500';
  },

  /**
   * Calcula score geral baseado em múltiplos fatores
   */
  calculateOverallScore(scores: {
    trend: number;
    momentum: number;
    volatility: number;
    sentiment: number;
    pattern: number;
    prediction: number;
  }): number {
    const weights = {
      trend: 0.25,
      momentum: 0.20,
      volatility: 0.15,
      sentiment: 0.20,
      pattern: 0.10,
      prediction: 0.10
    };

    return Object.entries(scores).reduce((acc, [key, value]) => {
      return acc + (value * weights[key as keyof typeof weights]);
    }, 0);
  },

  /**
   * Determina recomendação baseada no score
   */
  getRecommendation(score: number): 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell' {
    if (score >= 80) return 'strong_buy';
    if (score >= 65) return 'buy';
    if (score >= 35) return 'hold';
    if (score >= 20) return 'sell';
    return 'strong_sell';
  }
};
