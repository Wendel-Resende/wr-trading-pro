"use client";

import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { MetricSeries } from '@/types/admin-metrics';

interface AdminMetricsChartProps {
  title: string;
  data: MetricSeries[];
  type?: 'line' | 'area';
  height?: number;
  showLegend?: boolean;
}

export default function AdminMetricsChart({ 
  title, 
  data, 
  type = 'line',
  height = 300,
  showLegend = true
}: AdminMetricsChartProps) {
  // Preparar dados combinados
  const combinedData = data[0]?.data.map((point, index) => {
    const entry: any = {
      timestamp: point.timestamp,
      label: point.label,
    };
    
    data.forEach(series => {
      entry[series.name] = series.data[index]?.value || 0;
    });
    
    return entry;
  }) || [];

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-cyber-dark/95 border border-cyber-border rounded-lg p-3 shadow-xl">
          <p className="text-gray-400 text-xs font-space mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm font-jetbrains" style={{ color: entry.color }}>
              {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  return (
    <div className="cyber-card p-4 hud-corner">
      <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan mb-4">
        {title}
      </h3>
      <ResponsiveContainer width="100%" height={height}>
        {type === 'area' ? (
          <AreaChart data={combinedData}>
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="rgba(6, 182, 212, 0.1)"
            />
            <XAxis 
              dataKey="label" 
              stroke="#64748b"
              fontSize={12}
              tickFormatter={formatTimestamp}
            />
            <YAxis 
              stroke="#64748b"
              fontSize={12}
            />
            <Tooltip content={<CustomTooltip />} />
            {showLegend && (
              <Legend 
                wrapperStyle={{ fontSize: '12px', fontFamily: 'JetBrains Mono' }}
              />
            )}
            {data.map((series, index) => (
              <Area
                key={series.name}
                type="monotone"
                dataKey={series.name}
                stroke={series.color || `hsl(${index * 60}, 70%, 50%)`}
                fill={series.color || `hsl(${index * 60}, 70%, 50%)`}
                fillOpacity={0.3}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={combinedData}>
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="rgba(6, 182, 212, 0.1)"
            />
            <XAxis 
              dataKey="label" 
              stroke="#64748b"
              fontSize={12}
              tickFormatter={formatTimestamp}
            />
            <YAxis 
              stroke="#64748b"
              fontSize={12}
            />
            <Tooltip content={<CustomTooltip />} />
            {showLegend && (
              <Legend 
                wrapperStyle={{ fontSize: '12px', fontFamily: 'JetBrains Mono' }}
              />
            )}
            {data.map((series, index) => (
              <Line
                key={series.name}
                type="monotone"
                dataKey={series.name}
                stroke={series.color || `hsl(${index * 60}, 70%, 50%)`}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
