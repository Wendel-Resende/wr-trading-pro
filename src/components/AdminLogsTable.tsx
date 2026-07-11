"use client";

import { useState, useEffect } from 'react';
import { LogEntry, LogFilters, LogsResponse, LOG_TYPES } from '@/types/admin-logs';
import { 
  ChevronLeft, 
  ChevronRight, 
  Search, 
  Filter,
  Download,
  X,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle,
  Activity
} from 'lucide-react';

interface AdminLogsTableProps {
  initialType?: string;
}

const levelIcons = {
  error: AlertTriangle,
  warn: AlertCircle,
  info: Info,
  debug: CheckCircle,
  http: Activity,
};

const levelColors = {
  error: 'text-red-400 bg-red-500/20 border-red-500/30',
  warn: 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30',
  info: 'text-blue-400 bg-blue-500/20 border-blue-500/30',
  debug: 'text-green-400 bg-green-500/20 border-green-500/30',
  http: 'text-purple-400 bg-purple-500/20 border-purple-500/30',
};

export default function AdminLogsTable({ initialType = 'combined' }: AdminLogsTableProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [type, setType] = useState(initialType);
  const [filters, setFilters] = useState<LogFilters>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const pageSize = 50;

  // Buscar logs
  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        type,
        page: page.toString(),
        pageSize: pageSize.toString(),
        days: '7',
      });

      if (filters.level) params.append('level', filters.level);
      if (filters.service) params.append('service', filters.service);
      if (searchTerm) params.append('search', searchTerm);
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);

      const response = await fetch(`/api/logs?${params}`);
      const data: LogsResponse = await response.json();

      if (data.success) {
        setLogs(data.logs);
        setTotalPages(data.pages);
        setTotal(data.total);
      } else {
        setError('Erro ao carregar logs');
      }
    } catch (err) {
      setError('Erro ao conectar com o servidor');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [page, type, filters, searchTerm]);

  // Exportar logs
  const exportLogs = async (format: 'json' | 'csv') => {
    try {
      const response = await fetch('/api/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type,
          format,
          filters: {
            ...filters,
            search: searchTerm,
          },
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `logs-${type}-${new Date().toISOString().split('T')[0]}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Erro ao exportar logs:', err);
    }
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatMetadata = (metadata: Record<string, any>) => {
    return JSON.stringify(metadata, null, 2);
  };

  return (
    <div className="space-y-4">
      {/* Barra de Controle */}
      <div className="cyber-card p-4 hud-corner space-y-4">
        {/* Filtros Principais */}
        <div className="flex flex-wrap gap-4">
          {/* Tipo de Log */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-400 font-space mb-1">
              Tipo de Log
            </label>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded px-3 py-2 text-sm text-gray-400 font-jetbrains focus:outline-none focus:border-cyber-cyan"
            >
              {LOG_TYPES.map((logType) => (
                <option key={logType.value} value={logType.value}>
                  {logType.label}
                </option>
              ))}
            </select>
          </div>

          {/* Busca */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-400 font-space mb-1">
              Buscar
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar nos logs..."
                className="w-full bg-cyber-dark/50 border border-cyber-border rounded pl-10 pr-3 py-2 text-sm text-gray-400 font-jetbrains focus:outline-none focus:border-cyber-cyan"
              />
            </div>
          </div>

          {/* Botões */}
          <div className="flex gap-2 items-end">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="px-4 py-2 bg-cyber-dark/50 border border-cyber-border rounded text-sm text-gray-400 font-space hover:border-cyber-cyan transition-colors flex items-center gap-2"
            >
              <Filter className="w-4 h-4" />
              Filtros
            </button>
            <button
              onClick={() => exportLogs('csv')}
              className="px-4 py-2 bg-cyber-dark/50 border border-cyber-border rounded text-sm text-gray-400 font-space hover:border-cyber-cyan transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              CSV
            </button>
          </div>
        </div>

        {/* Filtros Avançados */}
        {showFilters && (
          <div className="pt-4 border-t border-cyber-border space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Nível */}
              <div>
                <label className="block text-xs text-gray-400 font-space mb-1">
                  Nível
                </label>
                <select
                  value={filters.level || ''}
                  onChange={(e) => {
                    setFilters({
                      ...filters,
                      level: e.target.value as any,
                    });
                    setPage(1);
                  }}
                  className="w-full bg-cyber-dark/50 border border-cyber-border rounded px-3 py-2 text-sm text-gray-400 font-jetbrains focus:outline-none focus:border-cyber-cyan"
                >
                  <option value="">Todos</option>
                  <option value="error">Error</option>
                  <option value="warn">Warning</option>
                  <option value="info">Info</option>
                  <option value="debug">Debug</option>
                  <option value="http">HTTP</option>
                </select>
              </div>

              {/* Data Inicial */}
              <div>
                <label className="block text-xs text-gray-400 font-space mb-1">
                  Data Inicial
                </label>
                <input
                  type="datetime-local"
                  value={filters.startDate || ''}
                  onChange={(e) => {
                    setFilters({
                      ...filters,
                      startDate: e.target.value,
                    });
                    setPage(1);
                  }}
                  className="w-full bg-cyber-dark/50 border border-cyber-border rounded px-3 py-2 text-sm text-gray-400 font-jetbrains focus:outline-none focus:border-cyber-cyan"
                />
              </div>

              {/* Data Final */}
              <div>
                <label className="block text-xs text-gray-400 font-space mb-1">
                  Data Final
                </label>
                <input
                  type="datetime-local"
                  value={filters.endDate || ''}
                  onChange={(e) => {
                    setFilters({
                      ...filters,
                      endDate: e.target.value,
                    });
                    setPage(1);
                  }}
                  className="w-full bg-cyber-dark/50 border border-cyber-border rounded px-3 py-2 text-sm text-gray-400 font-jetbrains focus:outline-none focus:border-cyber-cyan"
                />
              </div>
            </div>

            {/* Limpar Filtros */}
            <button
              onClick={() => {
                setFilters({});
                setSearchTerm('');
                setPage(1);
              }}
              className="text-sm text-cyber-cyan hover:text-white transition-colors flex items-center gap-2"
            >
              <X className="w-4 h-4" />
              Limpar Filtros
            </button>
          </div>
        )}
      </div>

      {/* Tabela de Logs */}
      <div className="cyber-card overflow-hidden hud-corner">
        <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full">
            <thead className="bg-cyber-dark/50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wide border-b border-cyber-border">
                  Nível
                </th>
                <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wide border-b border-cyber-border">
                  Timestamp
                </th>
                <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wide border-b border-cyber-border">
                  Serviço
                </th>
                <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wide border-b border-cyber-border">
                  Mensagem
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-400 font-space">
                    Carregando logs...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-red-400 font-space">
                    {error}
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-400 font-space">
                    Nenhum log encontrado
                  </td>
                </tr>
              ) : (
                logs.map((log, index) => {
                  const LevelIcon = levelIcons[log.level];
                  return (
                    <tr
                      key={index}
                      onClick={() => setSelectedLog(log)}
                      className="hover:bg-cyber-dark/30 cursor-pointer transition-colors border-b border-cyber-border/50"
                    >
                      <td className="px-4 py-3">
                        <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-space border ${levelColors[log.level]}`}>
                          <LevelIcon className="w-3 h-3" />
                          {log.level.toUpperCase()}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-jetbrains text-gray-400">
                        {formatDate(log.timestamp)}
                      </td>
                      <td className="px-4 py-3 text-xs font-jetbrains text-gray-400">
                        {log.service || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm font-jetbrains text-gray-300 max-w-md truncate">
                        {log.message}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {!loading && !error && logs.length > 0 && (
          <div className="px-4 py-3 bg-cyber-dark/30 border-t border-cyber-border flex items-center justify-between">
            <div className="text-xs text-gray-400 font-space">
              Mostrando {(page - 1) * pageSize + 1} a {Math.min(page * pageSize, total)} de {total} logs
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1 rounded hover:bg-cyber-dark/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4 text-gray-400" />
              </button>
              <span className="text-sm font-jetbrains text-gray-400">
                Página {page} de {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1 rounded hover:bg-cyber-dark/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal de Detalhes do Log */}
      {selectedLog && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="cyber-card max-w-4xl w-full max-h-[80vh] overflow-auto hud-corner"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-cyber-dark/95 p-4 border-b border-cyber-border flex items-center justify-between">
              <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan">
                Detalhes do Log
              </h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-1 rounded hover:bg-cyber-dark/50"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {/* Nível */}
              <div>
                <h4 className="text-xs font-space text-gray-400 uppercase tracking-wide mb-2">
                  Nível
                </h4>
                <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-space border ${levelColors[selectedLog.level]}`}>
                  {(() => {
                    const Icon = levelIcons[selectedLog.level];
                    return <Icon className="w-3 h-3" />;
                  })()}
                  {selectedLog.level.toUpperCase()}
                </div>
              </div>

              {/* Timestamp */}
              <div>
                <h4 className="text-xs font-space text-gray-400 uppercase tracking-wide mb-2">
                  Timestamp
                </h4>
                <p className="text-sm font-jetbrains text-gray-300">
                  {formatDate(selectedLog.timestamp)}
                </p>
              </div>

              {/* Serviço */}
              {selectedLog.service && (
                <div>
                  <h4 className="text-xs font-space text-gray-400 uppercase tracking-wide mb-2">
                    Serviço
                  </h4>
                  <p className="text-sm font-jetbrains text-gray-300">
                    {selectedLog.service}
                  </p>
                </div>
              )}

              {/* Mensagem */}
              <div>
                <h4 className="text-xs font-space text-gray-400 uppercase tracking-wide mb-2">
                  Mensagem
                </h4>
                <p className="text-sm font-jetbrains text-gray-300 whitespace-pre-wrap">
                  {selectedLog.message}
                </p>
              </div>

              {/* Metadata */}
              {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                <div>
                  <h4 className="text-xs font-space text-gray-400 uppercase tracking-wide mb-2">
                    Metadata
                  </h4>
                  <pre className="bg-cyber-dark/50 border border-cyber-border rounded p-4 text-xs font-jetbrains text-gray-300 overflow-auto">
                    {formatMetadata(selectedLog.metadata)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
