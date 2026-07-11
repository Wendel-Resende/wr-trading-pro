"use client";

import { MetricCard } from '@/types/admin-metrics';
import { 
  Activity, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle,
  CheckCircle,
  XCircle,
  Cpu,
  HardDrive,
  Clock,
  Database,
  DollarSign,
  Zap,
  MessageSquare,
  Bot
} from 'lucide-react';

interface AdminMetricCardProps {
  metric: MetricCard;
}

const iconMap: Record<string, any> = {
  Activity,
  Cpu,
  HardDrive,
  Clock,
  Database,
  DollarSign,
  Zap,
  MessageSquare,
  Bot,
  CheckCircle,
  XCircle,
  AlertTriangle,
};

export default function AdminMetricCard({ metric }: AdminMetricCardProps) {
  const Icon = metric.icon ? iconMap[metric.icon] : Activity;
  
  const getStatusColor = () => {
    switch (metric.status) {
      case 'success':
        return 'border-green-500/30 bg-green-500/10';
      case 'warning':
        return 'border-yellow-500/30 bg-yellow-500/10';
      case 'error':
        return 'border-red-500/30 bg-red-500/10';
      default:
        return 'border-cyber-border bg-cyber-dark/30';
    }
  };
  
  const getStatusTextColor = () => {
    switch (metric.status) {
      case 'success':
        return 'text-green-400';
      case 'warning':
        return 'text-yellow-400';
      case 'error':
        return 'text-red-400';
      default:
        return 'text-cyber-cyan';
    }
  };

  return (
    <div className={`cyber-card p-4 hud-corner border ${getStatusColor()} transition-all duration-300 hover:scale-105`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${getStatusTextColor()} bg-cyber-dark/50`}>
          {Icon && <Icon className="w-5 h-5" />}
        </div>
        {metric.trend && (
          <div className={`flex items-center gap-1 text-sm font-space ${
            metric.trend.direction === 'up' ? 'text-green-400' : 'text-red-400'
          }`}>
            {metric.trend.direction === 'up' ? (
              <TrendingUp className="w-4 h-4" />
            ) : (
              <TrendingDown className="w-4 h-4" />
            )}
            <span>{metric.trend.value}%</span>
            <span className="text-gray-400 text-xs">{metric.trend.period}</span>
          </div>
        )}
      </div>
      
      <div className="space-y-1">
        <p className="text-gray-400 text-xs font-space uppercase tracking-wide">
          {metric.title}
        </p>
        <div className="flex items-baseline gap-2">
          <p className={`text-2xl font-bold font-orbitron ${getStatusTextColor()}`}>
            {typeof metric.value === 'number' 
              ? metric.value.toLocaleString('pt-BR') 
              : metric.value
            }
          </p>
          {metric.unit && (
            <span className="text-sm text-gray-400 font-space">{metric.unit}</span>
          )}
        </div>
      </div>
    </div>
  );
}
