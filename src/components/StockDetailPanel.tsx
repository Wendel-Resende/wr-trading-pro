'use client';

import React from 'react';
import { StockMonitoring } from '@/types/stock-monitoring';

interface StockDetailPanelProps {
  stock: StockMonitoring;
  onClose: () => void;
  onViewDividends?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export default function StockDetailPanel({ stock, onClose, onViewDividends, onEdit, onDelete }: StockDetailPanelProps) {
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

  const formatNumber = (value: number | undefined) => {
    if (value === undefined || value === null) return '-';
    return new Intl.NumberFormat('pt-BR').format(value);
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

  return (
    <div className="cyber-card bg-cyber-dark/90 border border-cyber-border rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto scrollbar-cyber">
      {/* Header */}
      <div className="sticky top-0 bg-cyber-dark/95 border-b border-cyber-border p-4 z-10 backdrop-blur-sm">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold font-orbitron text-white neon-text-cyan">
              {stock.asset?.symbol}
            </h2>
            <p className="text-sm font-space text-gray-400 mt-1">
              {stock.asset?.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="mt-2 flex items-center space-x-2">
          <span className={`px-3 py-1 text-xs font-bold font-orbitron rounded-full border ${getStatusColor(stock.status)}`}>
            {stock.status}
          </span>
          <span className="text-sm font-space text-gray-400">
            {stock.stockType === 'ON' ? 'Ordinária' : 'Preferencial'}
          </span>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Preços */}
        <div className="cyber-card bg-cyber-dark/50 border border-cyber-border rounded-lg p-4">
          <h3 className="text-lg font-bold font-orbitron text-cyber-cyan neon-text-cyan mb-4">
            Preços e Posição
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Preço Atual</p>
              <p className="text-xl font-bold font-jetbrains text-white">
                {formatCurrency(stock.precoAtual)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Preço Teto</p>
              <p className="text-xl font-bold font-jetbrains text-green-400">
                {formatCurrency(stock.precoTeto)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Preço Teto Reajustado</p>
              <p className="text-xl font-bold font-jetbrains text-purple-400">
                {formatCurrency(stock.precoTetoReajustado)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Preço Médio</p>
              <p className="text-xl font-bold font-jetbrains text-white">
                {formatCurrency(stock.precoMedioCompra)}
              </p>
            </div>
          </div>
        </div>

        {/* Posição */}
        <div className="cyber-card bg-cyber-dark/50 border border-cyber-border rounded-lg p-4">
          <h3 className="text-lg font-bold font-orbitron text-cyber-pink neon-text-pink mb-4">
            Detalhes da Posição
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Quantidade</p>
              <p className="text-xl font-bold font-jetbrains text-white">
                {formatNumber(stock.quantidadeAdquirida)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Valor Investido</p>
              <p className="text-xl font-bold font-jetbrains text-white">
                {formatCurrency(stock.valorInvestido)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Valor Carteira</p>
              <p className="text-xl font-bold font-jetbrains text-white">
                {formatCurrency(stock.valorCarteira)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Participação</p>
              <p className="text-xl font-bold font-jetbrains text-cyan-400">
                {formatPercent(stock.participacaoCarteira)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Resultado</p>
              <p className={`text-xl font-bold font-jetbrains ${stock.resultado >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatCurrency(stock.resultado)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Meta de Papéis</p>
              <p className="text-xl font-bold font-jetbrains text-white">
                {formatNumber(stock.metaPapeis)}
              </p>
            </div>
          </div>
        </div>

        {/* Indicadores Fundamentalistas */}
        <div className="cyber-card bg-cyber-dark/50 border border-cyber-border rounded-lg p-4">
          <h3 className="text-lg font-bold font-orbitron text-purple-400 neon-text-purple mb-4">
            Indicadores Fundamentalistas
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">VPA</p>
              <p className="text-lg font-bold font-jetbrains text-white">
                {formatCurrency(stock.vpa)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">P/VPA</p>
              <p className="text-lg font-bold font-jetbrains text-white">
                {stock.pVpa?.toFixed(2) || '-'}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">LPA</p>
              <p className="text-lg font-bold font-jetbrains text-white">
                {formatCurrency(stock.lpa)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">P/L</p>
              <p className="text-lg font-bold font-jetbrains text-white">
                {stock.precoLucro?.toFixed(2) || '-'}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">ROE</p>
              <p className="text-lg font-bold font-jetbrains text-cyan-400">
                {formatPercent(stock.roe)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">DY Média 3 Anos</p>
              <p className="text-lg font-bold font-jetbrains text-green-400">
                {formatPercent(stock.dyMedia3Anos)}
              </p>
            </div>
          </div>
        </div>

        {/* Gatilhos de Compra */}
        <div className="cyber-card bg-cyber-dark/50 border border-cyber-border rounded-lg p-4">
          <h3 className="text-lg font-bold font-orbitron text-yellow-400 neon-text-yellow mb-4">
            Gatilhos de Compra
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Gatilho ROE</p>
              <p className="text-lg font-bold font-jetbrains text-white">
                {formatPercent(stock.gatilhoROE)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Gatilho VPA</p>
              <p className="text-lg font-bold font-jetbrains text-white">
                {formatCurrency(stock.gatilhoVPA)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Gatilho LPA</p>
              <p className="text-lg font-bold font-jetbrains text-white">
                {formatCurrency(stock.gatilhoLPA)}
              </p>
            </div>
          </div>
        </div>

        {/* Projeção de Dividendos */}
        <div className="cyber-card bg-cyber-dark/50 border border-cyber-border rounded-lg p-4">
          <h3 className="text-lg font-bold font-orbitron text-pink-400 neon-text-pink mb-4">
            Projeção de Dividendos
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Previsão Anual</p>
              <p className="text-xl font-bold font-jetbrains text-green-400">
                {formatCurrency(stock.previsaoDividendoAnual)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Yield on Cost</p>
              <p className="text-xl font-bold font-jetbrains text-purple-400">
                {formatPercent(stock.yieldOnCost)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Payout Estatuto</p>
              <p className="text-lg font-bold font-jetbrains text-white">
                {formatPercent(stock.payoutEstatuto)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Composição</p>
              <p className="text-lg font-bold font-jetbrains text-white">
                {stock.composition.toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        {/* Dados Financeiros da Empresa */}
        <div className="cyber-card bg-cyber-dark/50 border border-cyber-border rounded-lg p-4">
          <h3 className="text-lg font-bold font-orbitron text-cyan-400 neon-text-cyan mb-4">
            Dados Financeiros da Empresa
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Patrimônio Líquido</p>
              <p className="text-lg font-bold font-jetbrains text-white">
                {formatCurrency(stock.patrimonioLiquido)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Lucro Líquido</p>
              <p className="text-lg font-bold font-jetbrains text-white">
                {formatCurrency(stock.lucroLiquido)}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-xs font-bold font-orbitron text-gray-400 uppercase">Ações Emitidas</p>
              <p className="text-lg font-bold font-jetbrains text-white">
                {stock.acoesEmitidas ? formatNumber(Number(stock.acoesEmitidas)) : '-'}
              </p>
            </div>
          </div>
        </div>

        {/* Observações */}
        {stock.observacoes && (
          <div className="cyber-card bg-cyber-dark/50 border border-cyber-border rounded-lg p-4">
            <h3 className="text-lg font-bold font-orbitron text-gray-400 mb-4">
              Observações
            </h3>
            <p className="text-sm font-space text-gray-300 whitespace-pre-wrap">
              {stock.observacoes}
            </p>
          </div>
        )}

        {/* Ações */}
        <div className="flex flex-wrap gap-3 pt-4 border-t border-cyber-border">
          {onViewDividends && (
            <button
              onClick={onViewDividends}
              className="cyber-button cyber-button-primary"
            >
              Ver Calendário de Dividendos
            </button>
          )}
          {onEdit && (
            <button
              onClick={onEdit}
              className="cyber-button cyber-button-secondary"
            >
              Editar
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="cyber-button cyber-button-red"
            >
              Excluir
            </button>
          )}
        </div>

        {/* Metadados */}
        <div className="pt-4 border-t border-cyber-border">
          <p className="text-xs font-space text-gray-500">
            Criado em: {new Date(stock.createdAt).toLocaleString('pt-BR')}
          </p>
          <p className="text-xs font-space text-gray-500">
            Atualizado em: {new Date(stock.updatedAt).toLocaleString('pt-BR')}
          </p>
        </div>
      </div>
    </div>
  );
}
