# Guia de Monitoramento e Logs

## Visão Geral

Este sistema fornece monitoramento avançado em tempo real com métricas Prometheus e logging estruturado com Winston.

## Funcionalidades

### 1. Sistema de Métricas (Prometheus)

#### Métricas Disponíveis

**Métricas do Sistema:**
- `system_cpu_usage_percent` - Uso de CPU (%)
- `system_memory_usage_bytes` - Uso de memória (bytes)
- `system_uptime_seconds` - Tempo de atividade (segundos)
- `nodejs_version` - Versão do Node.js

**Métricas do MT5:**
- `mt5_connection_status` - Status da conexão (0/1)
- `mt5_websocket_latency_seconds` - Latência do WebSocket (segundos)
- `mt5_messages_received_total` - Total de mensagens recebidas
- `mt5_errors_total` - Total de erros

**Métricas de Ordens:**
- `orders_sent_total` - Total de ordens enviadas
- `orders_confirmed_total` - Total de ordens confirmadas
- `orders_rejected_total` - Total de ordens rejeitadas
- `orders_execution_time_seconds` - Tempo de execução (segundos)
- `orders_volume_total` - Volume total negociado

**Métricas de IA:**
- `ai_requests_total` - Total de requisições à IA
- `ai_requests_success_total` - Requisições bem-sucedidas
- `ai_requests_error_total` - Requisições com erro
- `ai_response_time_seconds` - Tempo de resposta (segundos)
- `ai_tokens_used_total` - Total de tokens usados

#### Acessando as Métricas

As métricas estão disponíveis em:
```
GET /api/metrics
```

Retorna todas as métricas no formato Prometheus.

### 2. Sistema de Logs (Winston)

#### Tipos de Logs

- **combined**: Todos os logs em um único arquivo
- **error**: Apenas logs de erro
- **transactions**: Logs de ordens e transações
- **audit**: Logs de auditoria e segurança

#### Níveis de Log

- **error**: Erros graves que precisam de atenção
- **warn**: Avisos que não impedem o funcionamento
- **info**: Informações gerais sobre o sistema
- **debug**: Informações detalhadas para debugging
- **http**: Logs de requisições HTTP

#### Usando o Logger

```typescript
import logger from '@/lib/logger';

// Log de informação
logger.info('Mensagem informativa', {
  service: 'mt5',
  metadata: { symbol: 'EURUSD', price: 1.0850 }
});

// Log de erro
logger.error('Erro ao conectar ao MT5', {
  service: 'mt5',
  error: error.message,
  stack: error.stack
});

// Log de transação
logger.log('transactions', 'Ordem enviada', {
  orderId: '12345',
  symbol: 'GBPUSD',
  volume: 0.1,
  type: 'BUY'
});

// Log de auditoria
logger.audit('Usuário autenticado', {
  userId: 'user123',
  ip: '192.168.1.1',
  timestamp: new Date()
});
```

#### Acessando os Logs

**Listar Logs:**
```
GET /api/logs?type=combined&page=1&pageSize=50&days=7
```

Parâmetros:
- `type`: Tipo de log (combined, error, transactions, audit)
- `page`: Página atual
- `pageSize`: Itens por página
- `days`: Últimos X dias
- `level`: Filtrar por nível (error, warn, info, debug, http)
- `service`: Filtrar por serviço
- `search`: Termo de busca
- `startDate`: Data inicial (ISO 8601)
- `endDate`: Data final (ISO 8601)
- `orderBy`: Ordenar por (timestamp, level)
- `order`: Direção (asc, desc)

**Exportar Logs:**
```
POST /api/logs
Content-Type: application/json

{
  "type": "combined",
  "format": "csv",
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-01-31T23:59:59Z",
  "filters": {
    "level": "error",
    "search": "connection"
  }
}
```

## Dashboard Administrativo

### Acessando o Dashboard

- **Dashboard Principal**: `/admin`
- **Métricas Avançadas**: `/admin/metrics`
- **Visualizador de Logs**: `/admin/logs`

### Funcionalidades do Dashboard

#### Métricas

1. **Cards de Métricas em Tempo Real**
   - Status da conexão MT5
   - Latência do WebSocket
   - Uso de CPU e memória
   - Estatísticas de ordens
   - Métricas de IA

