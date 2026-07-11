import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

// Criar diretório de logs se não existir
const logsDir = path.join(process.cwd(), 'logs');

// Definir níveis de log personalizados
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Cores para cada nível
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

winston.addColors(colors);

// Formato personalizado de log
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Formato para console
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

// Transporte de logs combinados com rotação diária
const combinedTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'combined-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  format: logFormat,
});

// Transporte de erros com rotação diária
const errorTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxSize: '20m',
  maxFiles: '30d',
  format: logFormat,
});

// Transporte de transações com rotação diária
const transactionTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'transactions-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  format: logFormat,
});

// Transporte de auditoria com rotação diária
const auditTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'audit-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '365d',
  format: logFormat,
});

// Criar logger principal
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: logFormat,
  transports: [
    combinedTransport,
    errorTransport,
    transactionTransport,
    auditTransport,
  ],
  exitOnError: false,
});

// Adicionar transporte de console apenas em desenvolvimento
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

// Funções helper para tipos específicos de log
export const logTransaction = (data: {
  type: 'order_sent' | 'order_filled' | 'order_cancelled' | 'order_modified';
  symbol: string;
  action: 'BUY' | 'SELL';
  volume: number;
  price?: number;
  orderId?: string;
  success: boolean;
  userId?: string;
}) => {
  logger.info('Transaction', data);
};

export const logError = (error: Error, context?: Record<string, any>) => {
  logger.error('Error', {
    message: error.message,
    stack: error.stack,
    ...context,
  });
};

export const logAudit = (data: {
  action: string;
  userId?: string;
  resource: string;
  details: Record<string, any>;
}) => {
  logger.info('Audit', data);
};

export const logMetric = (data: {
  metric: string;
  value: number;
  unit: string;
  labels?: Record<string, any>;
}) => {
  logger.info('Metric', data);
};

export default logger;
