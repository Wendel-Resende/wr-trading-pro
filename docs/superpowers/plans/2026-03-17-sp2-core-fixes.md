# Sub-projeto 2 — Core Fixes: Implementação

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir as 4 funcionalidades quebradas: candles reais no Dashboard, spread orders persistidas no banco SQLite, preços do Monitoramento atualizando em tempo real via MT5, e OrderForm usando sistema de toast.

**Architecture:** Cada fix é independente. O mt5Service já tem suporte a `GET_CHART_DATA` — só precisa de um método público e integração no DashboardTab. O spreadOrderService usa localStorage e precisa ser reescrito para chamar a API REST (modelo Prisma já existe). O MonitoringTab precisa subscrever ticks MT5 e chamar o sync-prices com debounce de 5s. O OrderForm já envia ordens ao MT5 mas precisa usar o novo sistema de toast.

**Tech Stack:** Next.js 15, React 19, TypeScript, Prisma/SQLite, WebSocket (mt5Service), Python mt5_bridge.py

---

## Mapa de Arquivos

### Modificados
- `src/services/mt5Service.ts` — adicionar método público `getChartData(symbol, timeframe, count)`
- `src/services/spreadOrderService.ts` — reescrever para usar API REST em vez de localStorage
- `src/components/tabs/DashboardTab.tsx` — integrar getChartData, adicionar seletor de símbolo
- `src/components/tabs/MonitoringTab.tsx` — subscrever ticks MT5, debounce → sync-prices
- `src/components/OrderForm.tsx` — substituir alert() por useToast()
- `src/app/api/spread-orders/route.ts` — adicionar suporte a PENDING orders (GET/POST/PATCH/DELETE)

---

## Task 1: Adicionar `getChartData()` ao mt5Service

**Files:**
- Modify: `src/services/mt5Service.ts`

O mt5_bridge.py já processa `GET_CHART_DATA` e retorna `CHART_DATA`. O mt5Service precisa de um método público que:
1. Envia `{type: "GET_CHART_DATA", symbol, timeframe, count}` pelo WebSocket
2. Retorna Promise que resolve quando `CHART_DATA` chega com matching symbol/timeframe

- [ ] **Step 1: Ler mt5Service.ts para entender a estrutura atual**

```bash
cat "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_\src\services\mt5Service.ts"
```

- [ ] **Step 2: Verificar se getChartData já existe**

```bash
grep -n "getChartData\|CHART_DATA\|chart_data" "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_\src\services\mt5Service.ts"
```

- [ ] **Step 3: Adicionar tipo MT5Candle ao arquivo de tipos**

Abrir `src/types/mt5.ts` e adicionar no final:

```typescript
export interface MT5Candle {
  time: number; // Unix timestamp em segundos
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

- [ ] **Step 4: Adicionar método getChartData ao mt5Service**

Dentro da classe `MT5Service`, após os outros métodos públicos (perto do `sendOrder`, `getPositions`, etc.), adicionar:

```typescript
/**
 * Busca dados históricos de candles para um símbolo e timeframe
 * @param symbol - Símbolo (ex: "PETR4", "VALE3")
 * @param timeframe - Timeframe (ex: "1m", "5m", "15m", "1H", "4H", "1D")
 * @param count - Número de candles a buscar (padrão: 200)
 */
getChartData(symbol: string, timeframe: string, count: number = 200): Promise<MT5Candle[]> {
  return new Promise((resolve, reject) => {
    if (!this.ws || this.connectionState.state !== 'CONNECTED') {
      reject(new Error('MT5 não conectado'));
      return;
    }

    const timeout = setTimeout(() => {
      this.off('chartData', handler);
      reject(new Error('Timeout ao buscar chart data'));
    }, 15000);

    const handler = (data: { symbol: string; timeframe: string; candles: MT5Candle[] }) => {
      if (data.symbol === symbol && data.timeframe === timeframe) {
        clearTimeout(timeout);
        this.off('chartData', handler);
        resolve(data.candles);
      }
    };

    this.on('chartData', handler);

    this.ws.send(JSON.stringify({
      type: 'GET_CHART_DATA',
      symbol,
      timeframe,
      count,
    }));
  });
}
```

- [ ] **Step 5: Garantir que o handler de CHART_DATA emite o evento 'chartData'**

Procurar onde as mensagens recebidas do WebSocket são processadas (normalmente em um `switch` ou `if` no método `handleMessage` ou similar):

```bash
grep -n "CHART_DATA\|chartData\|chart_data" "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_\src\services\mt5Service.ts"
```

Se não houver handler para `CHART_DATA`, adicionar no bloco de processamento de mensagens recebidas (onde outros tipos como TICK, ACCOUNT, etc. são tratados):

```typescript
case 'CHART_DATA': {
  // O bridge retorna: {type: "CHART_DATA", symbol, timeframe, data: [{time, open, high, low, close, volume}]}
  const candles: MT5Candle[] = (message.data || []).map((c: any) => ({
    time: typeof c.time === 'number' ? c.time : new Date(c.time).getTime() / 1000,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume || c.tick_volume || 0),
  }));
  this.emit('chartData', {
    symbol: message.symbol,
    timeframe: message.timeframe,
    candles,
  });
  break;
}
```

- [ ] **Step 6: Verificar TypeScript**

```bash
cd "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_"
npx tsc --noEmit 2>&1 | head -30
```

Esperado: sem erros.

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_"
git add src/services/mt5Service.ts src/types/mt5.ts
git commit -m "feat: adicionar getChartData() ao mt5Service + tipo MT5Candle"
```

