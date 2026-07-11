# ProfitDLL Bridge - Servidor WebSocket

Este servidor Python faz a ponte entre a DLL do ProfitDLL (Nelogica Data Solutions) e a aplicação Next.js.

## Requisitos

- Python 3.8 ou superior
- Windows (para ctypes e DLL do ProfitDLL)
- Biblioteca `websockets`

## Instalação

```bash
pip install websockets
```

## Execução

```bash
python profitdll_bridge.py
```

O servidor iniciará na porta 8765 por padrão.

## Funcionalidades

O servidor suporta os seguintes comandos via WebSocket:

### Login
```json
{
  "type": "LOGIN",
  "data": {
    "accessKey": "sua_chave",
    "username": "seu_usuario",
    "password": "sua_senha",
    "enableRouting": true
  }
}
```

### Inscrever em Ticker
```json
{
  "type": "SUBSCRIBE_TICKER",
  "data": {
    "ticker": "PETR4",
    "exchange": "B"
  }
}
```

### Inscrever em Price Depth
```json
{
  "type": "SUBSCRIBE_PRICE_DEPTH",
  "data": {
    "ticker": "PETR4",
    "exchange": "B"
  }
}
```

### Inscrever em Offer Book
```json
{
  "type": "SUBSCRIBE_OFFER_BOOK",
  "data": {
    "ticker": "PETR4",
    "exchange": "B"
  }
}
```

### Obter Posição
```json
{
  "type": "GET_POSITION",
  "data": {
    "accountId": "123456",
    "ticker": "PETR4",
    "exchange": "B"
  }
}
```

### Enviar Ordem de Compra
```json
{
  "type": "SEND_BUY_ORDER",
  "data": {
    "accountId": "123456",
    "ticker": "PETR4",
    "exchange": "B",
    "quantity": 100,
    "price": 34.50,
    "orderType": "LIMIT"
  }
}
```

### Enviar Ordem de Venda
```json
{
  "type": "SEND_SELL_ORDER",
  "data": {
    "accountId": "123456",
    "ticker": "PETR4",
    "exchange": "B",
    "quantity": 100,
    "price": 35.00,
    "orderType": "LIMIT"
  }
}
```

### Cancelar Ordem
```json
{
  "type": "CANCEL_ORDER",
  "data": {
    "accountId": "123456",
    "clOrderId": "order_id"
  }
}
```

### Cancelar Todas as Ordens
```json
{
  "type": "CANCEL_ALL_ORDERS",
  "data": {
    "accountId": "123456"
  }
}
```

### Zerar Posição
```json
{
  "type": "ZERO_POSITION",
  "data": {
    "accountId": "123456",
    "ticker": "PETR4",
    "exchange": "B",
    "positionType": "DAYTRADE"
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
    "isMarketConnected": true,
    "isActivated": true
  },
  "timestamp": "2024-01-01T12:00:00"
}
```

### Trade
```json
{
  "type": "TRADE",
  "data": {
    "assetId": {
      "ticker": "PETR4",
      "exchange": "B",
      "feedType": 0
    },
    "date": "2024-01-01T12:00:00",
    "tradeNumber": 123456,
    "price": 34.50,
    "quantity": 100,
    "volume": 3450.0,
    "buyAgent": 1,
    "sellAgent": 2,
    "tradeType": 1,
    "isEdit": false
  },
  "timestamp": "2024-01-01T12:00:00"
}
```

### Price Depth
```json
{
  "type": "PRICE_DEPTH",
  "data": {
    "assetId": {
      "ticker": "PETR4",
      "exchange": "B",
      "feedType": 0
    },
    "side": "BUY",
    "position": 0,
    "updateType": "ADD",
    "priceGroup": {
      "price": 34.50,
      "count": 5,
      "quantity": 500,
      "priceGroupFlags": 0
    }
  },
  "timestamp": "2024-01-01T12:00:00"
}
```

