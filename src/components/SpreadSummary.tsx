import { useEffect, useState } from 'react';
import { Clock, Activity, DollarSign } from 'lucide-react';
import { spreadOrderService } from '@/services/spreadOrderService';
import type { SpreadSummary } from '@/types/spread';

export default function SpreadSummary() {
  const [summary, setSummary] = useState<SpreadSummary>({
    pendingOrders: 0,
    executedToday: 0,
    totalProfitToday: 0,
  });

  useEffect(() => {
    // Carregar resumo inicial
    const loadSummary = () => {
      setSummary(spreadOrderService.getSummary());
    };

    loadSummary();

    // Escutar atualizações
    const handleOrdersUpdated = () => loadSummary();
    const handleHistoryUpdated = () => loadSummary();

    spreadOrderService.on('ordersUpdated', handleOrdersUpdated);
    spreadOrderService.on('historyUpdated', handleHistoryUpdated);

    // Atualizar a cada 5 segundos
    const interval = setInterval(loadSummary, 5000);

    return () => {
      spreadOrderService.off('ordersUpdated', handleOrdersUpdated);
      spreadOrderService.off('historyUpdated', handleHistoryUpdated);
      clearInterval(interval);
    };
  }, []);

  const formatCurrency = (value: number) => {
    return `R$ ${value.toFixed(2)}`;
  };

  return (
    <div className="cyber-card p-4 hud-corner">
      <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan mb-4">
        Resumo do Dia
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Ordens Pendentes */}
        <div className="bg-cyber-dark/50 border border-cyber-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5 text-yellow-400" />
            <span className="text-xs text-gray-400 font-space">Pendentes</span>
          </div>
          <p className="text-2xl font-bold font-orbitron text-yellow-400">
            {summary.pendingOrders}
          </p>
          <p className="text-xs text-gray-500 font-space mt-1">
            Aguardando execução
          </p>
        </div>

        {/* Executadas Hoje */}
        <div className="bg-cyber-dark/50 border border-cyber-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-5 h-5 text-green-400" />
            <span className="text-xs text-gray-400 font-space">Executadas</span>
          </div>
          <p className="text-2xl font-bold font-orbitron text-green-400">
            {summary.executedToday}
          </p>
          <p className="text-xs text-gray-500 font-space mt-1">
            Hoje
          </p>
        </div>

        {/* Lucro Total */}
        <div className="bg-cyber-dark/50 border border-cyber-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-5 h-5 text-purple-400" />
            <span className="text-xs text-gray-400 font-space">Lucro Total</span>
          </div>
          <p className={`text-2xl font-bold font-orbitron ${
            summary.totalProfitToday >= 0 ? 'text-green-400' : 'text-red-400'
          }`}>
            {summary.totalProfitToday >= 0 ? '+' : ''}{formatCurrency(summary.totalProfitToday)}
          </p>
          <p className="text-xs text-gray-500 font-space mt-1">
            Hoje
          </p>
        </div>
      </div>
    </div>
  );
}