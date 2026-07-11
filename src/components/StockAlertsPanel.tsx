'use client';

import { useEffect, useState } from 'react';
import { StockAlert, StockAlertSummary } from '@/types/stock-alerts';

export default function StockAlertsPanel() {
  const [summary, setSummary] = useState<StockAlertSummary | null>(null);
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      
      // Buscar resumo
      const summaryRes = await fetch('/api/stock-alerts?summary=true');
      const summaryData = await summaryRes.json();
      setSummary(summaryData);

      // Buscar alertas recentes
      const alertsRes = await fetch('/api/stock-alerts');
      const alertsData = await alertsRes.json();
      setAlerts(alertsData);
    } catch (error) {
      console.error('Erro ao buscar alertas:', error);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (alertId: string) => {
    try {
      await fetch(`/api/stock-alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      });
      fetchAlerts();
    } catch (error) {
      console.error('Erro ao marcar alerta como lido:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      await fetch('/api/stock-alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllRead: true }),
      });
      fetchAlerts();
    } catch (error) {
      console.error('Erro ao marcar todos como lidos:', error);
    }
  };

  useEffect(() => {
    fetchAlerts();
    // Atualizar alertas a cada 30 segundos
    const interval = setInterval(fetchAlerts, 30000);
    return () => clearInterval(interval);
  }, []);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return 'bg-red-500/20 text-red-400 border-red-500/50';
      case 'WARNING':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
      case 'INFO':
      default:
        return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'PRICE':
        return '💰';
      case 'DIVIDEND':
        return '💵';
      case 'STATUS':
        return '📊';
      case 'PORTFOLIO':
        return '📈';
      default:
        return '🔔';
    }
  };

  const displayedAlerts = showAll ? alerts : alerts.slice(0, 5);

  if (loading) {
    return (
      <div className="cyber-card bg-cyber-dark/30 border border-cyber-border rounded-lg p-6">
        <h2 className="text-xl font-bold font-orbitron text-white neon-text-cyan mb-4">🔔 Alertas</h2>
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-cyber-dark/50 rounded border border-cyber-border"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="cyber-card bg-cyber-dark/30 border border-cyber-border rounded-lg">
      {/* Header */}
      <div className="p-6 border-b border-cyber-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold font-orbitron text-white neon-text-cyan">🔔 Alertas</h2>
            {summary && summary.unread > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                {summary.unread}
              </span>
            )}
          </div>
          {summary && summary.unread > 0 && (
            <button
              onClick={markAllAsRead}
              className="text-sm text-cyber-cyan hover:text-cyber-cyan/80 font-space"
            >
              Marcar todos como lidos
            </button>
          )}
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-4 gap-4 mt-4">
            <div className="bg-cyber-dark/50 p-3 rounded text-center border border-cyber-border">
              <div className="text-2xl font-bold font-orbitron text-white">{summary.total}</div>
              <div className="text-xs text-gray-400 font-space">Total</div>
            </div>
            <div className="bg-red-500/20 p-3 rounded text-center border border-red-500/50">
              <div className="text-2xl font-bold font-orbitron text-red-400">{summary.critical}</div>
              <div className="text-xs text-red-300 font-space">Críticos</div>
            </div>
            <div className="bg-yellow-500/20 p-3 rounded text-center border border-yellow-500/50">
              <div className="text-2xl font-bold font-orbitron text-yellow-400">{summary.warning}</div>
              <div className="text-xs text-yellow-300 font-space">Avisos</div>
            </div>
            <div className="bg-blue-500/20 p-3 rounded text-center border border-blue-500/50">
              <div className="text-2xl font-bold font-orbitron text-blue-400">{summary.info}</div>
              <div className="text-xs text-blue-300 font-space">Informações</div>
            </div>
          </div>
        )}
      </div>

      {/* Alerts List */}
      <div className="p-6">
        {displayedAlerts.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            <div className="text-4xl mb-2">✅</div>
            <p className="font-space">Nenhum alerta</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayedAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-4 rounded-lg border-2 font-space ${
                  alert.isRead 
                    ? 'bg-cyber-dark/50 border-cyber-border/50' 
                    : 'bg-cyber-dark/30 border-l-4 ' + getSeverityColor(alert.severity)
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="text-2xl">{getTypeIcon(alert.type)}</div>
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-semibold font-orbitron text-white">
                          {alert.stock?.asset?.symbol}
                        </div>
                        <div className="text-sm text-gray-300 mt-1 font-space">{alert.message}</div>
                      </div>
                      <div className="text-right">
                        <div className={`text-xs px-2 py-1 rounded-full font-space ${getSeverityColor(alert.severity)}`}>
                          {alert.severity}
                        </div>
                        <div className="text-xs text-gray-400 mt-2 font-space">
                          {new Date(alert.createdAt).toLocaleString('pt-BR')}
                        </div>
                      </div>
                    </div>
                    {!alert.isRead && (
                      <button
                        onClick={() => markAsRead(alert.id)}
                        className="text-xs text-cyber-cyan hover:text-cyber-cyan/80 mt-2 font-space"
                      >
                        Marcar como lido
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {alerts.length > 5 && (
          <div className="mt-4 text-center">
            <button
              onClick={() => setShowAll(!showAll)}
              className="text-cyber-cyan hover:text-cyber-cyan/80 font-space"
            >
              {showAll ? 'Mostrar menos' : `Ver todos os ${alerts.length} alertas`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
