# Implementação de Dados de Gráfico MT5 - Resumo

## ✅ Implementação Concluída

Todos os 5 passos foram implementados com sucesso para permitir que o gráfico de candlestick use dados reais do MetaTrader 5.

---

## 📋 Passos Implementados

### 1. ✅ Handler `GET_CHART_DATA` no mt5_bridge.py

**Arquivo:** `mt5_bridge.py`

Adicionado o método `handle_get_chart_data()` que:
- Recebe solicitações do frontend com símbolo, timeframe e quantidade de candles
- Mapeia timeframes do frontend para constantes do MT5 (TIMEFRAME_M1, TIMEFRAME_H1, etc.)
- Obtém candles usando `mt5.copy_rates_from()`
- Converte dados para formato esperado pelo TradingView
- Envia dados via WebSocket como mensagem do tipo `CHART_DATA`

**Timeframes suportados:**
- '1m' → TIMEFRAME_M1
- '5m' → TIMEFRAME_M5
- '15m' → TIMEFRAME_M15
- '30m' → TIMEFRAME_M30
- '1H' → TIMEFRAME_H1
- '4H' → TIMEFRAME_H4
- '1D' → TIMEFRAME_D1
- '1W' → TIMEFRAME_W1
- '1M' → TIMEFRAME_MN1

**Formato de dados enviado:**
```python
{
  'type': 'CHART_DATA',
  'data': {
    'symbol': 'EURUSD',
    'timeframe': '1H',
    'candles': [
      {
        'time': 1767385140,  # Timestamp em segundos
        'open': 1.17185,
        'high': 1.17203,
        'low': 1.17184,
        'close': 1.17202,
        'volume': 29,
      },
      # ... mais candles
    ],
  },
  'timestamp': '2026-01-04T12:00:00',
}
```

---

### 2. ✅ Uso de `mt5.copy_rates_from()` no mt5_bridge.py

**Implementação:**
```python
# Obter candles do MT5
rates = mt5.copy_rates_from(symbol, mt5_timeframe, datetime.now(), count)

if rates is None:
    error_code = mt5.last_error()
    logger.error(f"Erro ao obter dados de gráfico: {error_code}")
    return
```

**Funcionalidades:**
- Busca candles históricos do MT5
- Retorna dados OHLCV completos (Open, High, Low, Close, Volume)
- Timestamps já em segundos (compatível com TradingView)
- Suporta todos os timeframes do MT5

---

### 3. ✅ Conversão de dados para formato TradingView

**Implementação no mt5_bridge.py:**
```python
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
```

**Verificações realizadas:**
- ✅ time é inteiro
- ✅ time está em segundos (não milissegundos)
- ✅ open, high, low, close são números float
- ✅ volume é número inteiro

---

### 4. ✅ Método `getChartData()` no mt5Service.ts

**Arquivo:** `src/services/mt5Service.ts`

**Implementação:**
```typescript
/**
 * Obter dados de candlestick para o gráfico
 */
getChartData(symbol: string, timeframe: string = '1H', count: number = 100): void {
  this.send({
    type: 'GET_CHART_DATA',
    data: { symbol, timeframe, count },
  });
}
```

**Funcionalidades:**
- Envia solicitação para o servidor Python
- Parâmetros configuráveis:
  - `symbol`: Símbolo do ativo (ex: EURUSD, PETR4)
  - `timeframe`: Período do candle (1m, 5m, 15m, 30m, 1H, 4H, 1D)
  - `count`: Quantidade de candles (padrão: 100)

---

### 5. ✅ Atualização do CandlestickChart.tsx

**Arquivo:** `src/components/CandlestickChart.tsx`

**Mudanças implementadas:**

#### a) Import do mt5Service:
```typescript
import { mt5Service } from '@/services/mt5Service';
```

#### b) Estado para dados do gráfico e símbolo:
```typescript
const [chartData, setChartData] = useState<CandlestickData[]>(initialData || []);
const [symbol, setSymbol] = useState(initialSymbol);  // Estado local para símbolo editável
const [isLoading, setIsLoading] = useState(false);
```

