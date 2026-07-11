import { useEffect, useState } from 'react';
import { Clock, CheckCircle, XCircle, TrendingUp, TrendingDown } from 'lucide-react';
import { spreadOrderService } from '@/services/spreadOrderService';
import type { SpreadPendingOrder, SpreadOrderStatus } from '@/types/spread';

export default function SpreadOrderHistory() {
  const [executedOrders, setExecutedOrders] = useState<SpreadPendingOrder[]>([]);

  useEffect(() => {
    // Carregar histórico
    const loadHistory = () => {
      setExecutedOrders(spreadOrderService.getExecutedOrders());
    };

    loadHistory();

    // Escutar atualizações
    const handleHistoryUpdated = (orders: SpreadPendingOrder[]) => {
      setExecutedOrders([...orders]);
    };

    spreadOrderService.on('historyUpdated', handleHistoryUpdated);

    return () => {
      spreadOrderService.off('historyUpdated', handleHistoryUpdated);
    };
  }, []);

  const formatCurrency = (value: number) => {
    return `R$ ${value.toFixed(2)}`;
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    });
  };

  const getActionIcon = (action: string) => {
    return action === 'buy' ? (
      <TrendingUp className="w-3 h-3 text-green-400" />
    ) : (
      <TrendingDown className="w-3 h-3 text-red-400" />
    );
  };

  const getStatusIcon = (status: SpreadOrderStatus) => {
    switch (status) {
      case 'executed':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'cancelled':
        return <XCircle className="w-4 h-4 text-yellow-400" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-400" />;
      default:
        return null;
    }
  };

  const getStatusText = (status: SpreadOrderStatus) => {
    switch (status) {
      case 'executed':
        return 'Executada';
      case 'cancelled':
        return 'Cancelada';
      case 'failed':
        return 'Falhou';
      default:
        return status;
    }
  };

  const getStatusColor = (status: SpreadOrderStatus) => {
    switch (status) {
      case 'executed':
        return 'text-green-400';
      case 'cancelled':
        return 'text-yellow-400';
      case 'failed':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  // Filtrar apenas ordens de hoje
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayOrders = executedOrders.filter(order => {
    const orderDate = new Date(order.executedAt!);
    return orderDate >= today;
  });

  const totalProfitToday = todayOrders
    .filter(order => order.status === 'executed')
    .reduce((sum, order) => sum + (order.profit || 0), 0);

  if (executedOrders.length === 0) {
    return (
      <div className="cyber-card p-4 hud-corner">
        <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan mb-4">
          Histórico de Ordens
        </h3>
        <div className="text-center py-8 text-gray-500">
          <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="font-space text-sm">
            Nenhuma ordem executada ainda
          </p>
          <p className="font-space text-xs mt-2">
            Configure e ative ordens na Boleta Spread
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="cyber-card p-4 hud-corner">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan">
          Histórico de Ordens
        </h3>
        <div className="text-xs text-gray-400 font-space">
          Hoje: {totalProfitToday >= 0 ? '+' : ''}{formatCurrency(totalProfitToday)}
        </div>
      </div>

      <div className="space-y-3 max-h-[500px] overflow-y-auto">
        {executedOrders.slice(0, 20).map((order) => (
          <div
            key={order.id}
            className={`bg-cyber-dark/50 border rounded-lg p-4 transition-colors ${
              order.status === 'executed'
                ? 'border-green-500/30'
                : order.status === 'cancelled'
                ? 'border-yellow-500/30'
                : 'border-red-500/30'
            }`}
          >
            {/* Header: Status, Símbolos e Tempo */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                {getStatusIcon(order.status)}
                <div className="flex items-center gap-2">
                  <span className="font-orbitron font-bold text-cyan-400">
                    {order.symbol1}
                  </span>
                  <span className="text-gray-500">/</span>
                  <span className="font-orbitron font-bold text-cyan-400">
                    {order.symbol2}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-xs font-bold font-orbitron ${getStatusColor(order.status)}`}>
                  {getStatusText(order.status)}
                </p>
                <p className="text-xs text-gray-500 font-space">
                  {formatDate(order.executedAt!)} às {formatTime(order.executedAt!)}
                </p>
              </div>
            </div>

            {/* Ordem 1 */}
            <div className="bg-cyber-dark/30 rounded p-2 mb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getActionIcon(order.action1)}
                  <span className="font-space text-sm text-white">
                    {order.action1 === 'buy' ? 'Compra' : 'Venda'} {order.symbol1}
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-orbitron text-sm text-gray-300">
                    {order.quantity1} @ {formatCurrency(order.price1)}
                  </span>
                </div>
              </div>
            </div>

            {/* Ordem 2 */}
            <div className="bg-cyber-dark/30 rounded p-2 mb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getActionIcon(order.action2)}
                  <span className="font-space text-sm text-white">
                    {order.action2 === 'buy' ? 'Compra' : 'Venda'} {order.symbol2}
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-orbitron text-sm text-gray-300">
                    {order.quantity2} @ {formatCurrency(order.price2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Resultado */}
            {order.status === 'executed' && order.profit !== undefined && (
              <div className={`bg-gradient-to-r ${
                order.profit >= 0
                  ? 'from-green-500/10 to-emerald-500/10 border-green-500/30'
                  : 'from-red-500/10 to-rose-500/10 border-red-500/30'
              } border rounded-lg p-3`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-400 font-space mb-1">
                      Spread Executado
                    </p>
                    <p className="text-lg font-bold font-orbitron text-purple-400">
                      {formatCurrency(order.currentSpread)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-400 font-space mb-1">
                      Alvo
                    </p>
                    <p className="text-lg font-bold font-orbitron text-cyan-400">
                      {formatCurrency(order.targetSpread)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400 font-space mb-1">
                      Lucro
                    </p>
                    <p className={`text-xl font-bold font-orbitron ${
                      order.profit >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {order.profit >= 0 ? '+' : ''}{formatCurrency(order.profit)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {order.status === 'failed' && order.error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                <p className="text-xs text-red-400 font-space">
                  Erro: {order.error}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {executedOrders.length > 20 && (
        <div className="text-center mt-4 text-xs text-gray-500 font-space">
          Mostrando as últimas 20 ordens
        </div>
      )}
    </div>
  );
}