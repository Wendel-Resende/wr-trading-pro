# Guia de Integração MT5 - WR Trading Pro

## Visão Geral

A plataforma WR Trading Pro agora está totalmente integrada com o MetaTrader 5 através de um servidor WebSocket Python que faz a ponte entre a aplicação Next.js e a API oficial do MT5.

## Pré-requisitos

1. **MetaTrader 5 instalado** - Certifique-se de que o MT5 está instalado e funcionando
2. **Conta MT5 ativa** - Você precisa de uma conta de trading ativa
3. **Python 3.8+** - Para executar o servidor bridge
4. **Dependências Python instaladas**:
   ```bash
   pip install MetaTrader5 websockets
   ```

## Configuração Inicial

### 1. Configurar Credenciais

As credenciais do MT5 já estão configuradas no arquivo `.env`:

```env
MT5_LOGIN=MT5_LOGIN_EXAMPLE
MT5_PASSWORD=MT5_PASSWORD_EXAMPLE
MT5_SERVER=MT5_SERVER_EXAMPLE
```

### 2. Iniciar o Servidor Bridge

Abra um terminal e execute:

```bash
python mt5_bridge.py
```

O servidor iniciará na porta 8766 e mostrará:
```
2026-01-03 06:33:30,005 - __main__ - INFO - Iniciando servidor MT5 Bridge na porta 8766...
2026-01-03 06:33:30,051 - websockets.server - INFO - server listening on 127.0.0.1:8766
```

### 3. Iniciar a Aplicação Next.js

Em outro terminal, execute:

```bash
npm run dev
```

A aplicação estará disponível em `http://localhost:3000`

## Usando a Integração MT5

### Conectar ao MT5

1. Acesse a plataforma em `http://localhost:3000`
2. No dashboard principal, você verá o componente **MetaTrader 5**
3. Clique no botão **Conectar**
4. As credenciais serão carregadas automaticamente do `.env`
5. Após a conexão, você verá:
   - Status: **Conectado**
   - Informações da conta (saldo, equity, margem livre)
   - Servidor conectado

### Visualizar Posições

1. Vá para a aba **Portfólio**
2. Se conectado ao MT5, você verá um badge **MT5** verde
3. As posições reais do MT5 serão exibidas automaticamente
4. Cada posição mostra:
   - Símbolo
   - Quantidade
   - Preço médio
   - Preço atual
   - P&L (lucro/prejuízo)

### Enviar Ordens

1. No dashboard, use o formulário **Nova Ordem**
2. Selecione o tipo de ordem:
   - **COMPRA** ou **VENDA**
   - **MARKET**, **LIMIT** ou **STOP**
3. Configure:
   - Quantidade (lotes)
   - Preço (para ordens limite/stop)
   - Stop Loss (opcional)
   - Take Profit (opcional)
4. Clique em **COMPRAR** ou **VENDER**
5. A ordem será enviada via MT5 e você verá uma confirmação

### Visualizar Histórico

1. Vá para a aba **Ordens**
2. Você verá duas sub-abas:
   - **Ordens**: Ordens pendentes e executadas
   - **Trades**: Histórico de trades executados
3. Cada entrada mostra:
   - Tipo de ordem (compra/venda)
   - Símbolo
   - Volume
   - Preço
   - Estado (colocada, executada, cancelada, etc.)
   - Data/hora

## Componentes da Integração

### MT5Connection Componente

Gerencia a conexão com o MT5:
- Exibe status da conexão
- Mostra informações da conta
- Permite configurar credenciais
- Salva configuração no localStorage

### MT5Orders Componente

Exibe histórico de ordens e trades:
- Lista de ordens pendentes
- Histórico de trades
- Filtros por tipo
- Detalhes completos de cada operação

### Portfolio Componente

Integrado com MT5 para mostrar posições reais:
- Posições abertas do MT5
- P&L em tempo real
- Alocação de portfólio
- Gráfico de distribuição

### OrderForm Componente

Envia ordens reais via MT5:
- Suporte a ordens market, limite e stop
- Stop Loss e Take Profit
- Validação de dados
- Feedback de envio

## Serviço MT5