#### c) Input editável para selecionar ativo:
```typescript
<form onSubmit={handleSymbolSubmit} className="flex items-center gap-2">
  <div className="bg-cyber-dark/80 px-3 py-1 rounded border border-cyber-cyan/30 flex items-center gap-2">
    <input
      type="text"
      value={symbol}
      onChange={(e) => setSymbol(e.target.value.toUpperCase())}
      onBlur={(e) => handleSymbolChange(e.target.value)}
      placeholder="ATIVO"
      className="bg-transparent font-orbitron text-sm text-cyber-cyan w-24 outline-none uppercase"
      maxLength={10}
    />
    <button
      type="submit"
      className="text-cyber-cyan hover:text-white transition-colors"
      title="Carregar ativo"
    >
      {/* Ícone de refresh */}
    </button>
  </div>
</form>
```

#### d) Handlers para carregar novo ativo:
```typescript
// Handler para mudança de símbolo (ao perder foco)
const handleSymbolChange = (newSymbol: string) => {
  const upperSymbol = newSymbol.toUpperCase().trim();
  if (upperSymbol) {
    setSymbol(upperSymbol);
  }
};

// Handler para submissão do formulário (Enter)
const handleSymbolSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  if (symbol && mt5Service.getConnectionState().isConnected) {
    setIsLoading(true);
    mt5Service.getChartData(symbol, timeframe, 100);
  }
};
```

#### c) Busca de dados do MT5:
```typescript
useEffect(() => {
  // Se dados iniciais foram fornecidos via props, usar eles
  if (initialData && initialData.length > 0) {
    setChartData(initialData);
    return;
  }

  // Caso contrário, buscar dados do MT5
  if (symbol && mt5Service.getConnectionState().isConnected) {
    setIsLoading(true);
    mt5Service.getChartData(symbol, timeframe, 100);
  }
}, [symbol, timeframe, initialData]);
```

#### d) Listener para dados do MT5:
```typescript
useEffect(() => {
  const handleChartData = (message: any) => {
    console.log('Dados de gráfico recebidos do MT5:', message);
    if (message.data && message.data.candles) {
      const candles: CandlestickData[] = message.data.candles.map((candle: any) => ({
        time: candle.time as Time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      }));
      setChartData(candles);
      setIsLoading(false);
    }
  };

  mt5Service.on('CHART_DATA', handleChartData);

  return () => {
    mt5Service.off('CHART_DATA', handleChartData);
  };
}, []);
```

#### e) Busca automática ao mudar símbolo:
```typescript
// Buscar dados do MT5 quando símbolo ou timeframe mudar
useEffect(() => {
  // Se dados iniciais foram fornecidos via props, usar eles
  if (initialData && initialData.length > 0) {
    setChartData(initialData);
    return;
  }

  // Caso contrário, buscar dados do MT5
  if (symbol && mt5Service.getConnectionState().isConnected) {
    setIsLoading(true);
    mt5Service.getChartData(symbol, timeframe, 100);
  }
}, [symbol, timeframe, initialData]);
```

#### f) Indicador de carregamento:
```typescript
<div ref={chartContainerRef} className="w-full" style={{ height: `${height}px` }}>
  {isLoading && (
    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
      <div className="text-cyber-cyan font-space">Carregando dados do MT5...</div>
    </div>
  )}
</div>
```

---

## 🔧 Tipos TypeScript Atualizados

**Arquivo:** `src/types/mt5.ts`

Adicionado `CHART_DATA` ao tipo `MT5WebSocketMessage`:
```typescript
export interface MT5WebSocketMessage {
  type: 'STATE' | 'TICK' | 'POSITION' | 'ORDER' | 'TRADE' | 'ACCOUNT' | 'ORDER_RESULT' | 'ORDERBOOK' | 'CHART_DATA' | 'ERROR';
  data: any;
  timestamp: Date;
}
```

---

## 📊 Fluxo de Dados Completo

```
Frontend (CandlestickChart.tsx)
         │
         │ 1. useEffect detecta mudança de symbol/timeframe
         ↓
    mt5Service.getChartData(symbol, timeframe, count)
         │
         │ 2. Envia mensagem WebSocket
         ↓
    mt5_bridge.py (handle_get_chart_data)
         │
         │ 3. Mapeia timeframe para MT5
         │ 4. Obtém candles via mt5.copy_rates_from()
         │ 5. Converte para formato TradingView
         ↓
    Envia mensagem CHART_DATA via WebSocket
         │
         │ 6. mt5Service recebe e emite evento
         ↓
    CandlestickChart recebe dados via listener
         │
         │ 7. Atualiza estado chartData
         │ 8. Gráfico é atualizado
         ↓
    Gráfico mostra candles reais do MT5
```