2. **Gráficos Interativos**
   - Latência do WebSocket (últimas 24h)
   - Volume de ordens por hora
   - Tendências de uso de recursos

3. **Atualização Automática**
   - Atualiza a cada 5 segundos
   - Botão de atualização manual

#### Logs

1. **Filtragem Avançada**
   - Por tipo de log
   - Por nível de severidade
   - Por serviço
   - Por período de tempo
   - Busca por texto

2. **Visualização**
   - Tabela com paginação
   - Detalhes do log em modal
   - Cores por nível de severidade

3. **Exportação**
   - Exportar para CSV
   - Exportar para JSON

## Integração com Prometheus

### Instalando Prometheus

1. Baixe o Prometheus em [https://prometheus.io/download/](https://prometheus.io/download/)

2. Crie um arquivo de configuração `prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'wr_trade_pro'
    static_configs:
      - targets: ['localhost:3000']
        metrics_path: '/api/metrics'
```

3. Execute o Prometheus:
```bash
./prometheus --config.file=prometheus.yml
```

4. Acesse o Prometheus em: `http://localhost:9090`

### Integração com Grafana

1. Instale o Grafana em [https://grafana.com/grafana/download](https://grafana.com/grafana/download)

2. Adicione o Prometheus como fonte de dados:
   - URL: `http://localhost:9090`
   - Access: `Server (default)`

3. Crie dashboards personalizados com as métricas

## Boas Práticas

### Logging

1. **Use o nível apropriado:**
   - `error`: Erros que precisam de intervenção imediata
   - `warn`: Problemas que não impedem o funcionamento
   - `info`: Eventos importantes para rastreamento
   - `debug`: Informações detalhadas para desenvolvimento

2. **Inclua contexto:**
   ```typescript
   logger.info('Ordem executada', {
     orderId: '12345',
     symbol: 'EURUSD',
     volume: 0.1,
     price: 1.0850,
     timestamp: new Date()
   });
   ```

3. **Não registre dados sensíveis:**
   - Senhas
   - Tokens de API
   - Informações pessoais

### Métricas

1. **Use nomes descritivos:**
   - `orders_sent_total` ✓
   - `orders_total` ✗

2. **Inclua rótulos úteis:**
   ```typescript
   ordersSentTotal.inc({
     symbol: 'EURUSD',
     type: 'BUY',
     status: 'FILLED'
   });
   ```

3. **Monitore tendências:**
   - Latência crescente
   - Aumento de erros
   - Uso de recursos

## Troubleshooting

### Logs não aparecem

1. Verifique se o diretório `logs/` existe
2. Verifique permissões de escrita
3. Verifique configuração do Winston

### Métricas não atualizam

1. Verifique se o endpoint `/api/metrics` está acessível
2. Verifique configuração do Prometheus
3. Revise logs para erros

### Alto uso de recursos

1. Reduza o intervalo de coleta
2. Aumente o período de retenção de logs
3. Desative logs de debug em produção

## Exemplos de Uso

### Monitorando Latência

```typescript
import register from '@/lib/prometheus-metrics';

const start = Date.now();

// Sua operação
await mt5Service.placeOrder(order);

const duration = (Date.now() - start) / 1000;
register.metrics['orders_execution_time_seconds'].observe(duration);
```

### Rastreando Erros

```typescript
try {
  await mt5Service.connect();
} catch (error) {
  logger.error('Falha na conexão MT5', {
    service: 'mt5',
    error: error.message,
    stack: error.stack,
    attempt: retryCount
  });
  
  mt5ErrorsTotal.inc({ errorType: 'connection' });
}
```

### Auditoria de Segurança

```typescript
logger.audit('Acesso ao painel administrativo', {
  userId: session.userId,
  action: 'view_dashboard',
  ip: request.ip,
  userAgent: request.headers['user-agent']
});
```

## Suporte

Para mais informações ou problemas:
- Documentação Winston: [https://github.com/winstonjs/winston](https://github.com/winstonjs/winston)
- Documentação Prometheus: [https://prometheus.io/docs/](https://prometheus.io/docs/)
- Documentação Grafana: [https://grafana.com/docs/](https://grafana.com/docs/)
