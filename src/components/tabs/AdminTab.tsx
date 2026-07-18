"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, CheckCircle, XCircle, Loader2, Wifi, WifiOff, Bot, Power } from "lucide-react";
import { MT5ServiceSingleton } from "@/services/mt5Service";

interface ServiceResult {
  name: string;
  url: string;
  status: "online" | "offline";
  latencyMs: number | null;
  error: string | null;
}

interface ServicesPayload {
  services: ServiceResult[];
  checkedAt: string;
}

const mt5Service = MT5ServiceSingleton.getInstance();

const SERVICE_LABELS: Record<string, string> = {
  spread_api: "Spread API (B3)",
  volatility_api: "Volatility API",
  mt5_bridge: "MT5 Bridge (WebSocket)",
};

export default function AdminTab() {
  const [data, setData] = useState<ServicesPayload | null>(null);
  const [mt5Status, setMt5Status] = useState<"online" | "offline">("offline");
  const [mcpStatus, setMcpStatus] = useState<McpPilotStatus | null>(null);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/services-status", { cache: "no-store" });
      if (res.ok) {
        const json: ServicesPayload = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error("Admin status fetch failed:", err);
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  const fetchMcpStatus = useCallback(async () => {
    if (!window.electronAPI) {
      setMcpStatus(null);
      return;
    }
    try {
      setMcpStatus(await window.electronAPI.getMcpStatus());
    } catch {
      setMcpStatus({
        state: "error",
        endpoint: "",
        managedByElectron: false,
        pid: null,
        error: "Não foi possível consultar o MCP.",
        wsAuthReady: false,
      });
    }
  }, []);

  const handleMcpToggle = async () => {
    if (!window.electronAPI || mcpLoading) return;
    setMcpLoading(true);
    try {
      const isRunning = mcpStatus?.state === "online" || mcpStatus?.state === "starting";
      setMcpStatus(isRunning
        ? await window.electronAPI.stopMcpPilot()
        : await window.electronAPI.startMcpPilot());
    } finally {
      setMcpLoading(false);
      await fetchMcpStatus();
    }
  };

  useEffect(() => {
    fetchMcpStatus();
    const interval = setInterval(fetchMcpStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchMcpStatus]);

  useEffect(() => {
    const syncMt5 = () => {
      const state = mt5Service.getConnectionState();
      setMt5Status(state.state === "CONNECTED" ? "online" : "offline");
    };
    syncMt5();
    mt5Service.on("state", syncMt5);
    return () => { mt5Service.off("state", syncMt5); };
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const allServices: ServiceResult[] = [
    ...(data?.services ?? []),
    {
      name: "mt5_bridge",
      url: "ws://localhost:8766 (mt5Service)",
      status: mt5Status,
      latencyMs: null,
      error: mt5Status === "offline" ? "Not connected" : null,
    },
  ];

  const mcpIsOnline = mcpStatus?.state === "online";
  const onlineCount = allServices.filter((s) => s.status === "online").length + (mcpIsOnline ? 1 : 0);
  const totalServices = allServices.length + 1;

  const refreshAll = () => {
    fetchStatus();
    fetchMcpStatus();
  };

  return (
    <div className="cyber-card p-6 hud-corner">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-orbitron text-2xl font-bold text-white neon-text-cyan">
            Administração
          </h2>
          <p className="text-xs text-gray-400 font-space mt-1">
            {onlineCount}/{totalServices} serviços online
            {lastRefresh && (
              <span className="ml-2 text-gray-600">
                — {lastRefresh.toLocaleTimeString("pt-BR")}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={refreshAll}
          disabled={loading || mcpLoading}
          className="cyber-button cyber-button-secondary flex items-center gap-2"
        >
          {loading
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <RefreshCw className="w-4 h-4" />}
          <span className="font-space text-sm">Atualizar</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {allServices.map((svc) => (
          <ServiceCard key={svc.name} service={svc} loading={loading && !data} />
        ))}
        <McpCard status={mcpStatus} loading={mcpLoading} onToggle={handleMcpToggle} />
      </div>

      <div className="text-xs text-gray-500 font-space border-t border-cyber-border pt-4">
        Auto-refresh a cada 30s. Timeout HTTP: 2s. mt5_bridge via WebSocket singleton.
      </div>
    </div>
  );
}

function McpCard({
  status,
  loading,
  onToggle,
}: {
  status: McpPilotStatus | null;
  loading: boolean;
  onToggle: () => void;
}) {
  const state = status?.state ?? "offline";
  const isOnline = state === "online";
  const isStarting = state === "starting";
  const canControl = typeof window !== "undefined"
    && Boolean(window.electronAPI)
    && (state !== "online" || Boolean(status?.managedByElectron));
  const border = isOnline ? "border-green-500/40" : state === "error" ? "border-red-500/40" : "border-cyber-border";
  const label = isOnline ? "ONLINE" : isStarting ? "INICIANDO" : state === "error" ? "ERRO" : "OFFLINE";

  return (
    <div className={`cyber-card p-4 hud-corner border ${border}`}>
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-orbitron text-sm text-white leading-tight">MCP</h3>
        {loading || isStarting
          ? <Loader2 className="w-4 h-4 text-cyber-cyan animate-spin flex-shrink-0" />
          : isOnline
            ? <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
            : <Bot className="w-4 h-4 text-gray-500 flex-shrink-0" />}
      </div>
      <div className="flex items-center gap-2 mb-2">
        {isOnline ? <Wifi className="w-3 h-3 text-green-400" /> : <WifiOff className="w-3 h-3 text-red-400" />}
        <span className={`text-sm font-space font-semibold ${isOnline ? "text-green-400" : state === "error" ? "text-red-400" : "text-gray-400"}`}>
          {label}
        </span>
      </div>
      <p className="text-xs text-gray-600 font-space truncate" title={status?.endpoint ?? ""}>
        {status?.endpoint || "Disponível somente no app desktop"}
      </p>
      {status?.error && <p className="text-xs text-red-400/70 font-space mt-1">{status.error}</p>}
      {status && !status.wsAuthReady && <p className="text-xs text-yellow-400/80 font-space mt-1">Bridge MT5 sem autenticação.</p>}
      <button
        type="button"
        onClick={onToggle}
        disabled={!canControl || loading || isStarting}
        className="cyber-button cyber-button-secondary mt-3 w-full flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <Power className="w-3 h-3" />
        <span className="font-space text-xs">{isOnline ? "Desligar" : "Ligar"}</span>
      </button>
    </div>
  );
}

function ServiceCard({
  service,
  loading,
}: {
  service: ServiceResult;
  loading: boolean;
}) {
  const isOnline = service.status === "online";
  const label = SERVICE_LABELS[service.name] ?? service.name;

  return (
    <div
      className={`cyber-card p-4 hud-corner border transition-colors ${
        loading ? "border-gray-700" : isOnline ? "border-green-500/40" : "border-red-500/40"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-orbitron text-sm text-white leading-tight">{label}</h3>
        {loading ? (
          <Loader2 className="w-4 h-4 text-gray-500 animate-spin flex-shrink-0" />
        ) : isOnline ? (
          <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
        ) : (
          <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
        )}
      </div>

      <div className="flex items-center gap-2 mb-2">
        {isOnline
          ? <Wifi className="w-3 h-3 text-green-400" />
          : <WifiOff className="w-3 h-3 text-red-400" />}
        <span className={`text-sm font-space font-semibold ${isOnline ? "text-green-400" : "text-red-400"}`}>
          {loading ? "verificando..." : isOnline ? "ONLINE" : "OFFLINE"}
        </span>
      </div>

      {service.latencyMs !== null && (
        <p className="text-xs text-gray-400 font-jetbrains">
          Latência:{" "}
          <span className={
            service.latencyMs < 100 ? "text-green-400"
            : service.latencyMs < 500 ? "text-yellow-400"
            : "text-red-400"
          }>
            {service.latencyMs} ms
          </span>
        </p>
      )}

      {service.error && (
        <p className="text-xs text-red-400/70 font-space mt-1 truncate" title={service.error}>
          {service.error}
        </p>
      )}

      <p className="text-xs text-gray-600 font-space mt-2 truncate" title={service.url}>
        {service.url}
      </p>
    </div>
  );
}
