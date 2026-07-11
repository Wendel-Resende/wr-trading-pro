"use client";

import { useState, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingUp,
  TrendingDown,
  Cpu,
  Clock,
  Zap,
  Download,
  RefreshCw,
  Filter,
  Bell,
  Settings,
  BarChart3,
  Brain,
} from 'lucide-react';
import { adminService } from '@/services/adminService';
import {
  MLModelMetrics,
  SystemMetrics,
  OperationLog,
  SystemAlert,
  DashboardStats,
} from '@/types/admin';

// Funções auxiliares
const getSeverityColor = (severity: string) => {
  switch (severity) {
    case 'INFO':
      return 'text-blue-400';
    case 'WARNING':
      return 'text-yellow-400';
    case 'ERROR':
      return 'text-red-400';
    case 'CRITICAL':
      return 'text-red-600';
    default:
      return 'text-gray-400';
  }
};

const getSeverityBg = (severity: string) => {
  switch (severity) {
    case 'INFO':
      return 'bg-blue-500/20 border-blue-500/50';
    case 'WARNING':
      return 'bg-yellow-500/20 border-yellow-500/50';
    case 'ERROR':
      return 'bg-red-500/20 border-red-500/50';
    case 'CRITICAL':
      return 'bg-red-600/20 border-red-600/50';
    default:
      return 'bg-gray-500/20 border-gray-500/50';
  }
};

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [mlModels, setMlModels] = useState<MLModelMetrics[]>([]);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics[]>([]);
  const [operationLogs, setOperationLogs] = useState<OperationLog[]>([]);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [selectedTab, setSelectedTab] = useState<'overview' | 'models' | 'metrics' | 'logs' | 'alerts'>('overview');
  const [logFilter, setLogFilter] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Atualizar a cada 30 segundos
    return () => clearInterval(interval);
  }, []);

  const loadData = () => {
    setStats(adminService.getDashboardStats());
    setMlModels(adminService.getMLModels());
    setSystemMetrics(adminService.getSystemMetrics());
    setOperationLogs(adminService.getOperationLogs());
    setAlerts(adminService.getAlerts());
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    loadData();
    setIsRefreshing(false);
  };

  const handleToggleModel = (id: string) => {
    adminService.toggleMLModel(id);
    setMlModels(adminService.getMLModels());
  };

  const handleMarkAlertAsRead = (id: string) => {
    adminService.markAlertAsRead(id);
    setAlerts(adminService.getAlerts());
  };

  const handleMarkAlertAsResolved = (id: string) => {
    adminService.markAlertAsResolved(id);
    setAlerts(adminService.getAlerts());
  };

  const handleExportLogs = () => {
    const logs = adminService.exportLogs();
    const blob = new Blob([logs], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `operation-logs-${new Date().toISOString()}.json`;
    a.click();
  };

  const unreadAlerts = alerts.filter(a => !a.isRead).length;

  return (
    <div className="min-h-screen bg-cyber-dark p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-orbitron text-3xl font-bold text-white mb-2">
              Dashboard Administrativo
            </h1>
            <p className="text-gray-400 font-space">
              Monitoramento de modelos ML e métricas do sistema
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="cyber-button cyber-button-secondary px-4 py-2 flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
            <button className="cyber-button cyber-button-primary px-4 py-2 flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Configurações
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-cyber-border pb-4">
          {[
            { id: 'overview', label: 'Visão Geral', icon: Activity },
            { id: 'models', label: 'Modelos ML', icon: Brain },
            { id: 'metrics', label: 'Métricas', icon: BarChart3 },
            { id: 'logs', label: 'Logs', icon: Activity },
            { id: 'alerts', label: 'Alertas', icon: Bell },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                selectedTab === tab.id
                  ? 'bg-cyber-cyan/20 text-cyber-cyan border border-cyber-cyan/50'
                  : 'text-gray-400 hover:text-gray-300 hover:bg-cyber-card/50'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span className="font-space text-sm">{tab.label}</span>
              {tab.id === 'alerts' && unreadAlerts > 0 && (
                <span className="bg-cyber-pink text-white text-xs px-2 py-0.5 rounded-full">
                  {unreadAlerts}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {selectedTab === 'overview' && stats && (
          <div className="space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Total de Trades"
                value={stats.totalTrades.toLocaleString()}
                icon={Activity}
                color="cyber-cyan"
                trend="+12.5%"
                trendUp
              />
              <StatCard
                title="Win Rate"
                value={`${(stats.winRate * 100).toFixed(1)}%`}
                icon={CheckCircle}
                color="cyber-green"
                trend="+2.3%"
                trendUp
              />
              <StatCard
                title="Sharpe Ratio"
                value={stats.sharpeRatio.toFixed(2)}
                icon={TrendingUp}
                color="cyber-pink"
                trend="+0.8%"
                trendUp
              />
              <StatCard
                title="Max Drawdown"
                value={`${stats.maxDrawdown.toFixed(1)}%`}
                icon={TrendingDown}
                color="cyber-red"
                trend="-1.2%"
                trendUp={false}
              />
              <StatCard
                title="Uptime"
                value={`${stats.uptime.toFixed(1)}%`}
                icon={Clock}
                color="cyber-cyan"
                trend="+0.1%"
                trendUp
              />
              <StatCard
                title="Latência Média"
                value={`${stats.avgLatency.toFixed(0)}ms`}
                icon={Zap}
                color="cyber-yellow"
                trend="-5.2%"
                trendUp={false}
              />
              <StatCard
                title="Taxa de Erro"
                value={`${stats.errorRate.toFixed(2)}%`}
                icon={XCircle}
                color="cyber-red"
                trend="-0.3%"
                trendUp={false}
              />
              <StatCard
                title="Profit Factor"
                value={stats.profitFactor.toFixed(2)}
                icon={TrendingUp}
                color="cyber-green"
                trend="+4.1%"
                trendUp
              />
            </div>

            {/* Recent Alerts */}
            <div className="bg-cyber-card/50 border border-cyber-border rounded-lg p-6">
              <h3 className="font-orbitron text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Bell className="w-5 h-5 text-cyber-pink" />
                Alertas Recentes
              </h3>
              <div className="space-y-3">
                {alerts.slice(0, 5).map(alert => (
                  <AlertItem
                    key={alert.id}
                    alert={alert}
                    onMarkAsRead={() => handleMarkAlertAsRead(alert.id)}
                    onMarkAsResolved={() => handleMarkAlertAsResolved(alert.id)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Models Tab - ML Monitoring */}
        {selectedTab === 'models' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {mlModels.map(model => (
                <ModelCard
                  key={model.id}
                  model={model}
                  onToggle={() => handleToggleModel(model.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Metrics Tab */}
        {selectedTab === 'metrics' && (
          <div className="space-y-6">
            <div className="cyber-card border border-cyber-cyan/30 bg-cyber-cyan/10 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <BarChart3 className="w-5 h-5 text-cyber-cyan" />
                  <div>
                    <h3 className="font-orbitron text-sm font-bold text-white">
                      Dashboard de Métricas Avançado
                    </h3>
                    <p className="text-xs text-gray-400 font-space">
                      Monitoramento com Prometheus e Grafana
                    </p>
                  </div>
                </div>
                <a
                  href="/admin/metrics"
                  className="px-4 py-2 bg-cyber-cyan/20 border border-cyber-cyan/50 rounded text-sm text-cyber-cyan font-space hover:bg-cyber-cyan/30 transition-colors"
                >
                  Abrir Dashboard
                </a>
              </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <MetricChart
                title="Uptime do Sistema"
                metrics={systemMetrics.filter(m => m.metricName === 'UPTIME')}
                color="cyber-cyan"
                unit="%"
              />
              <MetricChart
                title="Latência"
                metrics={systemMetrics.filter(m => m.metricName === 'LATENCY')}
                color="cyber-yellow"
                unit="ms"
              />
              <MetricChart
                title="Uso de CPU"
                metrics={systemMetrics.filter(m => m.metricName === 'CPU_USAGE')}
                color="cyber-pink"
                unit="%"
              />
              <MetricChart
                title="Uso de Memória"
                metrics={systemMetrics.filter(m => m.metricName === 'MEMORY_USAGE')}
                color="cyber-green"
                unit="%"
              />
            </div>
          </div>
        )}

        {/* Logs Tab */}
        {selectedTab === 'logs' && (
          <div className="space-y-6">
            <div className="cyber-card border border-cyber-cyan/30 bg-cyber-cyan/10 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Activity className="w-5 h-5 text-cyber-cyan" />
                  <div>
                    <h3 className="font-orbitron text-sm font-bold text-white">
                      Visualizador de Logs Avançado
                    </h3>
                    <p className="text-xs text-gray-400 font-space">
                      Filtragem, busca e exportação de logs em tempo real
                    </p>
                  </div>
                </div>
                <a
                  href="/admin/logs"
                  className="px-4 py-2 bg-cyber-cyan/20 border border-cyber-cyan/50 rounded text-sm text-cyber-cyan font-space hover:bg-cyber-cyan/30 transition-colors"
                >
                  Abrir Logs
                </a>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-400" />
                <select
                  value={logFilter}
                  onChange={(e) => setLogFilter(e.target.value)}
                  className="cyber-input text-sm"
                >
                  <option value="all">Todos</option>
                  <option value="ORDER">Ordens</option>
                  <option value="TRADE">Trades</option>
                  <option value="POSITION">Posições</option>
                  <option value="ALERT">Alertas</option>
                  <option value="SYSTEM">Sistema</option>
                  <option value="ERROR">Erros</option>
                </select>
              </div>
              <button
                onClick={handleExportLogs}
                className="cyber-button cyber-button-secondary px-4 py-2 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Exportar
              </button>
            </div>
            <div className="bg-cyber-card/50 border border-cyber-border rounded-lg overflow-hidden">
              <div className="max-h-[600px] overflow-y-auto scrollbar-cyber">
                {operationLogs
                  .filter(log => logFilter === 'all' || log.type === logFilter)
                  .map(log => (
                    <LogItem key={log.id} log={log} />
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* Alerts Tab */}
        {selectedTab === 'alerts' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {alerts.map(alert => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  onMarkAsRead={() => handleMarkAlertAsRead(alert.id)}
                  onMarkAsResolved={() => handleMarkAlertAsResolved(alert.id)}
                />
              ))}
            </div>
          </div>
        )}

              </div>
    </div>
  );
}

// Subcomponents
function StatCard({
  title,
  value,
  icon: Icon,
  color,
  trend,
  trendUp,
}: {
  title: string;
  value: string;
  icon: any;
  color: string;
  trend: string;
  trendUp: boolean;
}) {
  return (
    <div className="bg-cyber-card/50 border border-cyber-border rounded-lg p-4">
      <div className="flex items-start justify-between mb-2">
        <div className={`p-2 rounded-lg bg-${color}/20`}>
          <Icon className={`w-5 h-5 text-${color}`} />
        </div>
        <span className={`text-xs font-space ${trendUp ? 'text-cyber-green' : 'text-cyber-red'}`}>
          {trend}
        </span>
      </div>
      <p className="text-gray-400 text-xs font-space mb-1">{title}</p>
      <p className="font-orbitron text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function ModelCard({
  model,
  onToggle,
}: {
  model: MLModelMetrics;
  onToggle: () => void;
}) {
  return (
    <div className={`bg-cyber-card/50 border rounded-lg p-6 ${
      model.isActive ? 'border-cyber-cyan/50' : 'border-cyber-border opacity-60'
    }`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${model.isActive ? 'bg-cyber-cyan/20' : 'bg-gray-700/50'}`}>
            <Brain className={`w-5 h-5 ${model.isActive ? 'text-cyber-cyan' : 'text-gray-500'}`} />
          </div>
          <div>
            <h3 className="font-orbitron text-lg font-bold text-white">{model.name}</h3>
            <p className="text-gray-400 text-sm font-space">{model.type}</p>
          </div>
        </div>
        <button
          onClick={onToggle}
          className={`px-3 py-1 rounded-lg text-xs font-space transition-colors ${
            model.isActive
              ? 'bg-cyber-cyan/20 text-cyber-cyan border border-cyber-cyan/50'
              : 'bg-gray-700/50 text-gray-400 border border-gray-600'
          }`}
        >
          {model.isActive ? 'Ativo' : 'Inativo'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <MetricItem label="Acurácia" value={`${(model.accuracy * 100).toFixed(1)}%`} />
        <MetricItem label="Sharpe Ratio" value={model.sharpeRatio.toFixed(2)} />
        <MetricItem label="Max Drawdown" value={`${model.maxDrawdown.toFixed(1)}%`} />
        <MetricItem label="Win Rate" value={`${(model.winRate * 100).toFixed(1)}%`} />
        <MetricItem label="Total Trades" value={model.totalTrades.toLocaleString()} />
        <MetricItem label="Profit Factor" value={model.profitFactor.toFixed(2)} />
      </div>
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-gray-400 text-xs font-space mb-1">{label}</p>
      <p className="font-orbitron text-lg font-bold text-white">{value}</p>
    </div>
  );
}

function MetricChart({
  title,
  metrics,
  color,
  unit,
}: {
  title: string;
  metrics: SystemMetrics[];
  color: string;
  unit: string;
}) {
  const maxValue = Math.max(...metrics.map(m => m.value));
  const minValue = Math.min(...metrics.map(m => m.value));

  return (
    <div className="bg-cyber-card/50 border border-cyber-border rounded-lg p-6">
      <h3 className="font-orbitron text-lg font-bold text-white mb-4">{title}</h3>
      <div className="h-48 flex items-end gap-1">
        {metrics.slice(-24).map((metric, index) => {
          const height = ((metric.value - minValue) / (maxValue - minValue || 1)) * 100;
          return (
            <div
              key={metric.id}
              className="flex-1 bg-cyber-dark/50 rounded-t hover:bg-cyber-cyan/20 transition-colors relative group"
              style={{ height: `${Math.max(height, 5)}%` }}
            >
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-cyber-card border border-cyber-border rounded px-2 py-1 text-xs whitespace-nowrap">
                <p className="text-white font-space">{metric.value.toFixed(1)}{unit}</p>
                <p className="text-gray-400 text-xs">
                  {new Date(metric.timestamp).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LogItem({ log }: { log: OperationLog }) {
  return (
    <div className={`p-4 border-b border-cyber-border hover:bg-cyber-cyan/5 transition-colors`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-space px-2 py-0.5 rounded ${getSeverityBg(log.severity)}`}>
            {log.type}
          </span>
          <span className={`text-xs font-space ${getSeverityColor(log.severity)}`}>
            {log.severity}
          </span>
        </div>
        <span className="text-gray-500 text-xs font-space">
          {log.timestamp.toLocaleString('pt-BR')}
        </span>
      </div>
      <p className="text-gray-300 text-sm font-space">{log.message}</p>
      {log.asset && (
        <p className="text-cyber-cyan text-xs font-space mt-1">Ativo: {log.asset}</p>
      )}
    </div>
  );
}

function AlertItem({
  alert,
  onMarkAsRead,
  onMarkAsResolved,
}: {
  alert: SystemAlert;
  onMarkAsRead: () => void;
  onMarkAsResolved: () => void;
}) {
  return (
    <div className={`p-4 rounded-lg border ${getSeverityBg(alert.severity)} ${!alert.isRead ? 'border-l-4' : ''}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className={`w-4 h-4 ${getSeverityColor(alert.severity)}`} />
          <h4 className="font-orbitron text-sm font-bold text-white">{alert.title}</h4>
        </div>
        <div className="flex items-center gap-2">
          {!alert.isRead && (
            <button
              onClick={onMarkAsRead}
              className="text-xs font-space text-cyber-cyan hover:text-cyber-cyan/80"
            >
              Marcar como lido
            </button>
          )}
          {!alert.isResolved && (
            <button
              onClick={onMarkAsResolved}
              className="text-xs font-space text-cyber-green hover:text-cyber-green/80"
            >
              Resolver
            </button>
          )}
        </div>
      </div>
      <p className="text-gray-300 text-sm font-space mb-2">{alert.message}</p>
      <span className="text-gray-500 text-xs font-space">
        {alert.timestamp.toLocaleString('pt-BR')}
      </span>
    </div>
  );
}

function AlertCard({
  alert,
  onMarkAsRead,
  onMarkAsResolved,
}: {
  alert: SystemAlert;
  onMarkAsRead: () => void;
  onMarkAsResolved: () => void;
}) {
  return (
    <div className={`bg-cyber-card/50 border rounded-lg p-6 ${getSeverityBg(alert.severity)} ${!alert.isRead ? 'border-l-4' : ''}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className={`w-5 h-5 ${getSeverityColor(alert.severity)}`} />
          <div>
            <h3 className="font-orbitron text-lg font-bold text-white">{alert.title}</h3>
            <p className="text-gray-400 text-xs font-space">{alert.type}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!alert.isRead && (
            <button
              onClick={onMarkAsRead}
              className="cyber-button cyber-button-secondary px-3 py-1 text-xs"
            >
              Marcar como lido
            </button>
          )}
          {!alert.isResolved && (
            <button
              onClick={onMarkAsResolved}
              className="cyber-button cyber-button-primary px-3 py-1 text-xs"
            >
              Resolver
            </button>
          )}
        </div>
      </div>
      <p className="text-gray-300 text-sm font-space mb-4">{alert.message}</p>
      <span className="text-gray-500 text-xs font-space">
        {alert.timestamp.toLocaleString('pt-BR')}
      </span>
    </div>
  );
}
