"use client";

import {
  Brain,
  Clock,
  AlertCircle,
  ArrowRight,
  Home,
} from 'lucide-react';
import Link from 'next/link';

export default function MLPage() {
  return (
    <div className="min-h-screen bg-cyber-darker">
      {/* Header */}
      <header className="border-b border-cyber-border bg-cyber-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-gray-400 hover:text-white transition-colors">
                <Home className="w-6 h-6" />
              </Link>
              <div className="w-px h-6 bg-cyber-border" />
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-gradient-to-br from-cyber-pink to-cyber-purple flex items-center justify-center">
                  <Brain className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="font-orbitron text-xl font-bold text-white neon-text-cyan">
                    Machine Learning
                  </h1>
                  <p className="text-xs text-cyber-cyan/70 font-space">
                    Previsões e Modelos de IA
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="p-6">
        <div className="max-w-4xl mx-auto">
          {/* Coming Soon Banner */}
          <div className="bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-pink-500/10 border border-cyan-500/30 rounded-2xl p-12 text-center">
            <div className="flex justify-center mb-6">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center animate-pulse">
                <Brain className="w-12 h-12 text-white" />
              </div>
            </div>

            <h2 className="font-orbitron text-4xl font-bold text-white mb-4">
              Em Breve
            </h2>
            
            <p className="text-xl text-gray-300 mb-6">
              Módulo de Machine Learning e Previsões
            </p>
            
            <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 mb-8 text-left">
              <div className="flex items-start gap-3 mb-4">
                <Clock className="w-6 h-6 text-cyan-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-lg text-white mb-2">
                    Funcionalidades Planejadas
                  </h3>
                  <ul className="space-y-3 text-gray-300">
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400 mt-1">•</span>
                      <span>Previsão de preços usando modelos de Deep Learning (LSTM, Transformer)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400 mt-1">•</span>
                      <span>Classificação de tendências de mercado</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400 mt-1">•</span>
                      <span>Sinais de entrada e saída automáticos baseados em IA</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400 mt-1">•</span>
                      <span>Backtesting completo de modelos de ML</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400 mt-1">•</span>
                      <span>Monitoramento em tempo real de performance dos modelos</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400 mt-1">•</span>
                      <span>Seleção automática de melhores parâmetros (AutoML)</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-6 mb-8">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-6 h-6 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="text-left">
                  <h3 className="font-bold text-lg text-yellow-400 mb-2">
                    Status Atual
                  </h3>
                  <p className="text-gray-300">
                    Esta funcionalidade está temporariamente desativada enquanto trabalhamos em uma 
                    implementação mais robusta e eficiente. Estamos reestruturando a arquitetura 
                    para garantir melhor performance e resultados mais confiáveis.
                  </p>
                </div>
              </div>
            </div>

            <Link
              href="/"
              className="inline-flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white px-8 py-4 rounded-lg font-bold text-lg hover:from-cyan-600 hover:to-blue-600 transition-all shadow-lg"
            >
              Voltar para o Dashboard
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>

          {/* Additional Info */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 text-center">
              <Brain className="w-10 h-10 text-cyan-400 mx-auto mb-3" />
              <h3 className="font-bold text-white mb-2">Modelos ML</h3>
              <p className="text-gray-400 text-sm">
                Redes neurais LSTM, XGBoost, LightGBM e mais
              </p>
            </div>
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 text-center">
              <Clock className="w-10 h-10 text-purple-400 mx-auto mb-3" />
              <h3 className="font-bold text-white mb-2">Backtesting</h3>
              <p className="text-gray-400 text-sm">
                Validação histórica completa com múltiplos períodos
              </p>
            </div>
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 text-center">
              <AlertCircle className="w-10 h-10 text-pink-400 mx-auto mb-3" />
              <h3 className="font-bold text-white mb-2">Alertas</h3>
              <p className="text-gray-400 text-sm">
                Sinais automáticos com múltiplos níveis de confiança
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