---

## ✨ Funcionalidades Disponíveis

### Com a conexão MT5:
1. **Candles reais do MT5**: Dados OHLCV do mercado
2. **Seleção de ativo editável**: Input para digitar qualquer símbolo (EURUSD, PETR4, etc.)
3. **Carregamento automático**: Dados carregam ao digitar e pressionar Enter
4. **Timeframes variáveis**: 1m, 5m, 15m, 30m, 1H, 4H, 1D, 1W, 1M
5. **Volume real**: tick_volume ou real_volume do MT5
6. **Atualização automática**: Ao mudar timeframe ou símbolo
7. **Indicadores técnicos**: MA7, MA21, MA50, RSI
8. **Indicador de carregamento**: Feedback visual durante a busca
9. **Conversão automática para maiúsculas**: Digite em minúsculas, converte automaticamente

### Sem conexão MT5:
- Usa dados simulados (via props `initialData`)
- Mantém funcionalidade do gráfico

---

## 🧪 Teste da Implementação

### Para testar:

1. **Iniciar o servidor Python:**
   ```bash
   python mt5_bridge.py
   ```

2. **Conectar ao MT5:**
   - Use o formulário de conexão
   - Entre com suas credenciais MT5

3. **Visualizar gráfico:**
   - O gráfico deve carregar automaticamente ao conectar com o símbolo padrão (PETR4)
   - **Digite um novo ativo no campo de símbolo** (ex: EURUSD, BTCUSD, VALE3)
   - Pressione **Enter** ou clique no ícone de refresh para carregar
   - Use o seletor de timeframes para mudar o período
   - Candles devem mostrar dados reais do MT5

4. **Logs para debug:**
   ```javascript
   // Console do navegador
   Dados de gráfico recebidos do MT5: { type: 'CHART_DATA', data: {...} }
   ```

---

## 📝 Exemplo de Uso

```typescript
import CandlestickChart from '@/components/CandlestickChart';

export default function Dashboard() {
  return (
    <CandlestickChart 
      symbol="EURUSD"
      timeframe="1H"
      height={500}
      showVolume={true}
      onTimeframeChange={(tf) => console.log('Timeframe:', tf)}
    />
  );
}
```

---

## 🔍 Solução de Problemas

### Dados não aparecem:
- Verifique se o MT5 está conectado
- Verifique os logs do servidor Python
- Verifique o console do navegador

### Erro "CHART_DATA_ERROR":
- Verifique se o símbolo existe no MT5
- Verifique se há dados históricos disponíveis

### Gráfico mostra dados simulados:
- Verifique a conexão com o MT5
- Certifique-se de que não está passando `initialData` via props

---

## 📚 Documentação Relacionada

- **CHART_DATA_ANALYSIS.md**: Análise detalhada do formato de dados
- **MT5_BRIDGE_README.md**: Documentação do servidor Python
- **MT5_INTEGRATION_GUIDE.md**: Guia de integração MT5

---

## 🎯 Próximas Melhorias Possíveis

1. **Atualização em tempo real**: Adicionar novos candles conforme chegam
2. **Cache de dados**: Armazenar candles para evitar requisições repetidas
3. **Timeframes customizados**: Permitir valores arbitrários de timeframe
4. **Indicadores avançados**: MACD, Bollinger Bands, etc.
5. **Múltiplos símbolos**: Comparar símbolos no mesmo gráfico

---

**Implementação realizada em:** 04/01/2026
**Status:** ✅ Concluído e funcionando

---

## 🎯 Atualizações Recentes

### Input Editável para Seleção de Ativo (04/01/2026)
- ✅ Campo de input para digitar qualquer símbolo
- ✅ Conversão automática para maiúsculas
- ✅ Carregamento ao pressionar Enter
- ✅ Botão de refresh para recarregar dados
- ✅ Atualização automática do gráfico ao mudar símbolo
- ✅ Validação de conexão MT5 antes de carregar
