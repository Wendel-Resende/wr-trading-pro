'use client';

import React, { useState, useEffect } from 'react';
import { DividendMap } from '@/types/stock-monitoring';

interface DividendMapCalendarProps {
  stockId: string;
  year?: number;
}

export default function DividendMapCalendar({ stockId, year: initialYear }: DividendMapCalendarProps) {
  const [year, setYear] = useState(initialYear || new Date().getFullYear());
  const [dividendMap, setDividendMap] = useState<DividendMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDividendMap();
  }, [stockId, year]);

  const fetchDividendMap = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`/api/dividend-map?stockId=${stockId}&ano=${year}`);
      const data = await response.json();
      
      if (data.success && data.data) {
        setDividendMap(data.data);
      } else {
        setDividendMap(null);
      }
    } catch (err) {
      setError('Erro ao buscar mapa de dividendos');
    } finally {
      setLoading(false);
    }
  };

  const months = [
    { key: 'jan', name: 'Jan' },
    { key: 'fev', name: 'Fev' },
    { key: 'mar', name: 'Mar' },
    { key: 'abr', name: 'Abr' },
    { key: 'mai', name: 'Mai' },
    { key: 'jun', name: 'Jun' },
    { key: 'jul', name: 'Jul' },
    { key: 'ago', name: 'Ago' },
    { key: 'set', name: 'Set' },
    { key: 'out', name: 'Out' },
    { key: 'nov', name: 'Nov' },
    { key: 'dez', name: 'Dez' },
  ];

  const getMonthIntensity = (value: number) => {
    if (!value || value === 0) return 'bg-gray-800/50 border border-gray-700/50';
    if (value < 1) return 'bg-green-500/20 border border-green-500/50';
    if (value < 2) return 'bg-green-500/40 border border-green-500/60';
    if (value < 3) return 'bg-green-500/60 border border-green-500/80';
    return 'bg-green-500/80 border border-green-500';
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  return (
    <div className="space-y-4">
      {/* Seletor de Ano */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium font-orbitron text-white neon-text-cyan">Calendário de Dividendos</h3>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setYear(year - 1)}
            className="p-2 hover:bg-cyber-cyan/10 rounded-full transition-colors"
          >
            <svg className="w-5 h-5 text-cyber-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-lg font-semibold font-orbitron text-white w-16 text-center">{year}</span>
          <button
            onClick={() => setYear(year + 1)}
            className="p-2 hover:bg-cyber-cyan/10 rounded-full transition-colors"
          >
            <svg className="w-5 h-5 text-cyber-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-32">
          <div className="text-gray-400 font-space">Carregando...</div>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {!loading && !error && dividendMap && (
        <div className="cyber-card bg-cyber-dark/30 border border-cyber-border rounded-lg p-4">
          {/* Grid de Meses */}
          <div className="grid grid-cols-12 gap-1 mb-4">
            {months.map((month) => (
              <div
                key={month.key}
                className={`${getMonthIntensity(dividendMap[month.key as keyof DividendMap] as number)} 
                           p-2 text-center rounded cursor-pointer hover:opacity-80 transition-opacity
                           min-h-[60px] flex flex-col justify-center items-center`}
                title={`${month.name}: ${formatCurrency(dividendMap[month.key as keyof DividendMap] as number)}`}
              >
                <span className="text-xs font-bold font-orbitron text-white">{month.name}</span>
                <span className="text-sm font-semibold text-white font-jetbrains">
                  {dividendMap[month.key as keyof DividendMap] as number > 0
                    ? formatCurrency(dividendMap[month.key as keyof DividendMap] as number)
                    : '-'}
                </span>
              </div>
            ))}
          </div>

          {/* Resumo Anual */}
          <div className="flex justify-between items-center pt-4 border-t border-cyber-border">
            <div className="flex items-center space-x-4">
              <div>
                <span className="text-sm font-bold font-orbitron text-gray-400">Total Anual:</span>
                <span className="ml-2 text-lg font-bold font-orbitron text-green-400 neon-text-green">
                  {formatCurrency(dividendMap.total)}
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-sm font-bold font-orbitron text-gray-400">Média Mensal:</span>
              <span className="ml-2 text-sm font-medium font-jetbrains text-green-400">
                {formatCurrency(dividendMap.total / 12)}
              </span>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && !dividendMap && (
        <div className="text-center py-8 text-gray-400 bg-cyber-dark/20 border border-cyber-border rounded-lg font-space">
          <p>Nenhum mapa de dividendos encontrado para {year}</p>
        </div>
      )}

      {/* Legenda */}
      <div className="flex items-center justify-center space-x-4 text-sm font-space text-gray-400">
        <div className="flex items-center">
          <div className="w-4 h-4 bg-gray-800/50 border border-gray-700/50 rounded mr-2"></div>
          <span>Sem dividendos</span>
        </div>
        <div className="flex items-center">
          <div className="w-4 h-4 bg-green-500/20 border border-green-500/50 rounded mr-2"></div>
          <span>{'< R$ 1,00'}</span>
        </div>
        <div className="flex items-center">
          <div className="w-4 h-4 bg-green-500/40 border border-green-500/60 rounded mr-2"></div>
          <span>R$ 1,00 - R$ 2,00</span>
        </div>
        <div className="flex items-center">
          <div className="w-4 h-4 bg-green-500/60 border border-green-500/80 rounded mr-2"></div>
          <span>R$ 2,00 - R$ 3,00</span>
        </div>
        <div className="flex items-center">
          <div className="w-4 h-4 bg-green-500/80 border border-green-500 rounded mr-2"></div>
          <span>{'> R$ 3,00'}</span>
        </div>
      </div>
    </div>
  );
}