### Offer Book
```json
{
  "type": "OFFER_BOOK",
  "data": {
    "assetId": {
      "ticker": "PETR4",
      "exchange": "B",
      "feedType": 0
    },
    "action": 0,
    "position": 0,
    "side": "BUY",
    "quantity": 100,
    "agent": 1,
    "offerId": 12345,
    "price": 34.50,
    "hasPrice": true,
    "hasQuantity": true,
    "hasDate": true,
    "hasOfferId": true,
    "hasAgent": true,
    "date": "2024-01-01T12:00:00",
    "buyOffers": [],
    "sellOffers": []
  },
  "timestamp": "2024-01-01T12:00:00"
}
```

### Posição
```json
{
  "type": "POSITION",
  "data": {
    "accountId": {
      "brokerId": 1,
      "accountId": "123456"
    },
    "asset": {
      "ticker": "PETR4",
      "exchange": "B",
      "feedType": 0
    },
    "openQuantity": 100,
    "openAveragePrice": 34.50,
    "openSide": "BUY",
    "dailyQuantity": 100,
    "dailyQuantityAvailable": 100,
    "positionType": "DAYTRADE",
    "eventId": 12345
  },
  "timestamp": "2024-01-01T12:00:00"
}
```

### Ordem
```json
{
  "type": "ORDER",
  "data": {
    "orderId": {
      "localOrderId": 123456,
      "clOrderId": "order_id"
    },
    "accountId": {
      "brokerId": 1,
      "accountId": "123456"
    },
    "asset": {
      "ticker": "PETR4",
      "exchange": "B",
      "feedType": 0
    },
    "quantity": 100,
    "tradedQuantity": 0,
    "leavesQuantity": 100,
    "price": 34.50,
    "stopPrice": 0,
    "averagePrice": 0,
    "orderSide": "BUY",
    "orderType": "LIMIT",
    "orderStatus": "PENDING",
    "validityType": 0,
    "date": "2024-01-01T12:00:00",
    "lastUpdate": "2024-01-01T12:00:00",
    "eventId": 12345
  },
  "timestamp": "2024-01-01T12:00:00"
}
```

## Integração com DLL Real

Para integrar com a DLL real do ProfitDLL, você precisará:

1. Copiar a DLL `ProfitDLL.dll` para o diretório do projeto
2. Importar os tipos e funções do arquivo `ProfitDLL/Exemplo Python/profitTypes.py`
3. Implementar os callbacks da DLL para enviar mensagens via WebSocket
4. Chamar as funções da DLL nos handlers apropriados

Exemplo de inicialização da DLL:

```python
from ctypes import WinDLL, c_wchar_p, WINFUNCTYPE

# Carregar DLL
profit_dll = WinDLL("./ProfitDLL.dll")

# Definir callbacks
@WINFUNCTYPE(None, c_int, c_int)
def state_callback(nType, nResult):
    # Enviar estado via WebSocket
    pass

# Inicializar DLL
result = profit_dll.DLLInitializeLogin(
    c_wchar_p(access_key),
    c_wchar_p(username),
    c_wchar_p(password),
    state_callback,
    # ... outros callbacks
)
```

## Notas

- O servidor atual está em modo de simulação para testes
- Para produção, implemente a integração real com a DLL do ProfitDLL
- Certifique-se de ter as credenciais corretas da Nelogica
- A DLL do ProfitDLL requer Windows para funcionar

## Troubleshooting

### Erro: "ctypes não disponível"
- Este servidor requer Windows para funcionar com a DLL do ProfitDLL
- Em outros sistemas operacionais, apenas o modo de simulação estará disponível

### Erro: "Porta 8765 já em uso"
- Verifique se já existe uma instância do servidor rodando
- Altere a porta no código se necessário

### Erro: "Conexão recusada"
- Verifique se o servidor está rodando
- Verifique se o firewall não está bloqueando a porta 8765