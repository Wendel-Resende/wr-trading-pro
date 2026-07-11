export interface LogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info' | 'debug' | 'http';
  message: string;
  service?: string;
  metadata?: Record<string, any>;
}

export interface LogFilters {
  level?: 'error' | 'warn' | 'info' | 'debug' | 'http';
  service?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
}

export interface LogsResponse {
  success: boolean;
  logs: LogEntry[];
  total: number;
  pages: number;
  page: number;
  pageSize: number;
  type: string;
  filters: LogFilters;
}

export interface LogType {
  value: string;
  label: string;
  description: string;
}

export const LOG_TYPES: LogType[] = [
  {
    value: 'combined',
    label: 'Combinado',
    description: 'Todos os logs em um único arquivo',
  },
  {
    value: 'error',
    label: 'Erros',
    description: 'Apenas logs de erro',
  },
  {
    value: 'transactions',
    label: 'Transações',
    description: 'Logs de ordens e transações',
  },
  {
    value: 'audit',
    label: 'Auditoria',
    description: 'Logs de auditoria e segurança',
  },
];