O serviço [`mt5Service.ts`](src/services/mt5Service.ts) fornece:

### Métodos de Conexão
- `connect(config)` - Conectar ao MT5
- `disconnect()` - Desconectar do MT5
- `getConnectionState()` - Obter estado atual

### Métodos de Dados
- `getPositions(symbol?)` - Obter posições
- `getOrders(symbol?)` - Obter ordens
- `getHistory(fromDate?, toDate?, symbol?)` - Obter histórico
- `getSymbolInfo(symbol)` - Obter informações de símbolo

### Métodos de Trading
- `sendOrder(request)` - Enviar ordem
- `modifyOrder(ticket, request)` - Modificar ordem
- `cancelOrder(ticket)` - Cancelar ordem
- `closePosition(ticket, volume?)` - Fechar posição
- `closePositionBy(ticket, ticketBy)` - Fechar posição oposta

### Eventos
- `on('state', callback)` - Mudança de estado
- `on('position', callback)` - Nova/atualização de posição
- `on('order', callback)` - Nova/atualização de ordem
- `on('trade', callback)` - Novo trade
- `on('tick', callback)` - Novo tick
- `on('error', callback)` - Erro

## Testes

### Teste de Conexão Direta

```bash
python test_mt5_connection.py
```

Testa a conexão direta com o MT5 sem o bridge.

### Teste do Bridge

```bash
python test_mt5_bridge.py
```

Testa a comunicação WebSocket com o bridge MT5.

## Troubleshooting

### Erro: "Não foi possível conectar ao MT5 Bridge"

**Solução:**
- Verifique se o servidor bridge está rodando: `python mt5_bridge.py`
- Verifique se a porta 8766 está disponível
- Verifique se não há firewall bloqueando a conexão

### Erro: "Falha no login MT5"

**Solução:**
- Verifique as credenciais no arquivo `.env`
- Verifique se o MT5 está instalado e funcionando
- Verifique se a conta está ativa no servidor
- Tente conectar diretamente no terminal MT5

### Posições não aparecendo

**Solução:**
- Verifique se está conectado ao MT5
- Verifique se há posições abertas na conta
- Aguarde alguns segundos para os dados serem carregados
- Verifique os logs do bridge para erros

### Ordens não sendo enviadas

**Solução:**
- Verifique se está conectado ao MT5
- Verifique se o símbolo está disponível
- Verifique se há margem suficiente
- Verifique os logs do bridge para detalhes do erro

## Segurança

⚠️ **Importante:**
- Nunca compartilhe suas credenciais do MT5
- O arquivo `.env` não deve ser commitado no Git
- Use contas de demonstração para testes
- Esteja ciente dos riscos de trading real

## Próximos Passos

1. **Configurar ProfitDLL** - Integrar com Nelogica para dados brasileiros
2. **Configurar LLM Providers** - Adicionar API keys para usar IA
3. **Testar em Conta Demo** - Testar todas as funcionalidades
4. **Monitorar Logs** - Verificar logs do bridge para erros
5. **Otimizar Performance** - Ajustar intervalos de atualização

## Suporte

Para problemas ou dúvidas:
- Verifique os logs do terminal bridge
- Verifique o console do navegador
- Consulte a documentação do MT5
- Revise os arquivos de teste para exemplos

## Arquivos Relacionados

- [`mt5_bridge.py`](mt5_bridge.py) - Servidor WebSocket Python
- [`src/services/mt5Service.ts`](src/services/mt5Service.ts) - Serviço TypeScript
- [`src/types/mt5.ts`](src/types/mt5.ts) - Tipos TypeScript
- [`src/components/MT5Connection.tsx`](src/components/MT5Connection.tsx) - Componente de conexão
- [`src/components/MT5Orders.tsx`](src/components/MT5Orders.tsx) - Componente de ordens
- [`src/components/Portfolio.tsx`](src/components/Portfolio.tsx) - Componente de portfólio
- [`src/components/OrderForm.tsx`](src/components/OrderForm.tsx) - Componente de ordens
- [`test_mt5_connection.py`](test_mt5_connection.py) - Teste de conexão
- [`test_mt5_bridge.py`](test_mt5_bridge.py) - Teste do bridge
