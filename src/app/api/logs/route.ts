import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { format, subDays, parse } from 'date-fns';

export const dynamic = 'force-dynamic';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  service?: string;
  metadata?: any;
}

// Tipos de logs disponíveis
const LOG_TYPES = {
  COMBINED: 'combined',
  ERROR: 'error',
  TRANSACTIONS: 'transactions',
  AUDIT: 'audit',
};

// Obter caminho do arquivo de log
const getLogFilePath = (type: string, date: Date): string => {
  const logsDir = path.join(process.cwd(), 'logs');
  const dateStr = format(date, 'yyyy-MM-dd');
  return path.join(logsDir, `${type}-${dateStr}.log`);
};

// Ler arquivo de log
const readLogFile = async (filePath: string): Promise<LogEntry[]> => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    return lines.map((line): LogEntry => {
      try {
        const parsed = JSON.parse(line);
        return {
          timestamp: parsed.timestamp || parsed.time || line.substring(0, 19),
          level: parsed.level || 'info',
          message: parsed.message || line,
          service: parsed.service || parsed.type || undefined,
          metadata: parsed,
        };
      } catch {
        // Se não for JSON, tentar extrair informações do formato de texto
        const timestampMatch = line.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/);
        const levelMatch = line.match(/\[(ERROR|WARN|INFO|DEBUG|HTTP)\]/);
        
        return {
          timestamp: timestampMatch ? timestampMatch[0] : line.substring(0, 19),
          level: levelMatch ? levelMatch[1].toLowerCase() : 'info',
          message: line,
        };
      }
    });
  } catch (error) {
    console.error(`Erro ao ler arquivo de log ${filePath}:`, error);
    return [];
  }
};

// Filtrar logs
const filterLogs = (
  logs: LogEntry[],
  filters: {
    level?: string;
    service?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
  }
): LogEntry[] => {
  return logs.filter((log) => {
    if (filters.level && log.level !== filters.level) return false;
    if (filters.service && log.service !== filters.service) return false;
    if (filters.search && !JSON.stringify(log).toLowerCase().includes(filters.search.toLowerCase())) {
      return false;
    }
    if (filters.startDate && new Date(log.timestamp) < new Date(filters.startDate)) {
      return false;
    }
    if (filters.endDate && new Date(log.timestamp) > new Date(filters.endDate)) {
      return false;
    }
    return true;
  });
};

// Ordenar logs
const sortLogs = (logs: LogEntry[], orderBy: 'timestamp' | 'level', order: 'asc' | 'desc'): LogEntry[] => {
  return [...logs].sort((a, b) => {
    let comparison = 0;
    
    if (orderBy === 'timestamp') {
      comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    } else if (orderBy === 'level') {
      const levelOrder = { error: 0, warn: 1, info: 2, debug: 3 };
      comparison = (levelOrder[a.level as keyof typeof levelOrder] || 99) - 
                   (levelOrder[b.level as keyof typeof levelOrder] || 99);
    }
    
    return order === 'asc' ? comparison : -comparison;
  });
};

// Paginar logs
const paginateLogs = (logs: LogEntry[], page: number, pageSize: number): {
  logs: LogEntry[];
  total: number;
  pages: number;
} => {
  const total = logs.length;
  const pages = Math.ceil(total / pageSize);
  const startIndex = (page - 1) * pageSize;
  const paginatedLogs = logs.slice(startIndex, startIndex + pageSize);
  
  return {
    logs: paginatedLogs,
    total,
    pages,
  };
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    // Parâmetros de consulta
    const type = (searchParams.get('type') as string) || LOG_TYPES.COMBINED;
    const level = searchParams.get('level') || undefined;
    const service = searchParams.get('service') || undefined;
    const search = searchParams.get('search') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const orderBy = (searchParams.get('orderBy') as 'timestamp' | 'level') || 'timestamp';
    const order = (searchParams.get('order') as 'asc' | 'desc') || 'desc';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
    const days = parseInt(searchParams.get('days') || '1', 10);

    // Validar tipo de log
    if (!Object.values(LOG_TYPES).includes(type)) {
      return NextResponse.json(
        { error: 'Tipo de log inválido. Tipos disponíveis: combined, error, transactions, audit' },
        { status: 400 }
      );
    }

    // Ler logs dos últimos X dias
    let allLogs: LogEntry[] = [];
    for (let i = 0; i < days; i++) {
      const date = subDays(new Date(), i);
      const filePath = getLogFilePath(type, date);
      
      if (fs.existsSync(filePath)) {
        const logs = await readLogFile(filePath);
        allLogs = [...allLogs, ...logs];
      }
    }

    // Aplicar filtros
    let filteredLogs = filterLogs(allLogs, {
      level,
      service,
      search,
      startDate,
      endDate,
    });

    // Ordenar
    filteredLogs = sortLogs(filteredLogs, orderBy, order);

    // Paginar
    const paginated = paginateLogs(filteredLogs, page, pageSize);

    return NextResponse.json({
      success: true,
      ...paginated,
      page,
      pageSize,
      type,
      filters: {
        level,
        service,
        search,
        startDate,
        endDate,
        days,
      },
    });
  } catch (error) {
    console.error('Erro ao consultar logs:', error);
    return NextResponse.json(
      { error: 'Erro ao consultar logs', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// Endpoint para exportar logs
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type = LOG_TYPES.COMBINED, startDate, endDate, filters = {} } = body;

    const logsDir = path.join(process.cwd(), 'logs');
    let allLogs: LogEntry[] = [];

    // Ler logs no período especificado
    const start = startDate ? new Date(startDate) : subDays(new Date(), 1);
    const end = endDate ? new Date(endDate) : new Date();
    
    const currentDate = new Date(start);
    while (currentDate <= end) {
      const filePath = getLogFilePath(type, currentDate);
      
      if (fs.existsSync(filePath)) {
        const logs = await readLogFile(filePath);
        allLogs = [...allLogs, ...logs];
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Aplicar filtros
    let filteredLogs = filterLogs(allLogs, filters);
    filteredLogs = sortLogs(filteredLogs, 'timestamp', 'asc');

    // Retornar como arquivo CSV ou JSON
    const format = body.format || 'json';
    
    if (format === 'csv') {
      // Converter para CSV
      const headers = ['timestamp', 'level', 'message', 'service'];
      const csvContent = [
        headers.join(','),
        ...filteredLogs.map(log => 
          headers.map(header => {
            const value = log[header as keyof LogEntry] || '';
            return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value;
          }).join(',')
        )
      ].join('\n');

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="logs-${type}-${format(new Date(), 'yyyy-MM-dd')}.csv"`,
        },
      });
    } else {
      // Retornar JSON
      return NextResponse.json({
        success: true,
        logs: filteredLogs,
        total: filteredLogs.length,
      });
    }
  } catch (error) {
    console.error('Erro ao exportar logs:', error);
    return NextResponse.json(
      { error: 'Erro ao exportar logs', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
