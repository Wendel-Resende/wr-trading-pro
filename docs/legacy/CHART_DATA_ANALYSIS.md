# Análise de Dados do Gráfico - MT5 vs TradingView Lightweight Charts

## 📊 Resumo Executivo

**Problema Identificado:** O servidor MT5 Bridge está enviando apenas dados de **TICK** (preços individuais bid/ask), mas o gráfico de candlestick precisa de dados **OHLCV** (Open, High, Low, Close, Volume).

---

## 1. Formato Esperado pelo TradingView Lightweight Charts

```typescript
interface ChartData {
  time: number;      // Unix timestamp em SEGUNDOS (não milissegundos)
  open: number;      // Preço de abertura
  high: number;      // Preço máximo
  low: number;       // Preço mínimo
  close: number;     // Preço de fechamento
  volume: number;    // Volume negociado
}
```

### Exemplo de dados simulados que funcionam corretamente:
```javascript
{
  "time": 1704343200,  // Timestamp em segundos
  "open": 34.20,
  "high": 34.50,
  "low": 34.10,
  "close": 34.35,
  "volume": 1000000
}
```

---

## 2. Dados Atuais Enviados pelo MT5 Bridge

### ❌ Dados de TICK (enviados atualmente):
```python
{
  "symbol": "EURUSD",
  "time": 1767391138,       // Timestamp em segundos
  "time_msc": 1767391138866,  // Timestamp em milissegundos
  "bid": 1.17198,          // Preço atual de compra
  "ask": 1.17204,          // Preço atual de venda
  "last": 0.0,             // Último preço executado
  "volume": 0,             // Volume do tick
  "volume_real": 0.0
}
```

**PROBLEMA:**
- Contém APENAS preço atual (bid/ask)
- NÃO contém Open, High, Low, Close
- NÃO é adequado para gráficos de candlestick
- Funciona apenas para tickers/preços em tempo real

---

## 3. Dados Disponíveis no MT5 (mas não sendo usados)

### ✅ Dados de CANDLESTICK (OHLCV) disponíveis no MT5:

O MT5 possui a função `mt5.copy_rates_from()` que retorna dados completos de candles:

```python
# Estrutura bruta do candle (retornada como array numpy)
{
  "time": 1767385140,       # Timestamp em segundos (int64)
  "open": 1.17185,          # Preço de abertura
  "high": 1.17203,          # Preço máximo
  "low": 1.17184,           # Preço mínimo
  "close": 1.17202,         # Preço de fechamento
  "tick_volume": 29,        # Volume em ticks
  "spread": 6,              # Spread
  "real_volume": 0          # Volume real (se disponível)
}
```

### Conversão para formato do TradingView:
```python
{
  "time": 1767385140,       # Já está em segundos
  "open": 1.17185,
  "high": 1.17203,
  "low": 1.17184,
  "close": 1.17202,
  "volume": 29              # Usar tick_volume ou real_volume
}
```

### ✅ VERIFICAÇÃO:
- time é inteiro? **Sim** ✓
- time está em segundos? **Sim** ✓
- open, high, low, close são números? **Sim** ✓
- volume é número? **Sim** ✓

---

## 4. Comparação Visual

