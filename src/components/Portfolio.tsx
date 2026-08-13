"use client";

import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { Position } from '@/types';
import { mt5Service } from '@/services/mt5Service';
import { MT5Position, MT5AccountInfo } from '@/types/mt5';

const COLORS = ['#ff00ff', '#00ffff', '#9d00ff', '#0066ff', '#ff6b6b', '#4ecdc4'];

interface PortfolioProps {
  positions?: Position[];
}

export default function Portfolio({ positions = [] }: PortfolioProps) {
  const [selectedView, setSelectedView] = useState<'positions' | 'allocation'>('positions');
  const [mt5Positions, setMt5Positions] = useState<MT5Position[]>([]);
  const [accountInfo, setAccountInfo] = useState<MT5AccountInfo | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [initialDailyBalance, setInitialDailyBalance] = useState(0);

  useEffect(() => {
    // Carregar dados do cache inicialmente
    const cachedPositions = mt5Service.getPositionsCache();
    const cachedAccountInfo = mt5Service.getConnectionState().accountInfo;
    if (cachedPositions.length > 0) {
      setMt5Positions(cachedPositions);
      setIsConnected(true);
    }
    if (cachedAccountInfo) {
      setAccountInfo(cachedAccountInfo);
    }

    // Escutar eventos de posição do MT5
    const handlePosition = (position: MT5Position) => {
      setMt5Positions(prev => {
        const index = prev.findIndex(p => p.ticket === position.ticket);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = position;
          return updated;
        }
        return [...prev, position];
      });
    };

    const handlePositionClosed = (ticket: number) => {
      console.log('Portfolio: Posição fechada, ticket:', ticket);
      setMt5Positions(prev => prev.filter(p => p.ticket !== ticket));
    };

    const handleStateChange = (state: any) => {
      setIsConnected(state.state === 'CONNECTED');
      if (state.state === 'CONNECTED') {
        // Solicitar posições ao conectar
        mt5Service.getPositions();
        // Usar as informações da conta se disponíveis no estado
        if (state.accountInfo) {
          setAccountInfo(state.accountInfo);
          setInitialDailyBalance(mt5Service.getInitialDailyBalance());
        }
      } else if (state.state === 'DISCONNECTED') {
        setMt5Positions([]);
        setAccountInfo(null);
      }
    };

    mt5Service.on('position', handlePosition);
    mt5Service.on('state', handleStateChange);
    mt5Service.on('positionClosed', handlePositionClosed);

    // Se já estiver conectado, solicitar dados
    const currentState = mt5Service.getConnectionState();
    if (currentState.state === 'CONNECTED') {
      setIsConnected(true);
      mt5Service.getPositions();
      if (currentState.accountInfo) {
        setAccountInfo(currentState.accountInfo);
        setInitialDailyBalance(mt5Service.getInitialDailyBalance());
      }
    }

    return () => {
      mt5Service.off('position', handlePosition);
      mt5Service.off('state', handleStateChange);
      mt5Service.off('positionClosed', handlePositionClosed);
    };
  }, []);

  // Usar posições do MT5 se conectado e tiver dados
  const displayPositions = isConnected && mt5Positions.length > 0
    ? (() => {
        // Consolidar posições por símbolo
        const consolidated: { [key: string]: {
          symbol: string;
          totalVolume: number;
          totalCost: number;
          totalProfit: number;
          currentPrice: number;
          tickets: number[];
        } } = {};

        mt5Positions.forEach(pos => {
          const symbol = pos.symbol;
          const volume = pos.volume || 0;
          const priceOpen = pos.priceOpen || 0;
          const priceCurrent = pos.priceCurrent || 0;
          const profit = pos.profit || 0;

          if (!consolidated[symbol]) {
            consolidated[symbol] = {
              symbol,
              totalVolume: 0,
              totalCost: 0,
              totalProfit: 0,
              currentPrice: priceCurrent,
              tickets: [],
            };
          }

          consolidated[symbol].totalVolume += volume;
          consolidated[symbol].totalCost += volume * priceOpen;
          consolidated[symbol].totalProfit += profit;
          consolidated[symbol].currentPrice = priceCurrent;
          consolidated[symbol].tickets.push(pos.ticket);
        });

        return Object.values(consolidated).map(cons => {
          const avgPrice = cons.totalVolume > 0 ? cons.totalCost / cons.totalVolume : 0;

          return {
            id: cons.symbol,
            assetId: cons.symbol,
            asset: {
              id: cons.symbol,
              symbol: cons.symbol,
              name: cons.symbol,
              type: 'STOCK',
              exchange: 'MT5',
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            quantity: cons.totalVolume,
            avgPrice: avgPrice,
            currentPrice: cons.currentPrice,
            pnl: cons.totalProfit,
            status: 'OPEN',
            openedAt: new Date(),
          };
        });
      })()
    : [];

  const totalValue = accountInfo?.equity || displayPositions.reduce((sum, pos) => sum + (pos.quantity * pos.currentPrice), 0);
  const totalPnL = displayPositions.reduce((sum, pos) => sum + pos.pnl, 0);
  const totalPnLPercent = accountInfo && accountInfo.balance > 0 
    ? ((accountInfo.equity - accountInfo.balance) / accountInfo.balance) * 100
    : (totalPnL / (totalValue - totalPnL)) * 100;

  const allocationData = displayPositions.map(pos => ({
    name: pos.asset?.symbol || 'Unknown',
    value: pos.quantity * pos.currentPrice,
    pnl: pos.pnl,
  }));

  return (
    <div className="cyber-card p-4 hud-corner">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="font-orbitron text-lg font-bold text-white neon-text-purple">
            Portfólio
          </h2>
          {isConnected && (
            <span className="cyber-badge text-xs bg-green-500/20 text-green-400 border-green-500/50">
              MT5
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedView('positions')}
            className={`cyber-badge text-sm ${
              selectedView === 'positions'
                ? 'bg-cyber-purple/20 text-cyber-purple border-cyber-purple'
                : 'bg-cyber-dark text-gray-400 border-cyber-border'
            }`}
          >
            Posições
          </button>
          <button
            onClick={() => setSelectedView('allocation')}
            className={`cyber-badge text-sm ${
              selectedView === 'allocation'
                ? 'bg-cyber-purple/20 text-cyber-purple border-cyber-purple'
                : 'bg-cyber-dark text-gray-400 border-cyber-border'
            }`}
          >
            Alocação
          </button>
        </div>
      </div>

      {!isConnected ? (
        <div className="text-center py-8 mb-6">
          <p className="text-gray-400 font-space">Conecte-se ao MT5 para ver o portfólio</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-cyber-dark/50 p-3 rounded border border-cyber-border">
              <p className="text-xs text-gray-400 font-space mb-1">Valor Total</p>
              <p className="font-orbitron text-lg font-bold text-white">
                R$ {totalValue.toFixed(2)}
              </p>
              <p className="text-xs text-gray-500 font-space">
                {accountInfo ? `(Saldo: R$ ${accountInfo.balance.toFixed(2)})` : ''}
              </p>
            </div>
            <div className="bg-cyber-dark/50 p-3 rounded border border-cyber-border">
              <p className="text-xs text-gray-400 font-space mb-1">P&L Total</p>
              <p className={`font-orbitron text-lg font-bold ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {totalPnL >= 0 ? '+' : ''}R$ {totalPnL.toFixed(2)}
              </p>
              <p className="text-xs text-gray-500 font-space">
                Em posições
              </p>
            </div>
          </div>

          {/* Daily Result Card */}
          {accountInfo && (
            <div className="bg-gradient-to-r from-cyber-purple/20 to-cyber-pink/20 p-4 rounded-lg border border-cyber-purple/50 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-300 font-space mb-1">Resultado Diário</p>
                  <div className="flex items-baseline gap-2">
                    <p className={`font-orbitron text-2xl font-bold ${accountInfo.equity - accountInfo.balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {accountInfo.equity - accountInfo.balance >= 0 ? '+' : ''}R$ {(accountInfo.equity - accountInfo.balance).toFixed(2)}
                    </p>
                    <p className={`text-sm font-bold ${totalPnLPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ({totalPnLPercent >= 0 ? '+' : ''}{totalPnLPercent.toFixed(2)}%)
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400 font-space mb-1">Saldo Inicial</p>
                  <p className="font-orbitron text-lg font-bold text-white">
                    R$ {initialDailyBalance.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Positions View */}
      {selectedView === 'positions' && (
        <div className="space-y-2 max-h-80 overflow-y-auto scrollbar-cyber">
          {!isConnected ? (
            <div className="text-center py-12">
              <p className="text-gray-400 font-space">Conecte-se ao MT5 para ver as posições</p>
            </div>
          ) : mt5Positions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400 font-space">Nenhuma posição aberta</p>
            </div>
          ) : (
            displayPositions.map((position) => {
              const isPositive = position.pnl >= 0;
              const positionValue = position.quantity * position.currentPrice;
              const positionPercent = (positionValue / totalValue) * 100;

              return (
                <div
                  key={position.id || `${position.asset?.symbol}-${position.openedAt}`}
                  className="flex items-center justify-between p-3 bg-cyber-dark/50 rounded border border-cyber-border hover:border-cyber-purple/50 transition-colors"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-bold font-orbitron text-white">
                        {position.asset?.symbol}
                      </p>
                      <span className="text-xs text-gray-400 font-space">
                        {position.quantity} lotes
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-gray-400 font-space">
                        PM: R$ {position.avgPrice.toFixed(2)}
                      </span>
                      <span className="text-cyber-cyan font-space">
                        Atual: R$ {position.currentPrice.toFixed(2)}
                      </span>
                      <span className="text-gray-400 font-space">
                        {positionPercent.toFixed(1)}% do portfólio
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-jetbrains text-white">
                      R$ {positionValue.toFixed(2)}
                    </p>
                    <p className={`text-sm font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                      {isPositive ? '+' : ''}R$ {position.pnl.toFixed(2)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Allocation View */}
      {selectedView === 'allocation' && (
        <div className="space-y-4">
          {!isConnected ? (
            <div className="text-center py-12">
              <p className="text-gray-400 font-space">Conecte-se ao MT5 para ver a alocação</p>
            </div>
          ) : mt5Positions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400 font-space">Nenhuma posição para alocar</p>
            </div>
          ) : (
            <>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={allocationData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(entry) => `${entry.name} (${((entry.value / totalValue) * 100).toFixed(1)}%)`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {allocationData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0a0a0f',
                        border: '1px solid #1a1a2e',
                        borderRadius: '8px',
                      }}
                      itemStyle={{ color: '#d1d5db' }}
                      formatter={(value: number) => `R$ ${value.toFixed(2)}`}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {allocationData.map((item, index) => {
                  const isPositive = item.pnl >= 0;
                  return (
                    <div
                      key={`alloc-${item.name}-${index}`}
                      className="flex items-center gap-2 p-2 bg-cyber-dark/50 rounded border border-cyber-border"
                    >
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <div className="flex-1">
                        <p className="text-sm font-bold font-orbitron text-white">
                          {item.name}
                        </p>
                        <p className={`text-xs ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                          {isPositive ? '+' : ''}R$ {item.pnl.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
