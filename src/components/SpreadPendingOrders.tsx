import { useEffect, useState } from 'react';
import { Clock, X, TrendingUp, TrendingDown, RotateCw } from 'lucide-react';
import { spreadOrderService } from '@/services/spreadOrderService';
import type { SpreadPendingOrder } from '@/types/spread';

export default function SpreadPendingOrders() {
  const [pendingOrders, setPendingOrders] = useState<SpreadPendingOrder[]>([]);

  useEffect(() => {
    // Carregar ordens pendentes
    const loadOrders = () => {
      setPendingOrders(spreadOrderService.getPendingOrders());
    };

    loadOrders();

    // Escutar atualizações
    const handleOrdersUpdated = (orders: SpreadPendingOrder[]) => {
      setPendingOrders([...orders]);
    };

    spreadOrderService.on('ordersUpdated', handleOrdersUpdated);

    return () => {
      spreadOrderService.off('ordersUpdated', handleOrdersUpdated);
    };
  }, []);

  const handleCancelOrder = (orderId: string) => {
    if (confirm('Deseja cancelar esta ordem de spread?')) {
      spreadOrderService.cancelOrder(orderId);
    }
  };

  const formatCurrency = (value: number) => {
    return `R$ ${value.toFixed(2)}`;
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getConditionText = (condition: string) => {
    switch (condition) {
      case 'greater_than':
        return 'Maior que';
      case 'less_than':
        return 'Menor que';
      case 'equal_to':
        return 'Igual a';
      default:
        return condition;
    }
  };

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case 'greater_than':
        return 'text-green-400';
      case 'less_than':
        return 'text-yellow-400';
      case 'equal_to':
        return 'text-blue-400';
      default:
        return 'text-gray-400';
    }
  };

  const getActionIcon = (action: string) => {
    return action === 'buy' ? (
      <TrendingUp className="w-3 h-3 text-green-400" />
    ) : (
      <TrendingDown className="w-3 h-3 text-red-400" />
    );
  };

  if (pendingOrders.length === 0) {
    return (
      <div className="cyber-card p-4 hud-corner">
        <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan mb-4">
          Ordens Pendentes
        </h3>
        <div className="text-center py-8 text-gray-500">
          <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="font-space text-sm">
            Nenhuma ordem pendente
          </p>
          <p className="font-space text-xs mt-2">
            Configure uma ordem na Boleta Spread
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="cyber-card p-4 hud-corner">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan">
          Ordens Pendentes ({pendingOrders.length})
        </h3>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <RotateCw className="w-3 h-3 animate-spin" />
          <span>Monitorando...</span>
        </div>
      </div>

      <div className="space-y-3 max-h-[500px] overflow-y-auto">
        {pendingOrders.map((order) => (
          <div
            key={order.id}
            className="bg-cyber-dark/50 border border-cyber-border rounded-lg p-4 hover:border-cyber-pink transition-colors"
          >
            {/* Header: Símbolos e Tempo */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="font-orbitron font-bold text-cyan-400">
                  {order.symbol1}
                </span>
                <span className="text-gray-500">/</span>
                <span className="font-orbitron font-bold text-cyan-400">
                  {order.symbol2}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 font-space">
                  {formatTime(order.createdAt)}
                </span>
                <button
                  onClick={() => handleCancelOrder(order.id)}
                  className="p-1 hover:bg-red-500/20 rounded transition-colors"
                  title="Cancelar ordem"
                >
                  <X className="w-4 h-4 text-red-400" />
                </button>
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

            {/* Spread Atual e Alvo */}
            <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-400 font-space mb-1">
                    Spread Atual
                  </p>
                  <p className={`text-lg font-bold font-orbitron ${
                    order.currentSpread >= 0 ? 'text-purple-400' : 'text-red-400'
                  }`}>
                    {order.currentSpread >= 0 ? '+' : ''}{formatCurrency(order.currentSpread)}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-400 font-space mb-1">
                    Condição
                  </p>
                  <p className={`text-sm font-bold font-orbitron ${getConditionColor(order.condition)}`}>
                    {getConditionText(order.condition)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400 font-space mb-1">
                    Alvo
                  </p>
                  <p className="text-lg font-bold font-orbitron text-cyan-400">
                    {formatCurrency(order.targetSpread)}
                  </p>
                </div>
              </div>

              {/* Barra de Progresso Visual */}
              <div className="mt-3 h-1 bg-cyber-dark rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    order.condition === 'greater_than' && order.currentSpread >= order.targetSpread
                      ? 'bg-green-500'
                      : order.condition === 'less_than' && order.currentSpread <= order.targetSpread
                      ? 'bg-green-500'
                      : 'bg-purple-500/50'
                  }`}
                  style={{
                    width: `${Math.min(
                      Math.abs(order.currentSpread / order.targetSpread) * 100,
                      100
                    )}%`,
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}