"use client";

import { Brain, AlertCircle, ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface PredictionDataPoint {
  timestamp: string;
  realPrice: number;
  predictedPrice?: number;
  confidenceLower?: number;
  confidenceUpper?: number;
  isCorrect?: boolean;
}

interface PredictionChartProps {
  data: PredictionDataPoint[];
  symbol: string;
  timeframe: string;
  predictionHorizon?: number;
}

export default function PredictionChart({
  data,
  symbol,
  timeframe,
  predictionHorizon = 5,
}: PredictionChartProps) {
  return (
    <div className="bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-pink-500/10 border border-cyan-500/30 rounded-2xl p-12 text-center">
      <div className="flex justify-center mb-6">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center animate-pulse">
          <Brain className="w-10 h-10 text-white" />
        </div>
      </div>

      <h2 className="font-orbitron text-3xl font-bold text-white mb-4">
        Gráfico de Previsões
      </h2>
      
      <p className="text-lg text-gray-300 mb-6">
        Funcionalidade de Machine Learning
      </p>

      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 mb-8 text-left">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-lg text-yellow-400 mb-2">
              Funcionalidade em Desenvolvimento
            </h3>
            <p className="text-gray-300 mb-4">
              O gráfico de previsões mostrará:
            </p>
            <ul className="space-y-2 text-gray-400 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">•</span>
                <span>Comparação entre preço real e preço previsto</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">•</span>
                <span>Intervalo de confiança de 95%</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">•</span>
                <span>Métricas de performance (MAPE, MAE, Direção)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">•</span>
                <span>Histórico de previsões ao longo do tempo</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <Link
          href="/ml"
          className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white px-6 py-3 rounded-lg font-bold hover:from-cyan-600 hover:to-blue-600 transition-all shadow-lg"
        >
          <Brain className="w-5 h-5" />
          Saiba Mais sobre ML
        </Link>
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 bg-gray-800 border border-gray-700 text-white px-6 py-3 rounded-lg font-bold hover:bg-gray-700 transition-all"
        >
          <ArrowRight className="w-5 h-5" />
          Voltar para Dashboard
        </Link>
      </div>
    </div>
  );
}