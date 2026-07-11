'use client';

import { useState } from 'react';
import { PortfolioReportData, DividendReportData, StatusReportData } from '@/types/stock-reports';

type ReportType = 'portfolio' | 'dividends' | 'status';

export default function StockReportsPanel() {
  const [selectedReport, setSelectedReport] = useState<ReportType | null>(null);
  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState<any>(null);

  const generateReport = async (type: ReportType) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/stock-reports?generate=${type}`);
      
      if (!res.ok) {
        throw new Error('Erro ao gerar relatório');
      }

      const data = await res.json();
      setReportData(data);
      setSelectedReport(type);
    } catch (error) {
      console.error('Erro ao gerar relatório:', error);
      alert('Erro ao gerar relatório');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatPercentage = (value: number) => {
    return `${value.toFixed(2)}%`;
  };

  return (
    <div className="cyber-card bg-cyber-dark/30 border border-cyber-border rounded-lg">
      {/* Header */}
      <div className="p-6 border-b border-cyber-border">
        <h2 className="text-xl font-bold font-orbitron text-white neon-text-cyan">📊 Relatórios</h2>
        <p className="text-sm text-gray-400 font-space mt-1">
          Gere relatórios sobre sua carteira de ações
        </p>
      </div>

      {/* Report Type Selection */}
      <div className="p-6">
        <div className="grid grid-cols-3 gap-4">
          <button
            onClick={() => generateReport('portfolio')}
            disabled={loading}
            className={`p-4 rounded-lg border-2 transition-all font-space ${
              selectedReport === 'portfolio'
                ? 'border-cyber-cyan bg-cyber-cyan/20 neon-text-cyan'
                : 'border-cyber-border bg-cyber-dark/30 hover:border-cyber-cyan/50 hover:text-white'
            } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <div className="text-3xl mb-2">💼</div>
            <div className="font-semibold font-orbitron">Carteira</div>
            <div className="text-xs text-gray-400 font-space mt-1">
              Visão geral da carteira e performance
            </div>
          </button>

          <button
            onClick={() => generateReport('dividends')}
            disabled={loading}
            className={`p-4 rounded-lg border-2 transition-all font-space ${
              selectedReport === 'dividends'
                ? 'border-green-400 bg-green-500/20 text-green-400'
                : 'border-cyber-border bg-cyber-dark/30 hover:border-green-400/50 hover:text-white'
            } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <div className="text-3xl mb-2">💵</div>
            <div className="font-semibold font-orbitron">Dividendos</div>
            <div className="text-xs text-gray-400 font-space mt-1">
              Projeção e histórico de dividendos
            </div>
          </button>

          <button
            onClick={() => generateReport('status')}
            disabled={loading}
            className={`p-4 rounded-lg border-2 transition-all font-space ${
              selectedReport === 'status'
                ? 'border-purple-400 bg-purple-500/20 text-purple-400'
                : 'border-cyber-border bg-cyber-dark/30 hover:border-purple-400/50 hover:text-white'
            } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <div className="text-3xl mb-2">📈</div>
            <div className="font-semibold font-orbitron">Status</div>
            <div className="text-xs text-gray-400 font-space mt-1">
              Sinais de compra/venda por ação
            </div>
          </button>
        </div>

        {loading && (
          <div className="mt-6 flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyber-cyan"></div>
            <span className="ml-3 text-gray-400 font-space">Gerando relatório...</span>
          </div>
        )}

        {/* Report Display */}
        {reportData && !loading && (
          <div className="mt-6">
            {selectedReport === 'portfolio' && (
              <PortfolioReport data={reportData} />
            )}
            {selectedReport === 'dividends' && (
              <DividendReport data={reportData} />
            )}
            {selectedReport === 'status' && (
              <StatusReport data={reportData} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PortfolioReport({ data }: { data: PortfolioReportData }) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatPercentage = (value: number) => {
    return `${value.toFixed(2)}%`;
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-cyber-cyan/20 p-4 rounded-lg border border-cyber-cyan/50">
          <div className="text-sm text-gray-400 font-space">Valor Atual</div>
          <div className="text-2xl font-bold font-orbitron text-cyber-cyan mt-1">
            {formatCurrency(data.totalValue)}
          </div>
        </div>
        <div className="bg-cyber-dark/50 p-4 rounded-lg border border-cyber-border">
          <div className="text-sm text-gray-400 font-space">Investido</div>
          <div className="text-2xl font-bold font-orbitron text-white mt-1">
            {formatCurrency(data.totalInvested)}
          </div>
        </div>
        <div className={`p-4 rounded-lg border ${data.totalProfit >= 0 ? 'bg-green-500/20 border-green-500/50' : 'bg-red-500/20 border-red-500/50'}`}>
          <div className="text-sm text-gray-400 font-space">Resultado</div>
          <div className={`text-2xl font-bold font-orbitron mt-1 ${data.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatCurrency(data.totalProfit)}
          </div>
          <div className={`text-sm font-space ${data.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatPercentage(data.totalProfitPercentage)}
          </div>
        </div>
        <div className="bg-purple-500/20 p-4 rounded-lg border border-purple-500/50">
          <div className="text-sm text-gray-400 font-space">Ações</div>
          <div className="text-2xl font-bold font-orbitron text-purple-400 mt-1">
            {data.stockCount}
          </div>
        </div>
      </div>

      {/* Top Performers */}
      {data.topPerformers.length > 0 && (
        <div>
          <h3 className="font-semibold font-orbitron text-lg mb-3 text-green-400">🏆 Melhores Performances</h3>
          <div className="space-y-2">
            {data.topPerformers.map((stock, idx) => (
              <div key={stock.symbol} className="flex items-center justify-between bg-green-500/20 p-3 rounded-lg border border-green-500/50">
                <div className="flex items-center gap-3">
                  <div className="font-bold font-orbitron text-green-400">#{idx + 1}</div>
                  <div className="font-semibold font-orbitron text-white">{stock.symbol}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold font-orbitron text-green-400">
                    {formatCurrency(stock.profit)}
                  </div>
                  <div className="text-sm text-green-400 font-space">
                    {formatPercentage(stock.profitPercentage)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Worst Performers */}
      {data.worstPerformers.length > 0 && (
        <div>
          <h3 className="font-semibold font-orbitron text-lg mb-3 text-red-400">⚠️ Piores Performances</h3>
          <div className="space-y-2">
            {data.worstPerformers.map((stock, idx) => (
              <div key={stock.symbol} className="flex items-center justify-between bg-red-500/20 p-3 rounded-lg border border-red-500/50">
                <div className="flex items-center gap-3">
                  <div className="font-bold font-orbitron text-red-400">#{idx + 1}</div>
                  <div className="font-semibold font-orbitron text-white">{stock.symbol}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold font-orbitron text-red-400">
                    {formatCurrency(stock.profit)}
                  </div>
                  <div className="text-sm text-red-400 font-space">
                    {formatPercentage(stock.profitPercentage)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Diversification */}
      <div>
        <h3 className="font-semibold font-orbitron text-lg mb-3 text-white">📊 Diversificação por Ação</h3>
        <div className="space-y-2">
          {data.diversification.byStock.slice(0, 10).map((stock) => (
            <div key={stock.symbol} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold font-orbitron text-white">{stock.symbol}</span>
                <div className="text-right">
                  <span className="font-orbitron text-white">{formatCurrency(stock.value)}</span>
                  <span className="text-gray-400 ml-2 font-space">
                    ({formatPercentage(stock.percentage)})
                  </span>
                </div>
              </div>
              <div className="h-2 bg-cyber-dark/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyber-cyan rounded-full transition-all"
                  style={{ width: `${stock.percentage}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DividendReport({ data }: { data: DividendReportData }) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatPercentage = (value: number) => {
    return `${value.toFixed(2)}%`;
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-green-500/20 p-4 rounded-lg border border-green-500/50">
          <div className="text-sm text-gray-400 font-space">Recebidos</div>
          <div className="text-2xl font-bold font-orbitron text-green-400 mt-1">
            {formatCurrency(data.totalReceived)}
          </div>
        </div>
        <div className="bg-cyber-cyan/20 p-4 rounded-lg border border-cyber-cyan/50">
          <div className="text-sm text-gray-400 font-space">Projetado Anual</div>
          <div className="text-2xl font-bold font-orbitron text-cyber-cyan mt-1">
            {formatCurrency(data.projectedAnnual)}
          </div>
        </div>
        <div className="bg-purple-500/20 p-4 rounded-lg border border-purple-500/50">
          <div className="text-sm text-gray-400 font-space">Yield Carteira</div>
          <div className="text-2xl font-bold font-orbitron text-purple-400 mt-1">
            {formatPercentage(data.dividendYield)}
          </div>
        </div>
      </div>

      {/* By Stock */}
      {data.byStock.length > 0 && (
        <div>
          <h3 className="font-semibold font-orbitron text-lg mb-3 text-white">💵 Dividendos por Ação</h3>
          <div className="overflow-x-auto bg-cyber-dark/30 rounded-lg border border-cyber-border">
            <table className="w-full">
              <thead>
                <tr className="bg-cyber-dark/50 border-b border-cyber-border">
                  <th className="px-4 py-2 text-left font-semibold font-orbitron text-white">Ação</th>
                  <th className="px-4 py-2 text-right font-semibold font-orbitron text-white">Projetado</th>
                  <th className="px-4 py-2 text-right font-semibold font-orbitron text-white">Yield</th>
                </tr>
              </thead>
              <tbody>
                {data.byStock.map((stock) => (
                  <tr key={stock.symbol} className="border-b border-cyber-border">
                    <td className="px-4 py-3 font-semibold font-orbitron text-white">{stock.symbol}</td>
                    <td className="px-4 py-3 text-right font-orbitron text-gray-300">
                      {formatCurrency(stock.projected)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold font-orbitron ${stock.yield >= 6 ? 'text-green-400' : 'text-gray-300'}`}>
                        {formatPercentage(stock.yield)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* By Month */}
      {data.byMonth.length > 0 && (
        <div>
          <h3 className="font-semibold font-orbitron text-lg mb-3 text-white">📅 Dividendos por Mês</h3>
          <div className="grid grid-cols-6 gap-3">
            {data.byMonth.map((month) => (
              <div key={month.month} className="bg-cyber-dark/50 p-3 rounded-lg text-center border border-cyber-border">
                <div className="text-sm font-semibold font-orbitron text-white">{month.month}</div>
                <div className="text-lg font-bold font-orbitron text-cyber-cyan mt-1">
                  {formatCurrency(month.total)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusReport({ data }: { data: StatusReportData }) {
  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-cyber-dark/50 p-4 rounded-lg border border-cyber-border">
          <div className="text-sm text-gray-400 font-space">Total de Ações</div>
          <div className="text-2xl font-bold font-orbitron text-white mt-1">
            {data.totalStocks}
          </div>
        </div>
        <div className="bg-green-500/20 p-4 rounded-lg border border-green-500/50">
          <div className="text-sm text-gray-400 font-space">Sinais de Compra</div>
          <div className="text-2xl font-bold font-orbitron text-green-400 mt-1">
            {data.buySignals}
          </div>
        </div>
        <div className="bg-red-500/20 p-4 rounded-lg border border-red-500/50">
          <div className="text-sm text-gray-400 font-space">Sinais de Venda</div>
          <div className="text-2xl font-bold font-orbitron text-red-400 mt-1">
            {data.sellSignals}
          </div>
        </div>
        <div className="bg-yellow-500/20 p-4 rounded-lg border border-yellow-500/50">
          <div className="text-sm text-gray-400 font-space">Atenção</div>
          <div className="text-2xl font-bold font-orbitron text-yellow-400 mt-1">
            {data.attention}
          </div>
        </div>
      </div>

      {/* By Status */}
      {data.byStatus.map((status) => (
        status.count > 0 && (
          <div key={status.status} className="space-y-3">
            <h3 className="font-semibold font-orbitron text-lg flex items-center gap-2 text-white">
              {status.status === 'COMPRA' && '📈'}
              {status.status === 'VENDA' && '📉'}
              {status.status === 'NEUTRO' && '😐'}
              {status.status === 'ATENCAO' && '⚠️'}
              {status.status}: {status.count} ({status.percentage.toFixed(1)}%)
            </h3>
            <div className="space-y-2">
              {status.stocks.map((stock) => (
                <div key={stock.symbol} className="flex items-center justify-between bg-cyber-dark/50 p-3 rounded-lg border border-cyber-border">
                  <div>
                    <div className="font-semibold font-orbitron text-white">{stock.symbol}</div>
                    <div className="text-sm text-gray-400 font-space">{stock.name}</div>
                  </div>
                  <div className="text-right">
                    {stock.recommendation !== 'NEUTRO' && (
                      <div className={`text-xs px-2 py-1 rounded-full font-space ${
                        stock.recommendation === 'COMPRA' ? 'bg-green-500/20 text-green-400' :
                        stock.recommendation === 'VENDA' ? 'bg-red-500/20 text-red-400' :
                        'bg-cyber-dark/50 text-gray-400'
                      }`}>
                        {stock.recommendation}
                      </div>
                    )}
                    <div className="text-sm text-gray-300 font-space mt-1">
                      R$ {stock.currentPrice.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ))}

      {/* Alert Count */}
      {(data.alertCount.critical > 0 || data.alertCount.warning > 0) && (
        <div className="bg-yellow-500/20 p-4 rounded-lg border border-yellow-500/50">
          <h3 className="font-semibold font-orbitron text-yellow-400 mb-2">⚠️ Alertas Ativos</h3>
          <div className="flex gap-4">
            {data.alertCount.critical > 0 && (
              <div className="text-red-400 font-space">
                <span className="font-bold">{data.alertCount.critical}</span> críticos
              </div>
            )}
            {data.alertCount.warning > 0 && (
              <div className="text-yellow-400 font-space">
                <span className="font-bold">{data.alertCount.warning}</span> avisos
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
