# MetaTrader 5 Bridge - Servidor WebSocket

Este servidor Python faz a ponte entre a API do MetaTrader 5 e a aplicação Next.js.

## Requisitos

- Python 3.8 ou superior
- MetaTrader 5 instalado
- Biblioteca `MetaTrader5`
- Biblioteca `websockets`

## Instalação

```bash
pip install MetaTrader5 websockets
```

## Execução

```bash
python mt5_bridge.py
```

O servidor iniciará na porta 8766 por padrão.

## Configuração do MetaTrader 5

Antes de usar o bridge, certifique-se de:

1. Ter o MetaTrader 5 instalado
2. Ter uma conta (demo ou real) configurada
3. Habilitar "Algorítmico Trading" nas configurações do MT5
4. Permitir conexões externas nas configurações do MT5

## Funcionalidades

O servidor suporta os seguintes comandos via WebSocket:

### Login
```json
{
  "type": "LOGIN",
  "data": {
    "login": 123456,
    "password": "sua_senha",
    "server": "MetaQuotes-Demo",
    "path": "C:\\Program Files\\MetaTrader 5\\terminal64.exe"
  }
}
```

### Inscrever em Ticks
```json
{
  "type": "SUBSCRIBE_TICKS",
  "data": {
    "symbol": "EURUSD"
  }
}
```

### Desinscrever de Ticks
```json
{
  "type": "UNSUBSCRIBE_TICKS",
  "data": {
    "symbol": "EURUSD"
  }
}
```

### Obter Informações de Símbolo
```json
{
  "type": "GET_SYMBOL_INFO",
  "data": {
    "symbol": "EURUSD"
  }
}
```

### Obter Posições
```json
{
  "type": "GET_POSITIONS",
  "data": {
    "symbol": "EURUSD"
  }
}
```

### Obter Ordens
```json
{
  "type": "GET_ORDERS",
  "data": {
    "symbol": "EURUSD"
  }
}
```

### Obter Histórico
```json
{
  "type": "GET_HISTORY",
  "data": {
    "fromDate": "2024-01-01T00:00:00",
    "toDate": "2024-01-31T23:59:59",
    "symbol": "EURUSD"
  }
}
```

### Enviar Ordem
```json
{
  "type": "SEND_ORDER",
  "data": {
    "action": "TRADE_ACTION_DEAL",
    "symbol": "EURUSD",
    "volume": 0.1,
    "type": "ORDER_TYPE_BUY",
    "price": 1.0800,
    "sl": 1.0750,
    "tp": 1.0850,
    "comment": "Ordem de teste",
    "deviation": 20,
    "magic": 234000,
    "typeTime": "ORDER_TIME_GTC",
    "typeFilling": "ORDER_FILLING_IOC"
  }
}
```

### Modificar Ordem
```json
{
  "type": "MODIFY_ORDER",
  "data": {
    "ticket": 123456,
    "price": 1.0810,
    "sl": 1.0760,
    "tp": 1.0860
  }
}
```

### Cancelar Ordem
```json
{
  "type": "CANCEL_ORDER",
  "data": {
    "ticket": 123456
  }
}
```

### Fechar Posição
```json
{
  "type": "CLOSE_POSITION",
  "data": {
    "ticket": 123456,
    "volume": 0.1
  }
}
```

### Fechar Posição por Posição Oposta
```json
{
  "type": "CLOSE_POSITION_BY",
  "data": {
    "ticket": 123456,
    "ticketBy": 123457
  }
}
```

## Mensagens Recebidas

O servidor envia mensagens para os clientes conectados nos seguintes formatos:

### Estado da Conexão
```json
{
  "type": "STATE",
  "data": {
    "state": "CONNECTED",
    "accountInfo": {
      "login": 123456,
      "tradeMode": 0,
      "leverage": 100,
      "balance": 10000.0,
      "equity": 10050.0,
      "margin": 100.0,
      "marginFree": 9900.0,
      "currency": "USD",
      "name": "Demo Account",
      "server": "MetaQuotes-Demo"
    }
  },
  "timestamp": "2024-01-01T12:00:00"
}
```

### Tick
```json
{
  "type": "TICK",
  "data": {
    "time": "2024-01-01T12:00:00",
    "bid": 1.0800,
    "ask": 1.0805,
    "last": 1.0802,
    "volume": 100,
    "volumeReal": 100,
    "timeMsc": 1704110400000,
    "flags": 6,
    "volumeDiff": 0
  },
  "timestamp": "2024-01-01T12:00:00"
}
```

### Posição
```json
{
  "type": "POSITION",
  "data": {
    "ticket": 123456,
    "time": "2024-01-01T12:00:00",
    "timeMsc": 1704110400000,
    "timeUpdate": "2024-01-01T12:00:00",
    "timeUpdateMsc": 1704110400000,
    "type": "BUY",
    "magic": 234000,
    "identifier": 123456,
    "reason": 3,
    "volume": 0.1,
    "priceOpen": 1.0800,
    "sl": 1.0750,
    "tp": 1.0850,
    "priceCurrent": 1.0802,
    "swap": -0.05,
    "profit": 2.0,
    "symbol": "EURUSD",
    "comment": "Ordem de teste",
    "externalId": ""
  },
  "timestamp": "2024-01-01T12:00:00"
}
```

