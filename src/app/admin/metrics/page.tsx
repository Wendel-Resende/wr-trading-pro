"use client";

import { useState, useEffect } from 'react';
import { mt5Service } from '@/services/mt5Service';
import { llmService } from '@/services/llmService';
import AdminMetricCard from '@/components/AdminMetricCard';
import AdminMetricsChart from '@/components/AdminMetricsChart';
import { MetricCard, MetricSeries } from '@/types/admin-metrics';
import { Cpu, HardDrive, Zap, MessageSquare, Bot, Activity, AlertTriangle, Database } from 'lucide-react';

export default function AdminMetricsPage() {
  const [metricsCards, setMetricsCards] = useState<MetricCard[]>([]);
  const [latencyData, setLatencyData] = useState<MetricSeries[]>([]);
  const [ordersData, setOrdersData] = useState<MetricSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Buscar métricas
  const fetchMetrics = async () => {
    try {
      // Buscar métricas do Prometheus
      const response = await fetch('/api/metrics');
      const metricsText = await response.text();

      // Parser simples de métricas do Prometheus
      const metrics: Record<string, number> = {};
      const lines = metricsText.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('#') || !line.trim()) continue;
        const match = line.match(/^([a-z_]+)\{[^}]*\}\s+(\d+\.?\d*)/i);
        if (match) {
          metrics[match[1]] = parseFloat(match[2]);
        }
      }

      // Criar cards de métricas
      const cards: MetricCard[] = [
        {
          title: 'Status MT5',
          value: metrics.mt5_connection_status === 1 ? 'Conectado' : 'Desconectado',
          status: metrics.mt5_connection_status === 1 ? 'success' : 'error',
          icon: 'Activity',
        },
        {
          title: 'Latência WebSocket',
          value: metrics.mt5_websocket_latency_seconds_sum ? (metrics.mt5_websocket_latency_seconds_sum * 1000).toFixed(0) : '0',
          unit: 'ms',
          status: metrics.mt5_websocket_latency_seconds_sum && metrics.mt5_websocket_latency_seconds_sum > 0.1 ? 'warning' : 'success',
          icon: 'Zap',
        },
        {
          title: 'Uso de CPU',
          value: metrics.system_cpu_usage_percent?.toFixed(1) || '0',
          unit: '%',
          status: metrics.system_cpu_usage_percent > 70 ? 'warning' : metrics.system_cpu_usage_percent > 90 ? 'error' : 'neutral',
          icon: 'Cpu',
        },
        {
          title: 'Uso de Memória',
          value: metrics.system_memory_usage_bytes ? (metrics.system_memory_usage_bytes / 1024 / 1024).toFixed(0) : '0',
          unit: 'MB',
          status: metrics.system_memory_usage_bytes && metrics.system_memory_usage_bytes > 500 * 1024 * 1024 ? 'warning' : 'neutral',
          icon: 'HardDrive',
        },
        {
          title: 'Ordens Enviadas',
          value: metrics.orders_sent_total || 0,
          icon: 'Database',
        },
        {
          title: 'Ordens Confirmadas',
          value: metrics.orders_confirmed_total || 0,
          status: 'success',
          icon: 'CheckCircle',
        },
        {
          title: 'Requisições IA',
          value: metrics.ai_requests_total || 0,
          icon: 'MessageSquare',
        },
        {
          title: 'Tokens Usados',
          value: metrics.ai_tokens_used_total ? Math.round(metrics.ai_tokens_used_total) : 0,
          unit: 'tokens',
          icon: 'Bot',
        },
      ];

      setMetricsCards(cards);

      // Gerar dados de exemplo para os gráficos (em produção, buscar dados históricos)
      const now = new Date();
      const latencyPoints = [];
      const ordersPoints = [];

      for (let i = 23; i >= 0; i--) {
        const timestamp = new Date(now.getTime() - i * 60 * 60 * 1000);
        const label = timestamp.getHours().toString().padStart(2, '0') + ':00';
        
        // Dados simulados de latência
        latencyPoints.push({
          timestamp: timestamp.toISOString(),
          label,
          value: Math.random() * 50 + 10,
        });

        // Dados simulados de ordens
        ordersPoints.push({
          timestamp: timestamp.toISOString(),
          label,
          value: Math.floor(Math.random() * 20),
        });
      }

      setLatencyData([
        {
          name: 'Latência (ms)',
          data: latencyPoints,
          color: '#06b6d4',
        },
      ]);

      setOrdersData([
        {
          name: 'Ordens por Hora',
          data: ordersPoints,
          color: '#22c55e',
        },
      ]);
    } catch (error) {
      console.error('Erro ao buscar métricas:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mounted) {
      fetchMetrics();
      // Atualizar a cada 5 segundos
      const interval = setInterval(fetchMetrics, 5000);
      return () => clearInterval(interval);
    }
  }, [mounted]);

  if (!mounted) {
    return (
      <div className="p-6">
        <h1 className="font-orbitron text-2xl font-bold text-white neon-text-cyan mb-6">
          Métricas do Sistema
        </h1>
        <div className="text-gray-400 font-space">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-orbitron text-2xl font-bold text-white neon-text-cyan mb-2">
            Métricas do Sistema
          </h1>
          <p className="text-gray-400 font-space text-sm">
            Monitoramento em tempo real do sistema e serviços
          </p>
        </div>
        <button
          onClick={fetchMetrics}
          className="px-4 py-2 bg-cyber-dark/50 border border-cyber-border rounded text-sm text-gray-400 font-space hover:border-cyber-cyan transition-colors"
        >
          Atualizar
        </button>
      </div>

      {/* Cards de Métricas */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="cyber-card p-4 hud-corner animate-pulse">
              <div className="h-24 bg-cyber-dark/30 rounded"></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {metricsCards.map((metric, index) => (
            <AdminMetricCard key={index} metric={metric} />
          ))}
        </div>
      )}

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AdminMetricsChart
          title="Latência do WebSocket (Últimas 24h)"
          data={latencyData}
          type="area"
          height={300}
        />
        <AdminMetricsChart
          title="Volume de Ordens por Hora (Últimas 24h)"
          data={ordersData}
          type="line"
          height={300}
        />
      </div>

      {/* Informações Adicionais */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Conexões Ativas */}
        <div className="cyber-card p-4 hud-corner">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-cyber-cyan/20 text-cyber-cyan">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-orbitron text-sm font-bold text-white">
                Conexões Ativas
              </h3>
              <p className="text-xs text-gray-400 font-space">WebSocket</p>
            </div>
          </div>
          <p className="text-3xl font-bold font-jetbrains text-cyber-cyan">
            {metricsCards.length > 0 && metricsCards[0].value === 'Conectado' ? '1' : '0'}
          </p>
        </div>

        {/* Uptime */}
        <div className="cyber-card p-4 hud-corner">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-green-500/20 text-green-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-orbitron text-sm font-bold text-white">
                Uptime do Sistema
              </h3>
              <p className="text-xs text-gray-400 font-space">Tempo de atividade</p>
            </div>
          </div>
          <p className="text-3xl font-bold font-jetbrains text-green-400">
            {Math.floor(process.uptime() / 3600)}h {(Math.floor(process.uptime() / 60) % 60)}m
          </p>
        </div>

        {/* Versão do Node */}
        <div className="cyber-card p-4 hud-corner">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-orbitron text-sm font-bold text-white">
                Ambiente
              </h3>
              <p className="text-xs text-gray-400 font-space">Node.js</p>
            </div>
          </div>
          <p className="text-3xl font-bold font-jetbrains text-purple-400">
            v{process.version.replace('v', '').split('.')[0]}.{process.version.replace('v', '').split('.')[1]}
          </p>
        </div>
      </div>

      {/* Aviso de Prometheus */}
      <div className="cyber-card p-4 hud-corner border border-yellow-500/30 bg-yellow-500/10">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-orbitron text-sm font-bold text-white mb-1">
              Integração com Prometheus
            </h3>
            <p className="text-sm text-gray-400 font-space">
              As métricas estão disponíveis no endpoint <code className="bg-cyber-dark/50 px-2 py-1 rounded text-cyber-cyan">/api/metrics</code> 
              no formato Prometheus. Você pode configurar o Prometheus para coletar essas métricas automaticamente 
              ou usar o Grafana para visualizações mais avançadas.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
