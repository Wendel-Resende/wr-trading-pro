import client from 'prom-client';

// Criar registry padrão
const register = new client.Registry();

// Habilitar métricas padrão do Node.js
client.collectDefaultMetrics({ register });

// === Métricas do MT5 ===

// Status da conexão MT5 (0 = desconectado, 1 = conectado)
export const mt5ConnectionStatus = new client.Gauge({
  name: 'mt5_connection_status',
  help: 'Status da conexão com MetaTrader 5 (0 = desconectado, 1 = conectado)',
  registers: [register],
});

// Latência do WebSocket MT5 em segundos
export const mt5WebSocketLatency = new client.Histogram({
  name: 'mt5_websocket_latency_seconds',
  help: 'Latência do WebSocket com MT5 Bridge em segundos',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Total de mensagens recebidas do MT5
export const mt5MessagesReceived = new client.Counter({
  name: 'mt5_messages_received_total',
  help: 'Total de mensagens recebidas do MT5 Bridge',
  labelNames: ['message_type'],
  registers: [register],
});

// Total de erros de comunicação MT5
export const mt5Errors = new client.Counter({
  name: 'mt5_errors_total',
  help: 'Total de erros na comunicação com MT5',
  labelNames: ['error_type'],
  registers: [register],
});

// === Métricas de Ordens ===

// Total de ordens enviadas
export const ordersSent = new client.Counter({
  name: 'orders_sent_total',
  help: 'Total de ordens enviadas para execução',
  labelNames: ['symbol', 'action'],
  registers: [register],
});

// Total de ordens confirmadas
export const ordersConfirmed = new client.Counter({
  name: 'orders_confirmed_total',
  help: 'Total de ordens confirmadas',
  labelNames: ['symbol', 'action'],
  registers: [register],
});

// Total de ordens rejeitadas
export const ordersRejected = new client.Counter({
  name: 'orders_rejected_total',
  help: 'Total de ordens rejeitadas',
  labelNames: ['symbol', 'reason'],
  registers: [register],
});

// Tempo de execução das ordens
export const orderExecutionTime = new client.Histogram({
  name: 'order_execution_seconds',
  help: 'Tempo para confirmação de ordens em segundos',
  labelNames: ['symbol', 'action'],
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

// Volume total negociado
export const totalVolumeTraded = new client.Counter({
  name: 'total_volume_traded_lots',
  help: 'Volume total negociado em lotes',
  labelNames: ['symbol'],
  registers: [register],
});

// === Métricas da IA/LLM ===

// Tempo de resposta da IA
export const aiResponseTime = new client.Histogram({
  name: 'ai_response_time_seconds',
  help: 'Tempo de resposta da IA em segundos',
  labelNames: ['model', 'prompt_type'],
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60],
  registers: [register],
});

// Total de solicitações à IA
export const aiRequestsTotal = new client.Counter({
  name: 'ai_requests_total',
  help: 'Total de solicitações à IA',
  labelNames: ['model', 'prompt_type', 'status'],
  registers: [register],
});

// Tokens usados
export const aiTokensUsed = new client.Counter({
  name: 'ai_tokens_used_total',
  help: 'Total de tokens usados nas respostas da IA',
  labelNames: ['model', 'type'], // type: 'prompt' | 'completion'
  registers: [register],
});

// Custo estimado (em dólares)
export const aiEstimatedCost = new client.Counter({
  name: 'ai_estimated_cost_usd',
  help: 'Custo estimado das requisições à IA em USD',
  labelNames: ['model'],
  registers: [register],
});

// === Métricas de Sinais ===

// Sinais gerados
export const signalsGenerated = new client.Counter({
  name: 'signals_generated_total',
  help: 'Total de sinais de trading gerados',
  labelNames: ['symbol', 'direction', 'strategy'],
  registers: [register],
});

// Alertas disparados
export const alertsTriggered = new client.Counter({
  name: 'alerts_triggered_total',
  help: 'Total de alertas disparados',
  labelNames: ['type', 'severity'], // type: 'price', 'volume', 'indicator'; severity: 'low', 'medium', 'high'
  registers: [register],
});

// === Métricas do Sistema ===

// Uso de memória em bytes
export const systemMemoryUsage = new client.Gauge({
  name: 'system_memory_usage_bytes',
  help: 'Uso de memória do processo em bytes',
  registers: [register],
});

// Uso de CPU em porcentagem
export const systemCpuUsage = new client.Gauge({
  name: 'system_cpu_usage_percent',
  help: 'Uso de CPU do processo em porcentagem',
  registers: [register],
});

// Número de conexões WebSocket ativas
export const activeWebSocketConnections = new client.Gauge({
  name: 'active_websocket_connections',
  help: 'Número de conexões WebSocket ativas',
  registers: [register],
});

// Taxa de requisições HTTP
export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total de requisições HTTP',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// Tempo de resposta HTTP
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duração das requisições HTTP em segundos',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// === Funções Helper ===

// Atualizar métricas de sistema
export const updateSystemMetrics = () => {
  const usage = process.memoryUsage();
  systemMemoryUsage.set(usage.heapUsed);
  
  // CPU usage (aproximado)
  const cpuUsage = process.cpuUsage();
  const totalCpuTime = cpuUsage.user + cpuUsage.system;
  systemCpuUsage.set(totalCpuTime / 1000000); // Convert to seconds
};

// Registrar métrica de requisição HTTP
export const recordHttpRequest = (method: string, route: string, statusCode: number, duration: number) => {
  httpRequestsTotal.inc({ method, route, status_code: statusCode.toString() });
  httpRequestDuration.observe({ method, route, status_code: statusCode.toString() }, duration);
};

// Registrar execução de ordem
export const recordOrderExecution = (symbol: string, action: string, duration: number) => {
  orderExecutionTime.observe({ symbol, action }, duration);
};

// Registrar resposta da IA
export const recordAIResponse = (model: string, promptType: string, duration: number, promptTokens: number, completionTokens: number, success: boolean) => {
  aiResponseTime.observe({ model, prompt_type: promptType }, duration);
  aiRequestsTotal.inc({ model, prompt_type: promptType, status: success ? 'success' : 'error' });
  aiTokensUsed.inc({ model, type: 'prompt' }, promptTokens);
  aiTokensUsed.inc({ model, type: 'completion' }, completionTokens);
  
  // Estimar custo (taxas aproximadas do OpenAI GPT-4)
  const costPerPromptToken = 0.00003; // $0.03 por 1K tokens
  const costPerCompletionToken = 0.00006; // $0.06 por 1K tokens
  const estimatedCost = (promptTokens * costPerPromptToken / 1000) + (completionTokens * costPerCompletionToken / 1000);
  aiEstimatedCost.inc({ model }, estimatedCost);
};

// Exportar registry
export { register };
export default register;
