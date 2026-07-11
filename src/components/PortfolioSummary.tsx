'use client';

import React, { useState, useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface CarteiraResumo {
  totalInvestido: number;
  valorAtual: number;
  resultadoTotal: number;
  resultadoPercentual: number;
  dividendosRecebidos: number;
  dividendosProjetados: number;
  yieldOnCostMedio: number;
  quantidadeAcoes: number;
}

interface PortfolioSummaryProps {
  mt5Connected?: boolean;
  onSyncPrices?: () => void;
}

export default function PortfolioSummary({ mt5Connected = false, onSyncPrices }: PortfolioSummaryProps) {
  const [summary, setSummary] = useState<CarteiraResumo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Só carregar dados se o MT5 estiver conectado
    if (mt5Connected) {
      fetchSummary();
    }
  }, [mt5Connected]);

  const fetchSummary = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/stock-monitoring/summary');
      const data = await response.json();
      
      if (data.success) {
        setSummary(data.data);
      } else {
        setError(data.error || 'Erro ao buscar resumo da carteira');
      }
    } catch (err) {
      setError('Erro ao conectar com a API');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatPercent = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '0.00%';
    return `${value.toFixed(2)}%`;
  };

  // Se o MT5 não estiver conectado, não exibir dados
  if (!mt5Connected) {
    return (
      <div className="flex items-center justify-center h-64 border-2 border-dashed border-cyber-border/30 rounded-lg bg-cyber-dark/20">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-gray-500 mx-auto mb-3" />
          <p className="text-gray-400 font-orbitron font-bold mb-1">
            Dados Privados
          </p>
          <p className="text-gray-500 font-space text-sm">
            Conecte-se ao MT5 para visualizar as informações da carteira
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 font-space">Carregando resumo...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded">
        {error}
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

      {/* Total Investido */}
      <div className="cyber-card bg-cyber-dark/50 border border-cyber-border rounded-lg p-4 hud-corner">
        <h3 className="text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider mb-2">
          Total Investido
        </h3>
        <p className="text-2xl font-bold font-orbitron text-white neon-text-cyan">
          {formatCurrency(summary.totalInvestido)}
        </p>
      </div>

      {/* Valor Atual */}
      <div className="cyber-card bg-cyber-dark/50 border border-cyber-border rounded-lg p-4 hud-corner">
        <h3 className="text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider mb-2">
          Valor Atual
        </h3>
        <p className="text-2xl font-bold font-orbitron text-white neon-text-cyan">
          {formatCurrency(summary.valorAtual)}
        </p>
      </div>

      {/* Resultado Total */}
      <div className="cyber-card bg-cyber-dark/50 border border-cyber-border rounded-lg p-4 hud-corner">
        <h3 className="text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider mb-2">
          Resultado Total
        </h3>
        <div className="flex items-center space-x-2">
          <p className={`text-2xl font-bold font-orbitron ${summary.resultadoTotal >= 0 ? 'text-green-400 neon-text-green' : 'text-red-400 neon-text-red'}`}>
            {formatCurrency(summary.resultadoTotal)}
          </p>
          <span className={`text-sm font-bold font-jetbrains ${summary.resultadoTotal >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            ({formatPercent(summary.resultadoPercentual)})
          </span>
        </div>
      </div>

      {/* Quantidade de Ações */}
      <div className="cyber-card bg-cyber-dark/50 border border-cyber-border rounded-lg p-4 hud-corner">
        <h3 className="text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider mb-2">
          Ações na Carteira
        </h3>
        <p className="text-2xl font-bold font-orbitron text-white neon-text-cyan">
          {summary.quantidadeAcoes}
        </p>
      </div>

      {/* Dividendos Recebidos */}
      <div className="cyber-card bg-cyber-dark/50 border border-cyber-border rounded-lg p-4 hud-corner">
        <h3 className="text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider mb-2">
          Dividendos Recebidos
        </h3>
        <p className="text-2xl font-bold font-orbitron text-green-400 neon-text-green">
          {formatCurrency(summary.dividendosRecebidos)}
        </p>
      </div>

      {/* Dividendos Projetados */}
      <div className="cyber-card bg-cyber-dark/50 border border-cyber-border rounded-lg p-4 hud-corner">
        <h3 className="text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider mb-2">
          Dividendos Projetados (Anual)
        </h3>
        <p className="text-2xl font-bold font-orbitron text-cyan-400 neon-text-cyan">
          {formatCurrency(summary.dividendosProjetados)}
        </p>
      </div>

      {/* Yield on Cost Médio */}
      <div className="cyber-card bg-cyber-dark/50 border border-cyber-border rounded-lg p-4 hud-corner">
        <h3 className="text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider mb-2">
          Yield on Cost Médio
        </h3>
        <p className="text-2xl font-bold font-orbitron text-purple-400 neon-text-purple">
          {formatPercent(summary.yieldOnCostMedio)}
        </p>
      </div>

      {/* Meta Mensal */}
      <div className="cyber-card bg-cyber-dark/50 border border-cyber-border rounded-lg p-4 hud-corner">
        <h3 className="text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider mb-2">
          Meta Mensal de Dividendos
        </h3>
        <p className="text-2xl font-bold font-orbitron text-pink-400 neon-text-pink">
          {formatCurrency(summary.dividendosProjetados / 12)}
        </p>
      </div>
    </div>
  );
}