---

## Task 2: Dashboard com candles reais do MT5

**Files:**
- Modify: `src/components/tabs/DashboardTab.tsx`

- [ ] **Step 1: Ler DashboardTab.tsx atual**

```bash
cat "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_\src\components\tabs\DashboardTab.tsx"
```

- [ ] **Step 2: Atualizar DashboardTab.tsx com candles reais**

Substituir o conteúdo de `src/components/tabs/DashboardTab.tsx`:

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { DollarSign, TrendingUp, Activity, BarChart3, RefreshCw } from "lucide-react";
import CandlestickChart from "@/components/CandlestickChart";
import AIChat from "@/components/AIChat";
import OrderForm from "@/components/OrderForm";
import OrderBook from "@/components/OrderBook";
import OpenPositions from "@/components/OpenPositions";
import { MT5ServiceSingleton } from "@/services/mt5Service";
import { MT5AccountInfo, MT5Tick, MT5Candle } from "@/types/mt5";
import { useToast } from "@/contexts/ToastContext";

interface DashboardTabProps {
  accountInfo: MT5AccountInfo | null;
  tickData: Map<string, MT5Tick>;
}

const mt5Service = MT5ServiceSingleton.getInstance();

const TIMEFRAMES = ["1m", "5m", "15m", "1H", "4H", "1D"];

// Símbolos padrão para B3
const DEFAULT_SYMBOLS = ["PETR4", "VALE3", "ITUB4", "BBDC4", "ABEV3", "WEGE3"];