```
┌─────────────────────────────────────────────────────────────────┐
│                    TICK vs CANDLESTICK                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  TICK (atual)            vs      CANDLESTICK (necessário)     │
│  ┌─────────┐                     ┌─────────┐                    │
│  │   ●     │  preço atual       │    ▲    │  high              │
│  │ bid/ask │                     │    │    │                    │
│  │         │                     │    ├─┐  │  close             │
│  └─────────┘                     │    │ │  │                    │
│                                  │    └─┘  │  open              │
│                                  │         │                    │
│                                  │    ┴    │  low               │
│                                  └─────────┘                    │
│                                                                 │
│  ❌ Sem OHLCV           ✅ Completo com OHLCV + volume          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Solução Proposta

### Passo 1: Adicionar novo handler no mt5_bridge.py

```python
async def handle_get_chart_data(self, data: Dict[str, Any]):
    """Obter dados de candlestick para o gráfico"""
    symbol = data.get('symbol')
    timeframe = data.get('timeframe', '1H')  # Padrão: 1 hora
    count = data.get('count', 100)  # Número de candles
    
    # Mapear timeframes do frontend para MT5
    tf_mapping = {
        '1m': mt5.TIMEFRAME_M1,
        '5m': mt5.TIMEFRAME_M5,
        '15m': mt5.TIMEFRAME_M15,
        '30m': mt5.TIMEFRAME_M30,
        '1H': mt5.TIMEFRAME_H1,
        '4H': mt5.TIMEFRAME_H4,
        '1D': mt5.TIMEFRAME_D1,
    }
    
    mt5_timeframe = tf_mapping.get(timeframe, mt5.TIMEFRAME_H1)
    
    # Obter candles do MT5
    rates = mt5.copy_rates_from(symbol, mt5_timeframe, datetime.now(), count)
    
    if rates is None:
        logger.error(f"Erro ao obter dados de gráfico: {mt5.last_error()}")
        return
    
    # Converter para formato do TradingView
    chart_data = []
    for rate in rates:
        chart_data.append({
            'time': int(rate['time']),  # Já está em segundos
            'open': float(rate['open']),
            'high': float(rate['high']),
            'low': float(rate['low']),
            'close': float(rate['close']),
            'volume': int(rate['tick_volume']) if rate['tick_volume'] > 0 else 0,
        })
    
    # Enviar para o cliente
    await self.broadcast({
        'type': 'CHART_DATA',
        'data': {
            'symbol': symbol,
            'timeframe': timeframe,
            'candles': chart_data,
        },
        'timestamp': datetime.now().isoformat(),
    })
```

### Passo 2: Adicionar no switch case de mensagens

```python
async def handle_message(self, websocket: Any, message: str):
    # ...
    if msg_type == 'GET_CHART_DATA':
        await self.handle_get_chart_data(msg_data)
    # ...
```

### Passo 3: Atualizar o frontend (mt5Service.ts)

```typescript
getChartData(symbol: string, timeframe: string = '1H', count: number = 100): void {
  this.send({
    type: 'GET_CHART_DATA',
    data: { symbol, timeframe, count },
  });
}
```

### Passo 4: Atualizar o componente CandlestickChart.tsx

```typescript
useEffect(() => {
  if (symbol) {
    mt5Service.getChartData(symbol, selectedTimeframe);
  }
}, [symbol, selectedTimeframe]);
```

---

## 6. Timeframes Disponíveis no MT5

| Frontend | MT5 Constante | Descrição |
|----------|---------------|-----------|
| '1m' | TIMEFRAME_M1 | 1 minuto |
| '5m' | TIMEFRAME_M5 | 5 minutos |
| '15m' | TIMEFRAME_M15 | 15 minutos |
| '30m' | TIMEFRAME_M30 | 30 minutos |
| '1H' | TIMEFRAME_H1 | 1 hora |
| '4H' | TIMEFRAME_H4 | 4 horas |
| '1D' | TIMEFRAME_D1 | 1 dia |
| '1W' | TIMEFRAME_W1 | 1 semana |
| '1M' | TIMEFRAME_MN1 | 1 mês |

---

## 7. Conclusão

### ✅ O que funciona atualmente:
- Dados de tick em tempo real (preços bid/ask)
- Conexão WebSocket com MT5
- Envio de posições, ordens e trades

### ❌ O que não funciona:
- Gráfico de candlestick (falta dados OHLCV)

### ✅ O que precisa ser implementado:
1. Adicionar handler `GET_CHART_DATA` no mt5_bridge.py
2. Usar `mt5.copy_rates_from()` para obter candles
3. Converter dados para formato esperado pelo TradingView
4. Adicionar método `getChartData()` no mt5Service.ts
5. Atualizar CandlestickChart.tsx para usar dados do MT5

---

## 8. Próximos Passos

1. **Implementar a solução no mt5_bridge.py** (adicionar handler GET_CHART_DATA)
2. **Atualizar mt5Service.ts** (adicionar método getChartData)
3. **Modificar CandlestickChart.tsx** (usar dados reais do MT5)
4. **Testar** com diferentes timeframes e símbolos

---

**Nota:** Esta análise foi gerada pelo script `analyze_mt5_data.py` usando dados reais do MT5 conectado à conta de demonstração Exness (Login: MT5_LOGIN_EXAMPLE).

