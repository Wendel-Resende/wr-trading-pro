'use client';

import React, { useState, useEffect } from 'react';
import { StockMonitoring } from '@/types/stock-monitoring';
import { AlertCircle } from 'lucide-react';

interface StockMonitoringTableProps {
  statusFilter?: 'COMPRA' | 'VENDA' | 'NEUTRO' | 'ATENCAO';
  onViewDetails?: (stock: StockMonitoring) => void;
  mt5Connected?: boolean;
}

export default function StockMonitoringTable({ statusFilter, onViewDetails, mt5Connected = false }: StockMonitoringTableProps) {
  const [stocks, setStocks] = useState<StockMonitoring[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Só carregar dados se o MT5 estiver conectado
    if (mt5Connected) {
      fetchStocks();
    }
  }, [statusFilter, mt5Connected]);

  const fetchStocks = async () => {
    try {
      setLoading(true);
      const url = statusFilter
        ? `/api/stock-monitoring?status=${statusFilter}`
        : '/api/stock-monitoring';
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.success) {
        setStocks(data.data);
      } else {
        setError(data.error || 'Erro ao buscar ações');
      }
    } catch (err) {
      setError('Erro ao conectar com a API');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPRA':
        return 'bg-green-500/20 text-green-400 border-green-500/50';
      case 'VENDA':
        return 'bg-red-500/20 text-red-400 border-red-500/50';
      case 'ATENCAO':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/50';
    }
  };

  const formatCurrency = (value: number | undefined) => {
    if (value === undefined || value === null) return '-';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatPercent = (value: number | undefined) => {
    if (value === undefined || value === null) return '-';
    return `${value.toFixed(2)}%`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 font-space">Carregando...</div>
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
            Conecte-se ao MT5 para visualizar os monitoramentos de ações
          </p>
        </div>
      </div>
    );
  }

  if (stocks.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 font-space">
        Nenhuma ação monitorada encontrada
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-cyber-border">
        <thead className="bg-cyber-dark/50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
              Ação
            </th>
            <th className="px-6 py-3 text-left text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 text-right text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
              Preço Atual
            </th>
            <th className="px-6 py-3 text-right text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
              Preço Teto
            </th>
            <th className="px-6 py-3 text-right text-xs font-bold font-orbitron text-cyber-pink uppercase tracking-wider">
              Teto Reajustado
            </th>
            <th className="px-6 py-3 text-right text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
              VPA
            </th>
            <th className="px-6 py-3 text-right text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
              LPA
            </th>
            <th className="px-6 py-3 text-right text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
              P/VPA
            </th>
            <th className="px-6 py-3 text-right text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
              P/L
            </th>
            <th className="px-6 py-3 text-right text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
              ROE
            </th>
            <th className="px-6 py-3 text-right text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
              P. Médio
            </th>
            <th className="px-6 py-3 text-right text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
              Quantidade
            </th>
            <th className="px-6 py-3 text-right text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
              Valor Investido
            </th>
            <th className="px-6 py-3 text-right text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
              Invest. Necessário
            </th>
            <th className="px-6 py-3 text-right text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
              Resultado
            </th>
            <th className="px-6 py-3 text-right text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
              Yield on Cost
            </th>
            <th className="px-6 py-3 text-center text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
              Ações
            </th>
          </tr>
        </thead>
        <tbody className="bg-cyber-dark/30 divide-y divide-cyber-border">
          {stocks.map((stock) => (
            <tr key={stock.id} className="hover:bg-cyber-cyan/5 transition-colors">
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex flex-col">
                  <span className="text-sm font-bold font-orbitron text-white">
                    {stock.asset?.symbol}
                  </span>
                  <span className="text-xs text-gray-400 font-space">
                    {stock.asset?.name}
                  </span>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={`px-3 py-1 text-xs font-bold font-orbitron rounded-full border ${getStatusColor(stock.status)}`}>
                  {stock.status}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-white font-jetbrains">
                {formatCurrency(stock.precoAtual)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-white font-jetbrains">
                {formatCurrency(stock.precoTeto)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-cyber-pink font-jetbrains font-bold">
                {formatCurrency(stock.precoTetoReajustado)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-white font-jetbrains">
                {formatCurrency(stock.vpa)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-white font-jetbrains">
                {formatCurrency(stock.lpa)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-white font-jetbrains">
                {stock.pVpa ? stock.pVpa.toFixed(2) : '-'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-white font-jetbrains">
                {stock.precoLucro ? stock.precoLucro.toFixed(2) : '-'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-cyber-pink font-jetbrains font-bold">
                {stock.roe ? stock.roe.toFixed(2) + '%' : '-'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-white font-jetbrains">
                {formatCurrency(stock.precoMedioCompra)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-white font-jetbrains">
                {stock.quantidadeAdquirida}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-white font-jetbrains">
                {formatCurrency(stock.valorInvestido)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-cyber-cyan font-jetbrains">
                {formatCurrency(stock.investimentoNecessarioParaMeta)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-jetbrains">
                <span className={stock.resultado >= 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
                  {formatCurrency(stock.resultado)}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-purple-400 font-jetbrains font-bold">
                {formatPercent(stock.yieldOnCost)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-center">
                <button
                  onClick={() => onViewDetails?.(stock)}
                  className="text-cyber-cyan hover:text-cyber-pink transition-colors text-sm font-bold font-orbitron"
                  title="Ver detalhes"
                >
                  <svg className="w-5 h-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
