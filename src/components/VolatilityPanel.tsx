"use client";

import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, AlertCircle, RefreshCw, Zap } from 'lucide-react';

interface VolatilityData {
  symbol: string;
  monthlyVolatility: number;
  annualVolatility: number;
  monthlyStdDev: number;
  annualStdDev: number;
  lastUpdate: string;
}

export default function VolatilityPanel() {
  const [symbol, setSymbol] = useState('');
  const [volatilityData, setVolatilityData] = useState<VolatilityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentSymbols, setRecentSymbols] = useState<string[]>([]);

  // Carregar símbolos recentes do localStorage
  useEffect(() => {
    const saved = localStorage.getItem('volatility_recent_symbols');
    if (saved) {
      setRecentSymbols(JSON.parse(saved));
    }
  }, []);

  const formatPercent = (value: number) => {
    return `${value.toFixed(2)}%`;
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR');
  };

  const getVolatilityLevel = (volatility: number) => {
    if (volatility < 10) return { level: 'Baixa', color: 'text-green-400', bg: 'bg-green-500/20', border: 'border-green-500/50' };
    if (volatility < 20) return { level: 'Moderada', color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500/50' };
    if (volatility < 30) return { level: 'Alta', color: 'text-orange-400', bg: 'bg-orange-500/20', border: 'border-orange-500/50' };
    return { level: 'Muito Alta', color: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500/50' };
  };

  const handleSearch = async (selectedSymbol?: string) => {
    const searchSymbol = selectedSymbol || symbol.trim().toUpperCase();
    
    if (!searchSymbol) {
      setError('Digite um símbolo para análise');
      return;
    }

    setLoading(true);
    setError(null);
    setVolatilityData(null);

    try {
      const response = await fetch('/api/volatility', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ symbol: searchSymbol }),
      });

      const result = await response.json();

      if (result.success) {
        setVolatilityData(result.data);
        setSymbol(searchSymbol);
        
        // Adicionar aos símbolos recentes
        const newRecent = [searchSymbol, ...recentSymbols.filter(s => s !== searchSymbol)].slice(0, 5);
        setRecentSymbols(newRecent);
        localStorage.setItem('volatility_recent_symbols', JSON.stringify(newRecent));
      } else {
        setError(result.error || 'Erro ao calcular volatilidade');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao conectar com a API');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch();
  };

  return (
    <div className="cyber-card p-4 hud-corner">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-purple-400" />
        <h2 className="text-lg font-bold font-orbitron text-white neon-text-purple">
          Monitoramento de Volatilidade
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="Digite o símbolo (ex: VALE3)"
            className="flex-1 bg-cyber-dark border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-pink focus:outline-none focus:ring-1 focus:ring-cyber-pink transition-colors"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !symbol.trim()}
            className={`cyber-button cyber-button-primary flex items-center gap-2 ${
              loading ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Calculando...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Analisar
              </>
            )}
          </button>
        </div>
      </form>

      {recentSymbols.length > 0 && !volatilityData && (
        <div className="mb-4">
          <p className="text-xs text-gray-400 font-space mb-2">
            Símbolos recentes:
          </p>
          <div className="flex flex-wrap gap-2">
            {recentSymbols.map((sym) => (
              <button
                key={sym}
                onClick={() => handleSearch(sym)}
                className="cyber-badge text-xs hover:bg-cyber-pink/20 hover:border-cyber-pink/50 transition-colors"
              >
                {sym}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg mb-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="font-space">{error}</span>
          </div>
        </div>
      )}

      {volatilityData && (
        <div className="space-y-4">
          <div className={`p-4 rounded-lg border ${getVolatilityLevel(volatilityData.annualVolatility).bg} ${getVolatilityLevel(volatilityData.annualVolatility).border}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400 font-space mb-1">
                  Nível de Volatilidade (Anual)
                </p>
                <p className={`text-2xl font-bold font-orbitron ${getVolatilityLevel(volatilityData.annualVolatility).color}`}>
                  {getVolatilityLevel(volatilityData.annualVolatility).level}
                </p>
              </div>
              <Activity className={`w-12 h-12 ${getVolatilityLevel(volatilityData.annualVolatility).color}`} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-cyber-dark/30 border border-cyber-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-bold font-orbitron text-gray-400">
                  Volatilidade Mensal
                </h3>
              </div>
              <p className="text-3xl font-bold font-orbitron text-cyan-400 neon-text-cyan">
                {formatPercent(volatilityData.monthlyVolatility)}
              </p>
              <p className="text-xs text-gray-500 font-space mt-1">
                Desvio Padrão: {formatPercent(volatilityData.monthlyStdDev)}
              </p>
            </div>

            <div className="bg-cyber-dark/30 border border-cyber-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-5 h-5 text-pink-400" />
                <h3 className="text-sm font-bold font-orbitron text-gray-400">
                  Volatilidade Anual
                </h3>
              </div>
              <p className="text-3xl font-bold font-orbitron text-pink-400 neon-text-pink">
                {formatPercent(volatilityData.annualVolatility)}
              </p>
              <p className="text-xs text-gray-500 font-space mt-1">
                Desvio Padrão: {formatPercent(volatilityData.annualStdDev)}
              </p>
            </div>
          </div>

          <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm font-space">
              <div>
                <p className="text-gray-400 mb-1">Símbolo</p>
                <p className="font-bold text-white">{volatilityData.symbol}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-1">Última Atualização</p>
                <p className="font-bold text-white">{formatDateTime(volatilityData.lastUpdate)}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-1">Fonte</p>
                <p className="font-bold text-white">Pandas-TA</p>
              </div>
            </div>
          </div>

          <div className="bg-cyber-dark/30 border border-cyber-border rounded-lg p-4">
            <h4 className="text-sm font-bold font-orbitron text-cyber-cyan mb-2">
              Como Interpretar
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-space text-gray-400">
              <div>
                <p className="font-bold text-green-400 mb-1">Volatilidade Baixa (menor que 10%):</p>
                <p>Ativo estável, movimentos de preço pequenos</p>
              </div>
              <div>
                <p className="font-bold text-yellow-400 mb-1">Volatilidade Moderada (10-20%):</p>
                <p>Movimentos de preço moderados</p>
              </div>
              <div>
                <p className="font-bold text-orange-400 mb-1">Volatilidade Alta (20-30%):</p>
                <p>Movimentos de preço significativos</p>
              </div>
              <div>
                <p className="font-bold text-red-400 mb-1">Volatilidade Muito Alta (maior que 30%):</p>
                <p>Movimentos de preço muito voláteis</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {!volatilityData && !error && !loading && (
        <div className="bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-pink-500/10 border border-cyan-500/30 rounded-lg p-6 text-center">
          <Activity className="w-16 h-16 text-cyan-400 mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-bold font-orbitron text-white mb-2">
            Monitoramento de Volatilidade
          </h3>
          <p className="text-sm text-gray-400 font-space mb-4">
            Digite o símbolo de um ativo para calcular a volatilidade mensal e anual usando análise técnica
          </p>
          <div className="bg-cyber-dark/50 rounded-lg p-4 text-left max-w-md mx-auto">
            <p className="text-xs text-gray-400 font-space mb-2">
              <strong className="text-cyan-400">Exemplos:</strong>
            </p>
            <div className="flex flex-wrap gap-2">
              {['VALE3', 'PETR4', 'ITUB4', 'BBAS3', 'WEGE3'].map((sym) => (
                <button
                  key={sym}
                  onClick={() => handleSearch(sym)}
                  className="cyber-badge text-xs hover:bg-cyber-pink/20 hover:border-cyber-pink/50 transition-colors"
                >
                  {sym}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
