"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { TrendingUp, TrendingDown, DollarSign, Activity, BarChart3, RefreshCw } from "lucide-react";
import { CandlestickData, UTCTimestamp } from "lightweight-charts";
import CandlestickChart from "@/components/CandlestickChart";
import AIChat from "@/components/AIChat";
import OrderForm from "@/components/OrderForm";
import OrderBook from "@/components/OrderBook";
import OpenPositions from "@/components/OpenPositions";
import { MT5AccountInfo, MT5Tick, MT5Candle, MT5ConnectionStatus } from "@/types/mt5";
import { MT5ServiceSingleton } from "@/services/mt5Service";
import { useToast } from "@/contexts/ToastContext";

// Module-scope singleton — not inside component
const mt5Service = MT5ServiceSingleton.getInstance();

const SYMBOL_PRESETS = ["PETR4", "VALE3", "ITUB4", "BBDC4", "ABEV3", "WEGE3"];
const TIMEFRAMES = ["1m", "5m", "15m", "1H", "4H", "1D"];

function mt5CandlesToChartData(candles: MT5Candle[]): CandlestickData[] {
  return candles.map((c) => ({
    time: c.time as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

interface DashboardTabProps {
  accountInfo: MT5AccountInfo | null;
  tickData: Map<string, MT5Tick>;
}

export default function DashboardTab({ accountInfo, tickData }: DashboardTabProps) {
  const toast = useToast();

  const [chartData, setChartData] = useState<CandlestickData[]>([]);
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
  const [isConnected, setIsConnected] = useState(
    mt5Service.getConnectionState().state === "CONNECTED"
  );

  const loadChartData = useCallback(
    async (symbol: string, timeframe: string) => {
      if (!symbol) return;

      const state = mt5Service.getConnectionState();
      if (state.state !== "CONNECTED") return;

      setIsLoadingChart(true);
      try {
        const candles = await mt5Service.getChartData(symbol, timeframe, 300);
        setChartData(mt5CandlesToChartData(candles));
      } catch (err) {
        console.error("[DashboardTab] loadChartData error:", err);
        toast.error("Erro ao carregar dados do gráfico");
      } finally {
        setIsLoadingChart(false);
      }
    },
    [toast]
  );

  // Load when symbol or timeframe changes
  useEffect(() => {
    loadChartData(selectedSymbol, selectedTimeframe);
  }, [selectedSymbol, selectedTimeframe, loadChartData]);

  // Reload when MT5 connects; keep isConnected reactive.
  // mt5Service reemite "state" a cada poll de 5s mesmo sem mudança real —
  // só recarrega o gráfico numa transição real para CONNECTED, senão o
  // isLoadingChart pisca (desmonta/remonta o CandlestickChart) a cada poll.
  const wasConnectedRef = useRef(isConnected);
  useEffect(() => {
    const handler = (status: MT5ConnectionStatus) => {
      const nowConnected = status.state === "CONNECTED";
      setIsConnected(nowConnected);
      if (nowConnected && !wasConnectedRef.current) {
        loadChartData(selectedSymbol, selectedTimeframe);
      }
      wasConnectedRef.current = nowConnected;
    };
    mt5Service.on("state", handler);
    return () => {
      mt5Service.off("state", handler);
    };
  }, [selectedSymbol, selectedTimeframe, loadChartData]);

  // Subscribe to ticks whenever symbol or connection changes
  useEffect(() => {
    if (isConnected) {
      mt5Service.subscribeTicks(selectedSymbol);
    }
  }, [selectedSymbol, isConnected]);

  // Update last candle in real-time with tick data
  useEffect(() => {
    const handler = (tick: MT5Tick) => {
      if (tick.symbol !== selectedSymbol) return;
      const price = tick.bid || tick.last;
      if (!price) return;

      setChartData((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const last = { ...updated[updated.length - 1] };
        last.close = price;
        if (price > last.high) last.high = price;
        if (price < last.low) last.low = price;
        updated[updated.length - 1] = last;
        return updated;
      });
    };
    mt5Service.on("tick", handler);
    return () => {
      mt5Service.off("tick", handler);
    };
  }, [selectedSymbol]);

  const handleCustomSymbolSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = customSymbol.trim().toUpperCase();
    if (sym) {
      setSelectedSymbol(sym);
      setCustomSymbol("");
    }
  };

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
          change={
            accountInfo && accountInfo.balance > 0
              ? `${accountInfo.equity >= accountInfo.balance ? "+" : ""}${((accountInfo.equity - accountInfo.balance) / accountInfo.balance * 100).toFixed(2)}%`
              : "---"
          }
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
            <AIChat accountInfo={accountInfo} tickData={tickData} selectedSymbol={selectedSymbol} />
          </div>
        </div>
        <div className="lg:col-span-3 cyber-card p-4 hud-corner">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-orbitron text-lg font-bold text-white neon-text-pink">
              Gráfico de Preços
            </h2>
            <button
              onClick={() => loadChartData(selectedSymbol, selectedTimeframe)}
              disabled={isLoadingChart || !isConnected}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-cyber-cyan border border-cyber-cyan/30 hover:bg-cyber-cyan/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Recarregar gráfico"
            >
              <RefreshCw className={`w-3 h-3 ${isLoadingChart ? "animate-spin" : ""}`} />
              Atualizar
            </button>
          </div>

          {/* Symbol selector */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {SYMBOL_PRESETS.map((sym) => (
              <button
                key={sym}
                onClick={() => setSelectedSymbol(sym)}
                className={`px-3 py-1 rounded text-xs font-space font-semibold transition-colors border ${
                  selectedSymbol === sym
                    ? "bg-cyber-cyan text-black border-cyber-cyan"
                    : "text-gray-400 border-gray-600 hover:border-cyber-cyan/50 hover:text-white"
                }`}
              >
                {sym}
              </button>
            ))}
            <form onSubmit={handleCustomSymbolSubmit} className="flex items-center gap-1">
              <input
                type="text"
                value={customSymbol}
                onChange={(e) => setCustomSymbol(e.target.value.toUpperCase())}
                placeholder="Ex: MGLU3"
                className="px-2 py-1 rounded text-xs font-space bg-gray-800 border border-gray-600 text-white placeholder-gray-500 focus:border-cyber-cyan focus:outline-none w-24"
              />
              <button
                type="submit"
                className="px-2 py-1 rounded text-xs font-space border border-gray-600 text-gray-400 hover:border-cyber-cyan/50 hover:text-white transition-colors"
              >
                Ir
              </button>
            </form>
          </div>

          {/* Volume toggle */}
          <label className="flex items-center gap-2 text-sm font-space text-gray-400 cursor-pointer hover:text-white mb-4">
            <input
              type="checkbox"
              checked={showVolume}
              onChange={(e) => setShowVolume(e.target.checked)}
              className="w-4 h-4 accent-cyber-cyan"
            />
            Mostrar Volume
          </label>

          {/* Chart area */}
          {isLoadingChart ? (
            <div className="flex items-center justify-center h-64 text-gray-400 font-space">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              Carregando dados do gráfico...
            </div>
          ) : !isConnected && chartData.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-gray-500 font-space text-sm">
              Conecte ao MT5 para ver o gráfico
            </div>
          ) : !selectedSymbol ? (
            <div className="flex items-center justify-center h-64 text-gray-500 font-space text-sm">
              Selecione um símbolo para ver o gráfico
            </div>
          ) : (
            <CandlestickChart
              data={chartData}
              symbol={selectedSymbol}
              showVolume={showVolume}
              timeframe={selectedTimeframe}
              onTimeframeChange={setSelectedTimeframe}
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
  title,
  value,
  change,
  positive,
  icon,
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
        <span className="text-gray-400 text-sm font-space">{title}</span>
        <div className="text-cyber-cyan">{icon}</div>
      </div>
      <p className="text-2xl font-bold font-orbitron text-white mb-1">{value}</p>
      {change && (
        <p className={`text-sm font-space ${positive ? "text-green-400" : "text-red-400"}`}>
          {positive ? <TrendingUp className="w-3 h-3 inline mr-1" /> : <TrendingDown className="w-3 h-3 inline mr-1" />}
          {change}
        </p>
      )}
    </div>
  );
}