### Ordem
```json
{
  "type": "ORDER",
  "data": {
    "ticket": 123456,
    "timeSetup": "2024-01-01T12:00:00",
    "timeSetupMsc": 1704110400000,
    "timeDone": "2024-01-01T12:00:00",
    "timeDoneMsc": 1704110400000,
    "type": "BUY",
    "state": "FILLED",
    "expiration": "2024-01-01T12:00:00",
    "volume": 0.1,
    "priceCurrent": 1.0802,
    "priceStopLimit": 0.0,
    "priceSl": 1.0750,
    "priceTp": 1.0850,
    "comment": "Ordem de teste",
    "position": 123456,
    "positionBy": 0,
    "volumeInitial": 0.1,
    "volumeCurrent": 0.0,
    "priceOpen": 1.0800,
    "magic": 234000,
    "reason": 3,
    "symbol": "EURUSD"
  },
  "timestamp": "2024-01-01T12:00:00"
}
```

### Trade
```json
{
  "type": "TRADE",
  "data": {
    "ticket": 123456,
    "order": 123456,
    "time": "2024-01-01T12:00:00",
    "timeMsc": 1704110400000,
    "type": "BUY",
    "entry": "IN",
    "magic": 234000,
    "reason": 3,
    "position": 123456,
    "positionBy": 0,
    "volume": 0.1,
    "price": 1.0800,
    "profit": 2.0,
    "commission": 0.5,
    "swap": -0.05,
    "symbol": "EURUSD",
    "comment": "Ordem de teste"
  },
  "timestamp": "2024-01-01T12:00:00"
}
```

### Informações de Símbolo
```json
{
  "type": "SYMBOL_INFO",
  "data": {
    "name": "EURUSD",
    "description": "Euro vs US Dollar",
    "base": "EUR",
    "quote": "USD",
    "type": "CFD",
    "visible": true,
    "tradeMode": 4,
    "select": true,
    "digits": 5,
    "point": 0.00001,
    "tradeTickValue": 1.0,
    "tradeTickSize": 0.00001,
    "tradeContractSize": 100000.0,
    "volumeMin": 0.01,
    "volumeMax": 100.0,
    "volumeStep": 0.01,
    "swapLong": -0.5,
    "swapShort": -0.5,
    "marginInitial": 100.0,
    "marginMaintenance": 50.0,
    "bid": 1.0800,
    "ask": 1.0805,
    "last": 1.0802,
    "volume": 100,
    "time": "2024-01-01T12:00:00"
  },
  "timestamp": "2024-01-01T12:00:00"
}
```

## Integração com MT5 Real

Para integrar com o MT5 real, você precisará:

1. Ter o MetaTrader 5 instalado e configurado
2. Ter uma conta (demo ou real) ativa
3. Instalar a biblioteca MetaTrader5: `pip install MetaTrader5`
4. Habilitar "Algorítmico Trading" nas configurações do MT5
5. Permitir conexões externas nas configurações do MT5

Exemplo de inicialização do MT5:

```python
import MetaTrader5 as mt5

# Inicializar MT5
if not mt5.initialize():
    print("Falha ao inicializar MT5")
    quit()

# Login
login = 123456
password = "sua_senha"
server = "MetaQuotes-Demo"

if not mt5.login(login, password, server):
    print("Falha no login")
    mt5.shutdown()
    quit()

# Obter informações da conta
account_info = mt5.account_info()
print(f"Conta: {account_info.login}")
print(f"Saldo: {account_info.balance}")
print(f"Equity: {account_info.equity}")

# Finalizar
mt5.shutdown()
```

## Notas

- O servidor atual está em modo de simulação para testes
- Para produção, implemente a integração real com a API do MetaTrader 5
- Certifique-se de ter as credenciais corretas do MT5
- O MT5 deve estar rodando para que a API funcione
- A biblioteca MetaTrader5 requer Windows para funcionar

## Troubleshooting

### Erro: "MetaTrader5 não disponível"
- Instale a biblioteca: `pip install MetaTrader5`
- Certifique-se de ter o Python 3.8 ou superior

### Erro: "Falha ao inicializar MT5"
- Verifique se o MetaTrader 5 está instalado
- Verifique se o caminho do MT5 está correto
- Tente especificar o caminho do terminal: `mt5.initialize(path="C:\\Program Files\\MetaTrader 5\\terminal64.exe")`

### Erro: "Falha no login"
- Verifique se as credenciais estão corretas
- Verifique se o servidor está correto
- Verifique se a conta está ativa
- Verifique se "Algorítmico Trading" está habilitado no MT5

### Erro: "Porta 8766 já em uso"
- Verifique se já existe uma instância do servidor rodando
- Altere a porta no código se necessário

### Erro: "Conexão recusada"
- Verifique se o servidor está rodando
- Verifique se o firewall não está bloqueando a porta 8766
- Verifique se o MT5 está permitindo conexões externas

## Segurança

- Nunca compartilhe suas credenciais do MT5
- Use contas demo para testes
- Mantenha o MT5 atualizado
- Use VPN se necessário para conexões externas