export default function DashboardTab({ accountInfo, tickData }: DashboardTabProps) {
  const toast = useToast();
  const [chartData, setChartData] = useState<MT5Candle[]>([]);
  const [showVolume, setShowVolume] = useState(false);
  const [selectedTimeframe, setSelectedTimeframe] = useState("1H");
  const [selectedSymbol, setSelectedSymbol] = useState("PETR4");
  const [customSymbol, setCustomSymbol] = useState("");
  const [isLoadingChart, setIsLoadingChart] = useState(false);
  const [selectedIndicators, setSelectedIndicators] = useState([
    { name: "MA7", enabled: false, color: "#f59e0b" },
    { name: "MA21", enabled: false, color: "#8b5cf6" },
    { name: "MA50", enabled: false, color: "#ec4899" },
    { name: "RSI", enabled: false, color: "#06b6d4" },
  ]);

  const loadChartData = useCallback(async (symbol: string, timeframe: string) => {
    if (!symbol) return;
    const state = mt5Service.getConnectionState();
    if (state.state !== "CONNECTED") {
      toast.warning("Conecte ao MT5 para carregar o gráfico");
      return;
    }
    setIsLoadingChart(true);
    try {
      const candles = await mt5Service.getChartData(symbol, timeframe, 300);
      setChartData(candles);
    } catch (err: any) {
      toast.error(`Erro ao carregar gráfico: ${err.message}`);
    } finally {
      setIsLoadingChart(false);
    }
  }, [toast]);

  // Carregar candles quando símbolo ou timeframe muda
  useEffect(() => {
    loadChartData(selectedSymbol, selectedTimeframe);
  }, [selectedSymbol, selectedTimeframe, loadChartData]);

  // Recarregar quando MT5 conectar
  useEffect(() => {
    const handleState = (state: { state: string }) => {
      if (state.state === "CONNECTED") {
        loadChartData(selectedSymbol, selectedTimeframe);
      }
    };
    mt5Service.on("state", handleState);
    return () => mt5Service.off("state", handleState);
  }, [selectedSymbol, selectedTimeframe, loadChartData]);

  // Atualizar último candle com ticks em tempo real
  useEffect(() => {
    const handleTick = (tick: MT5Tick) => {
      if (tick.symbol !== selectedSymbol || chartData.length === 0) return;
      const price = tick.bid || tick.last;
      if (!price) return;

      setChartData((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        const updated = {
          ...last,
          close: price,
          high: Math.max(last.high, price),
          low: Math.min(last.low, price),
        };
        return [...prev.slice(0, -1), updated];
      });
    };
    mt5Service.on("tick", handleTick);
    return () => mt5Service.off("tick", handleTick);
  }, [selectedSymbol, chartData.length]);

  const handleSymbolSelect = (symbol: string) => {
    setSelectedSymbol(symbol);
    mt5Service.subscribeTicks(symbol);
  };

  const handleCustomSymbol = (e: React.FormEvent) => {
    e.preventDefault();
    if (customSymbol.trim()) {
      handleSymbolSelect(customSymbol.trim().toUpperCase());
      setCustomSymbol("");
    }
  };

  const currentTick = tickData.get(selectedSymbol);

  return (
    <div className="space-y-6">
      {/* Cards de conta */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Saldo Total"
          value={accountInfo ? `${accountInfo.currency} ${accountInfo.balance.toFixed(2)}` : "---"}
          change={accountInfo ? `${(accountInfo.profit ?? 0) >= 0 ? "+" : ""}${(accountInfo.profit ?? 0).toFixed(2)}` : "---"}
          positive={(accountInfo?.profit ?? 0) >= 0}
          icon={<DollarSign className="w-5 h-5" />}
        />
        <StatCard
          title="Equity"
          value={accountInfo ? `${accountInfo.currency} ${accountInfo.equity.toFixed(2)}` : "---"}
          change={accountInfo && accountInfo.balance > 0 ? `${accountInfo.equity >= accountInfo.balance ? "+" : ""}${((accountInfo.equity - accountInfo.balance) / accountInfo.balance * 100).toFixed(2)}%` : "---"}
          positive={accountInfo ? accountInfo.equity >= accountInfo.balance : false}
          icon={<TrendingUp className="w-5 h-5" />}
        />
        <StatCard
          title="Margem Livre"
          value={accountInfo ? `${accountInfo.currency} ${(accountInfo.marginFree ?? 0).toFixed(2)}` : "---"}
          change={accountInfo?.marginLevel ? `${accountInfo.marginLevel.toFixed(1)}% Nível` : "---"}
          icon={<Activity className="w-5 h-5" />}
        />
        <StatCard
          title="Leverage"
          value={accountInfo ? `1:${accountInfo.leverage ?? 0}` : "---"}
          change={accountInfo?.server || "---"}
          icon={<BarChart3 className="w-5 h-5" />}
        />
      </div>

      {/* Gráfico + AI Chat */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <div className="cyber-card p-4 hud-corner h-full">
            <AIChat />
          </div>
        </div>
        <div className="lg:col-span-3 cyber-card p-4 hud-corner">
          {/* Header do gráfico */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="font-orbitron text-lg font-bold text-white neon-text-pink">
              Gráfico de Preços
              {currentTick && (
                <span className="ml-3 text-cyber-cyan font-jetbrains text-base">
                  {currentTick.bid?.toFixed(currentTick.digits ?? 2)}
                  {currentTick.changePercent !== undefined && (
                    <span className={`ml-2 text-sm ${currentTick.changePercent >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {currentTick.changePercent >= 0 ? "+" : ""}{currentTick.changePercent.toFixed(2)}%
                    </span>
                  )}
                </span>
              )}
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => loadChartData(selectedSymbol, selectedTimeframe)}
                disabled={isLoadingChart}
                className="p-1.5 text-gray-400 hover:text-cyber-cyan transition-colors disabled:opacity-50"
                title="Recarregar gráfico"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingChart ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Seletor de símbolos */}
          <div className="flex flex-wrap gap-2 mb-3">
            {DEFAULT_SYMBOLS.map((s) => (
              <button
                key={s}
                onClick={() => handleSymbolSelect(s)}
                className={`px-3 py-1 text-xs font-space rounded transition-colors ${
                  selectedSymbol === s
                    ? "bg-cyber-pink/20 text-cyber-pink border border-cyber-pink/50"
                    : "bg-cyber-dark/50 text-gray-400 border border-cyber-border hover:text-white"
                }`}
              >
                {s}
              </button>
            ))}
            <form onSubmit={handleCustomSymbol} className="flex gap-1">
              <input
                type="text"
                value={customSymbol}
                onChange={(e) => setCustomSymbol(e.target.value.toUpperCase())}
                placeholder="Outro..."
                className="px-2 py-1 text-xs font-space bg-cyber-dark/50 border border-cyber-border rounded text-white placeholder-gray-500 w-20 focus:outline-none focus:border-cyber-cyan"
              />
              <button type="submit" className="px-2 py-1 text-xs font-space bg-cyber-cyan/20 text-cyber-cyan border border-cyber-cyan/50 rounded hover:bg-cyber-cyan/30 transition-colors">
                OK
              </button>
            </form>
          </div>

          <label className="flex items-center gap-2 text-sm font-space text-gray-400 cursor-pointer hover:text-white mb-4">
            <input
              type="checkbox"
              checked={showVolume}
              onChange={(e) => setShowVolume(e.target.checked)}
              className="w-4 h-4 accent-cyber-cyan"
            />
            Mostrar Volume
          </label>

          {chartData.length === 0 && !isLoadingChart ? (
            <div className="flex items-center justify-center h-64 text-gray-500 font-space text-sm">
              {mt5Service.getConnectionState().state === "CONNECTED"
                ? "Selecione um símbolo para ver o gráfico"
                : "Conecte ao MT5 para ver o gráfico"}
            </div>
          ) : (
            <CandlestickChart
              data={chartData}
              showVolume={showVolume}
              timeframe={selectedTimeframe}
              onTimeframeChange={(tf) => setSelectedTimeframe(tf)}
              indicators={selectedIndicators}
              onIndicatorChange={setSelectedIndicators}
            />
          )}
        </div>
      </div>

      {/* Boleta + Book + Posições */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1"><OrderForm /></div>
        <div className="lg:col-span-1"><OrderBook defaultSymbol={selectedSymbol} /></div>
        <div className="lg:col-span-1"><OpenPositions /></div>
      </div>
    </div>
  );
}

function StatCard({
  title, value, change, positive, icon,
}: {
  title: string;
  value: string;
  change?: string;
  positive?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="cyber-card p-4 hud-corner">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-400 font-space uppercase tracking-wider">{title}</p>
        <div className="text-cyber-cyan">{icon}</div>
      </div>
      <p className="text-xl font-jetbrains font-bold text-white">{value}</p>
      {change && (
        <p className={`text-xs font-space mt-1 ${positive ? "text-green-400" : "text-red-400"}`}>
          {change}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar se CandlestickChart aceita MT5Candle**

```bash
grep -n "data\|CandlestickData\|interface\|type" "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_\src\components\CandlestickChart.tsx" | head -20
```

Se o componente aceita `CandlestickData` do `lightweight-charts`, converter na interface:

```typescript
// No loadChartData, converter após buscar:
const candles = await mt5Service.getChartData(symbol, timeframe, 300);
// CandlestickData usa UTCTimestamp (número em segundos)
setChartData(candles);
```

Se o tipo não bater, ajustar conforme necessário.

- [ ] **Step 4: Verificar TypeScript**

```bash
cd "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_"
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_"
git add src/components/tabs/DashboardTab.tsx
git commit -m "feat: Dashboard com candles reais do MT5 + seletor de símbolo + atualização em tempo real"
```

---

## Task 3: Spread Orders — migrar localStorage → banco SQLite

**Files:**
- Modify: `src/app/api/spread-orders/route.ts` — adicionar suporte a PENDING orders
- Modify: `src/services/spreadOrderService.ts` — reescrever para usar API

O modelo `SpreadOrder` no Prisma tem campo `status`. Vamos usar:
- `PENDING` = ordem aguardando condição de spread
- `FILLED` = ordem executada no MT5
- `CANCELLED` = cancelada pelo usuário
- `FAILED` = falha na execução

- [ ] **Step 1: Ler o schema atual para o modelo SpreadOrder**

```bash
grep -A 30 "model SpreadOrder" "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_\prisma\schema.prisma"
```

- [ ] **Step 2: Verificar se o schema suporta PENDING**

```bash
grep -n "status\|PENDING\|FILLED\|CANCELLED\|FAILED" "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_\prisma\schema.prisma"
```

Se `status` for um enum, verificar se `PENDING` já está incluído. Se for String, já funciona.

- [ ] **Step 3: Atualizar `src/app/api/spread-orders/route.ts`**

Ler o arquivo atual e adicionar:
- `GET` — listar ordens por status (incluindo PENDING)
- `POST` — criar ordem PENDING (novo endpoint para ordens pendentes)
- `PATCH /api/spread-orders/[id]` — atualizar status de uma ordem

Substituir o conteúdo de `src/app/api/spread-orders/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateAsset } from "@/services/assetService";
import { serializeBigInt } from "@/lib/bigint-serializer";

// GET /api/spread-orders?status=PENDING
export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get("status");
    const orders = await prisma.spreadOrder.findMany({
      where: status ? { status } : undefined,
      include: {
        asset1: true,
        asset2: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ success: true, orders: serializeBigInt(orders) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST /api/spread-orders — criar ordem (PENDING ou FILLED)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      symbol1, symbol2,
      type1, type2,
      quantity1, quantity2,
      price1, price2,
      spreadValue,
      status = "PENDING",
      isAutomated = false,
      automationTarget,
      automationCondition,
      targetSpread,
      condition,
      mt5OrderTicket1,
      mt5OrderTicket2,
      localId, // ID local do spreadOrderService para rastrear
    } = body;

    if (!symbol1 || !symbol2) {
      return NextResponse.json({ success: false, error: "symbol1 e symbol2 são obrigatórios" }, { status: 400 });
    }

    const [asset1, asset2] = await Promise.all([
      getOrCreateAsset(symbol1),
      getOrCreateAsset(symbol2),
    ]);

    const order = await prisma.spreadOrder.create({
      data: {
        assetId1: asset1.id,
        assetId2: asset2.id,
        type1: type1 || "BUY",
        type2: type2 || "SELL",
        quantity1: quantity1 || 1,
        quantity2: quantity2 || 1,
        price1: price1 || 0,
        price2: price2 || 0,
        spreadValue: spreadValue || 0,
        status,
        isAutomated,
        automationTarget: automationTarget || targetSpread || 0,
        automationCondition: automationCondition || condition || "greater_than",
        mt5OrderTicket1: mt5OrderTicket1 ? BigInt(mt5OrderTicket1) : null,
        mt5OrderTicket2: mt5OrderTicket2 ? BigInt(mt5OrderTicket2) : null,
        filledAt: status === "FILLED" ? new Date() : null,
        ...(localId ? { metadata: localId } : {}),
      },
      include: { asset1: true, asset2: true },
    });

    return NextResponse.json({ success: true, order: serializeBigInt(order) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE /api/spread-orders — cancelar ordem por ID
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ success: false, error: "id é obrigatório" }, { status: 400 });
    }
    await prisma.spreadOrder.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Criar rota PATCH para atualizar status de uma ordem**

Criar `src/app/api/spread-orders/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/bigint-serializer";

// PATCH /api/spread-orders/[id] — atualizar status, preço executado, tickets MT5
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const { status, spreadValue, mt5OrderTicket1, mt5OrderTicket2, price1, price2 } = body;

    const order = await prisma.spreadOrder.update({
      where: { id: params.id },
      data: {
        ...(status ? { status } : {}),
        ...(spreadValue !== undefined ? { spreadValue } : {}),
        ...(price1 !== undefined ? { price1 } : {}),
        ...(price2 !== undefined ? { price2 } : {}),
        ...(mt5OrderTicket1 ? { mt5OrderTicket1: BigInt(mt5OrderTicket1) } : {}),
        ...(mt5OrderTicket2 ? { mt5OrderTicket2: BigInt(mt5OrderTicket2) } : {}),
        ...(status === "FILLED" ? { filledAt: new Date() } : {}),
      },
      include: { asset1: true, asset2: true },
    });

    return NextResponse.json({ success: true, order: serializeBigInt(order) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE /api/spread-orders/[id] — cancelar uma ordem específica
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.spreadOrder.update({
      where: { id: params.id },
      data: { status: "CANCELLED" },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
```

- [ ] **Step 5: Verificar se o schema Prisma tem campo `metadata` ANTES de usar no POST**

```bash
cd "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_"
grep -A 40 "model SpreadOrder" prisma/schema.prisma
```

**Se `metadata` NÃO existir no schema:** remover a linha `...(localId ? { metadata: localId } : {})` do POST em Step 3 antes de prosseguir. Não criar migration por causa desse campo opcional — localId é informação auxiliar que pode ser descartada.

**Se `metadata` existir:** manter como está.

- [ ] **Step 6: Verificar nome do evento que mt5Service emite após sendOrder()**

```bash
grep -n "emit.*order\|on.*order\|order.*emit" "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_\src\services\mt5Service.ts" -i
```

O código em `sendMT5Order` usa `mt5Service.on("order", handleResult)` — confirmar que o mt5Service emite `"order"` (não `"ORDER_RESULT"` ou outro nome) quando `sendOrder()` retorna resultado. Se o evento tiver nome diferente, atualizar as linhas `mt5Service.on("order", ...)` e `mt5Service.off("order", ...)` no `sendMT5Order` abaixo.

- [ ] **Step 7: Reescrever `src/services/spreadOrderService.ts`**

```typescript
import EventEmitter from "events";
import { SpreadPendingOrder, SpreadOrderStatus, SpreadSummary } from "@/types/spread";
import { MT5ServiceSingleton } from "@/services/mt5Service";
import { MT5Tick } from "@/types/mt5";

const mt5Service = MT5ServiceSingleton.getInstance();

/**
 * SpreadOrderService — gerencia ordens de spread com persistência no banco SQLite.
 * Ordens são salvas via API REST (/api/spread-orders) em vez de localStorage.
 */
class SpreadOrderService extends EventEmitter {
  private static instance: SpreadOrderService;
  private pendingOrders: SpreadPendingOrder[] = [];
  private executedOrders: SpreadPendingOrder[] = [];
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;
  private readonly MONITOR_INTERVAL = 1000;
  private currentPrices: Map<string, number> = new Map();
  private initialized = false;

  private constructor() {
    super();
    this.setupMT5Integration();
    this.loadFromDatabase();
  }

  static getInstance(): SpreadOrderService {
    if (!SpreadOrderService.instance) {
      SpreadOrderService.instance = new SpreadOrderService();
    }
    return SpreadOrderService.instance;
  }

  /** Carrega ordens pendentes do banco ao iniciar */
  private async loadFromDatabase() {
    if (this.initialized) return;
    try {
      const res = await fetch("/api/spread-orders?status=PENDING");
      const data = await res.json();
      if (data.success && data.orders) {
        this.pendingOrders = data.orders.map((o: any) => this.dbOrderToLocal(o));
        this.emit("ordersUpdated", { pending: this.pendingOrders, executed: this.executedOrders });
      }

      const resExecuted = await fetch("/api/spread-orders?status=FILLED");
      const dataExecuted = await resExecuted.json();
      if (dataExecuted.success && dataExecuted.orders) {
        this.executedOrders = dataExecuted.orders.map((o: any) => this.dbOrderToLocal(o));
      }

      this.initialized = true;
    } catch (err) {
      console.error("SpreadOrderService: erro ao carregar ordens do banco", err);
    }
  }

  /** Converte registro do banco para SpreadPendingOrder local */
  private dbOrderToLocal(o: any): SpreadPendingOrder {
    return {
      id: o.id,
      symbol1: o.asset1?.symbol || "",
      symbol2: o.asset2?.symbol || "",
      action1: (o.type1 || "BUY").toLowerCase() as "buy" | "sell",
      action2: (o.type2 || "SELL").toLowerCase() as "buy" | "sell",
      quantity1: o.quantity1 || 1,
      quantity2: o.quantity2 || 1,
      price1: o.price1 || 0,
      price2: o.price2 || 0,
      targetSpread: o.automationTarget || 0,
      condition: (o.automationCondition || "greater_than") as "greater_than" | "less_than" | "equal_to",
      currentSpread: 0,
      status: this.mapStatus(o.status),
      createdAt: new Date(o.createdAt),
      executedAt: o.filledAt ? new Date(o.filledAt) : undefined,
      order1Ticket: o.mt5OrderTicket1 ? Number(o.mt5OrderTicket1) : undefined,
      order2Ticket: o.mt5OrderTicket2 ? Number(o.mt5OrderTicket2) : undefined,
    };
  }

  private mapStatus(status: string): SpreadOrderStatus {
    const map: Record<string, SpreadOrderStatus> = {
      PENDING: SpreadOrderStatus.PENDING,
      FILLED: SpreadOrderStatus.EXECUTED,
      CANCELLED: SpreadOrderStatus.CANCELLED,
      FAILED: SpreadOrderStatus.FAILED,
    };
    return map[status] || SpreadOrderStatus.PENDING;
  }

  private setupMT5Integration() {
    const handleTick = (tick: MT5Tick) => {
      if (tick.symbol && tick.bid) {
        this.currentPrices.set(tick.symbol, tick.bid);
        this.updateCurrentSpreads(this.currentPrices);
      }
    };
    mt5Service.on("tick", handleTick);
  }

  private updateCurrentSpreads(prices: Map<string, number>) {
    let changed = false;
    this.pendingOrders = this.pendingOrders.map((order) => {
      const price1 = prices.get(order.symbol1);
      const price2 = prices.get(order.symbol2);
      if (price1 && price2) {
        const spread = price1 - price2;
        if (Math.abs(spread - order.currentSpread) > 0.0001) {
          changed = true;
          return { ...order, currentSpread: spread };
        }
      }
      return order;
    });
    if (changed) {
      this.emit("spreadsUpdated", this.pendingOrders);
    }
  }

  startMonitoring() {
    if (this.monitoringInterval) return;
    this.monitoringInterval = setInterval(() => this.checkAndExecuteOrders(), this.MONITOR_INTERVAL);
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  private async checkAndExecuteOrders() {
    for (const order of this.pendingOrders) {
      if (order.status !== SpreadOrderStatus.PENDING || (order as any).executing) continue;

      const { currentSpread, targetSpread, condition } = order;
      let triggered = false;
      if (condition === "greater_than" && currentSpread > targetSpread) triggered = true;
      if (condition === "less_than" && currentSpread < targetSpread) triggered = true;
      if (condition === "equal_to" && Math.abs(currentSpread - targetSpread) < 0.01) triggered = true;

      if (triggered) {
        await this.executeSpreadOrder(order);
      }
    }
  }

  private async executeSpreadOrder(order: SpreadPendingOrder) {
    (order as any).executing = true;
    try {
      const [result1, result2] = await Promise.all([
        this.sendMT5Order(order, 1),
        this.sendMT5Order(order, 2),
      ]);

      if (result1 && result2) {
        await this.markAsExecuted(order.id, result1, result2);
      } else {
        await this.markAsFailed(order.id, "Falha ao executar uma das pernas do spread");
      }
    } catch (err: any) {
      await this.markAsFailed(order.id, err.message);
    } finally {
      (order as any).executing = false;
    }
  }

  private sendMT5Order(order: SpreadPendingOrder, leg: 1 | 2): Promise<number | null> {
    return new Promise((resolve) => {
      const symbol = leg === 1 ? order.symbol1 : order.symbol2;
      const action = leg === 1 ? order.action1 : order.action2;
      const quantity = leg === 1 ? order.quantity1 : order.quantity2;

      const timeout = setTimeout(() => resolve(null), 10000);

      const handleResult = (result: any) => {
        if (result.symbol === symbol) {
          clearTimeout(timeout);
          mt5Service.off("order", handleResult);
          resolve(result.ticket || null);
        }
      };
      mt5Service.on("order", handleResult);

      mt5Service.sendOrder({
        action: "TRADE_ACTION_DEAL",
        symbol,
        volume: quantity,
        type: action === "buy" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
        comment: `Spread ${order.symbol1}/${order.symbol2}`,
        deviation: 10,
      }).catch(() => {
        clearTimeout(timeout);
        mt5Service.off("order", handleResult);
        resolve(null);
      });
    });
  }

  private async markAsExecuted(id: string, ticket1: number, ticket2: number) {
    await fetch(`/api/spread-orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "FILLED",
        mt5OrderTicket1: ticket1,
        mt5OrderTicket2: ticket2,
      }),
    });

    this.pendingOrders = this.pendingOrders.filter((o) => o.id !== id);
    this.emit("orderExecuted", id);
    this.emit("ordersUpdated", { pending: this.pendingOrders, executed: this.executedOrders });
  }

  private async markAsFailed(id: string, error: string) {
    await fetch(`/api/spread-orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "FAILED" }),
    });
    this.pendingOrders = this.pendingOrders.filter((o) => o.id !== id);
    this.emit("orderFailed", { id, error });
    this.emit("ordersUpdated", { pending: this.pendingOrders, executed: this.executedOrders });
  }

  /** Adiciona nova ordem pendente e persiste no banco */
  async addPendingOrder(orderData: Omit<SpreadPendingOrder, "id" | "currentSpread" | "status" | "createdAt">): Promise<SpreadPendingOrder> {
    const res = await fetch("/api/spread-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol1: orderData.symbol1,
        symbol2: orderData.symbol2,
        type1: orderData.action1.toUpperCase(),
        type2: orderData.action2.toUpperCase(),
        quantity1: orderData.quantity1,
        quantity2: orderData.quantity2,
        price1: orderData.price1,
        price2: orderData.price2,
        spreadValue: 0,
        status: "PENDING",
        targetSpread: orderData.targetSpread,
        condition: orderData.condition,
        isAutomated: true,
      }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Erro ao criar ordem");

    const newOrder: SpreadPendingOrder = {
      ...this.dbOrderToLocal(data.order),
      currentSpread: 0,
    };

    this.pendingOrders.push(newOrder);
    this.emit("ordersUpdated", { pending: this.pendingOrders, executed: this.executedOrders });

    // Subscrever ticks dos símbolos
    mt5Service.subscribeTicks(orderData.symbol1);
    mt5Service.subscribeTicks(orderData.symbol2);

    return newOrder;
  }

  /** Cancela uma ordem e atualiza no banco */
  async cancelOrder(id: string): Promise<void> {
    await fetch(`/api/spread-orders/${id}`, { method: "DELETE" });
    this.pendingOrders = this.pendingOrders.filter((o) => o.id !== id);
    this.emit("ordersUpdated", { pending: this.pendingOrders, executed: this.executedOrders });
  }

  getPendingOrders(): SpreadPendingOrder[] {
    return [...this.pendingOrders];
  }

  getExecutedOrders(): SpreadPendingOrder[] {
    return [...this.executedOrders];
  }

  getSummary(): SpreadSummary {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayExecuted = this.executedOrders.filter(
      (o) => o.executedAt && o.executedAt >= today
    );
    return {
      pendingCount: this.pendingOrders.length,
      executedToday: todayExecuted.length,
      totalProfit: todayExecuted.reduce((sum, o) => sum + (o.profit || 0), 0),
    };
  }
}

export const spreadOrderService = SpreadOrderService.getInstance();
export default SpreadOrderService;
```

- [ ] **Step 7: Verificar TypeScript**

```bash
cd "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_"
npx tsc --noEmit 2>&1 | head -40
```

Corrigir erros encontrados (especialmente tipos de SpreadSummary — verificar interface em `src/types/spread.ts`).

- [ ] **Step 8: Commit**

```bash
cd "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_"
git add src/app/api/spread-orders/ src/services/spreadOrderService.ts
git commit -m "feat: spread orders persistidas no SQLite — remove localStorage"
```

---

## Task 4: Monitoramento — Pipeline de preços MT5 em tempo real

**Files:**
- Modify: `src/components/tabs/MonitoringTab.tsx`

O MT5 recebe ticks. Quando um tick chega para um símbolo que está no monitoramento, atualizamos o preço no banco com debounce de 5 segundos (via `/api/stock-monitoring/sync-prices`).

- [ ] **Step 1: Ler MonitoringTab.tsx atual**

```bash
cat "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_\src\components\tabs\MonitoringTab.tsx"
```

- [ ] **Step 2: Ler o endpoint sync-prices para entender o payload esperado**

```bash
cat "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_\src\app\api\stock-monitoring\sync-prices\route.ts"
```

- [ ] **Step 3: Adicionar hook de preços em tempo real ao MonitoringTab**

Adicionar após os imports existentes em `MonitoringTab.tsx`:

```typescript
import { useEffect, useRef } from "react";
import { MT5ServiceSingleton } from "@/services/mt5Service";
import { MT5Tick } from "@/types/mt5";
```

Dentro do componente `MonitoringTab`, adicionar após os estados existentes:

```typescript
const [refreshKey, setRefreshKey] = useState(0); // controla re-render após sync de preços
const mt5Service = MT5ServiceSingleton.getInstance();
const pendingPriceUpdate = useRef<Map<string, number>>(new Map());
const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

// Sincronizar preços via MT5 ticks com debounce de 5s
useEffect(() => {
  const handleTick = (tick: MT5Tick) => {
    if (!tick.symbol || !tick.bid) return;
    // Acumula preços recebidos
    pendingPriceUpdate.current.set(tick.symbol, tick.bid);

    // Debounce: só sincroniza com o banco após 5s de inatividade
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      const updates = pendingPriceUpdate.current;
      if (updates.size === 0) return;
      pendingPriceUpdate.current = new Map();

      try {
        // Formatar como array de positions que o sync-prices espera
        const positions = Array.from(updates.entries()).map(([symbol, price]) => ({
          symbol,
          currentPrice: price,
          priceCurrent: price,
        }));

        const res = await fetch("/api/stock-monitoring/sync-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positions }),
        });

        const data = await res.json();
        if (data.success && data.synced > 0) {
          // Forçar re-render da tabela com novos preços
          setRefreshKey((k) => k + 1);
        }
      } catch (err) {
        console.error("Erro ao sincronizar preços:", err);
      }
    }, 5000);
  };

  mt5Service.on("tick", handleTick);
  return () => {
    mt5Service.off("tick", handleTick);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
  };
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: Verificar TypeScript**

```bash
cd "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_"
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_"
git add src/components/tabs/MonitoringTab.tsx
git commit -m "feat: Monitoramento atualiza preços em tempo real via MT5 ticks (debounce 5s)"
```

---

## Task 5: OrderForm — substituir alert() por toast

**Files:**
- Modify: `src/components/OrderForm.tsx`

- [ ] **Step 1: Verificar se OrderForm usa alert()**

```bash
grep -n "alert\|confirm\|toast" "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_\src\components\OrderForm.tsx"
```

- [ ] **Step 2: Substituir alert() por useToast()**

Se encontrar `alert()`, adicionar o import e substituir:

```typescript
// Adicionar import
import { useToast } from "@/contexts/ToastContext";

// Dentro do componente, adicionar:
const toast = useToast();

// Substituir:
// alert("Ordem enviada com sucesso!") → toast.success("Ordem enviada com sucesso!")
// alert("Erro: " + msg) → toast.error("Erro: " + msg)
```

Se OrderForm já usa toast (verificar), pular este passo.

- [ ] **Step 3: Verificar se OrderForm está integrado com mt5Service.sendOrder()**

```bash
grep -n "sendOrder\|mt5Service\|mt5service" "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_\src\components\OrderForm.tsx"
```

Se `sendOrder` já está sendo chamado, a boleta já está funcional. Confirmar e documentar.

- [ ] **Step 4: Verificar TypeScript**

```bash
cd "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_"
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit (só se houver mudanças)**

```bash
cd "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_"
git add src/components/OrderForm.tsx
git commit -m "fix: substituir alert() por toast no OrderForm"
```

---

## Validação Final do Sub-projeto 2

- [ ] `npm run dev` inicia sem erros
- [ ] Dashboard: com MT5 conectado, candles carregam ao selecionar símbolo
- [ ] Dashboard: gráfico atualiza quando tick chega
- [ ] Spread: criar ordem salva no banco (verificar via `npx prisma studio`)
- [ ] Spread: reiniciar a plataforma e ordens pendentes recarregam
- [ ] Monitoramento: com MT5 conectado, preços atualizam após ~5s de receber ticks
- [ ] TypeScript: `npx tsc --noEmit` sem erros

```bash
# Verificação rápida de integridade
cd "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_"
npx tsc --noEmit 2>&1 | wc -l  # deve ser 0
git log --oneline | head -10
```
