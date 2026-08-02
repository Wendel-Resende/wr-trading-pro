"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, CheckCircle, XCircle, Loader2, Wifi, WifiOff, Bot, Power } from "lucide-react";
import { MT5ServiceSingleton } from "@/services/mt5Service";
import type { MT5ConnectionStatus } from "@/types/mt5";

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
  mt5_bridge: "MT5 MCP Nativo",
};

export default function AdminTab() {
  const [data, setData] = useState<ServicesPayload | null>(null);
  const [mt5Connection, setMt5Connection] = useState<MT5ConnectionStatus>(mt5Service.getConnectionState());
  const [mt5Connecting, setMt5Connecting] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<McpPilotStatus | null>(null);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mlStatus, setMlStatus] = useState<MlEngineStatus | null>(null);
  const [mlLoading, setMlLoading] = useState(false);
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

  const fetchMlStatus = useCallback(async () => {
    if (!window.electronAPI) {
      setMlStatus(null);
      return;
    }
    try {
      setMlStatus(await window.electronAPI.getMlStatus());
    } catch {
      setMlStatus({
        state: "error",
        endpoint: "",
        managedByElectron: false,
        pid: null,
        error: "Não foi possível consultar o ML Engine.",
      });
    }
  }, []);

  const handleMlToggle = async () => {
    if (!window.electronAPI || mlLoading) return;
    setMlLoading(true);
    try {
      const isRunning = mlStatus?.state === "online" || mlStatus?.state === "starting";
      setMlStatus(isRunning
        ? await window.electronAPI.stopMlEngine()
        : await window.electronAPI.startMlEngine());
    } finally {
      setMlLoading(false);
      await fetchMlStatus();
    }
  };

  useEffect(() => {
    fetchMcpStatus();
    const interval = setInterval(fetchMcpStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchMcpStatus]);

  useEffect(() => {
    fetchMlStatus();
    const interval = setInterval(fetchMlStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchMlStatus]);

  useEffect(() => {
    const syncMt5 = (state: MT5ConnectionStatus) => setMt5Connection(state);
    syncMt5(mt5Service.getConnectionState());
    mt5Service.on("state", syncMt5);
    return () => { mt5Service.off("state", syncMt5); };
  }, []);

  const handleMt5Toggle = async () => {
    if (mt5Connecting) return;
    setMt5Connecting(true);
    try {
      if (mt5Connection.state === "CONNECTED") {
        mt5Service.disconnect();
      } else {
        await mt5Service.connect();
      }
    } finally {
      setMt5Connecting(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const allServices: ServiceResult[] = data?.services ?? [];

  const mt5IsOnline = mt5Connection.state === "CONNECTED";
  const mcpIsOnline = mcpStatus?.state === "online";
  const mlIsOnline = mlStatus?.state === "online";
  const onlineCount = allServices.filter((s) => s.status === "online").length
    + (mt5IsOnline ? 1 : 0)
    + (mcpIsOnline ? 1 : 0)
    + (mlIsOnline ? 1 : 0);
  const totalServices = allServices.length + 3;

  const refreshAll = () => {
    fetchStatus();
    fetchMcpStatus();
    fetchMlStatus();
    if (mt5Connection.state === "CONNECTED") void mt5Service.connect();
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
        <Mt5Card connection={mt5Connection} loading={mt5Connecting} onToggle={handleMt5Toggle} />
        <McpCard status={mcpStatus} loading={mcpLoading} onToggle={handleMcpToggle} />
        <MlCard status={mlStatus} loading={mlLoading} onToggle={handleMlToggle} />
      </div>

      <div className="text-xs text-gray-500 font-space border-t border-cyber-border pt-4">
        Auto-refresh a cada 30s. Timeout HTTP: 2s. MT5 via MCP nativo do terminal (sem senha).
      </div>
    </div>
  );
}

function Mt5Card({
  connection,
  loading,
  onToggle,
}: {
  connection: MT5ConnectionStatus;
  loading: boolean;
  onToggle: () => void;
}) {
  const isOnline = connection.state === "CONNECTED";
  const isConnecting = connection.state === "CONNECTING" || loading;
  const isError = connection.state === "ERROR";
  const border = isOnline ? "border-green-500/40" : isError ? "border-red-500/40" : "border-cyber-border";
  const label = isOnline ? "ONLINE" : isConnecting ? "CONECTANDO" : isError ? "ERRO" : "OFFLINE";

  return (
    <div className={`cyber-card p-4 hud-corner border ${border}`}>
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-orbitron text-sm text-white leading-tight">MT5 (MCP Nativo)</h3>
        {isConnecting
          ? <Loader2 className="w-4 h-4 text-cyber-cyan animate-spin flex-shrink-0" />
          : isOnline
            ? <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
            : <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
      </div>
      <div className="flex items-center gap-2 mb-2">
        {isOnline ? <Wifi className="w-3 h-3 text-green-400" /> : <WifiOff className="w-3 h-3 text-red-400" />}
        <span className={`text-sm font-space font-semibold ${isOnline ? "text-green-400" : isError ? "text-red-400" : "text-gray-400"}`}>
          {label}
        </span>
      </div>
      {isOnline && connection.accountInfo && (
        <p className="text-xs text-gray-400 font-jetbrains truncate">
          Conta {connection.accountInfo.login} — {connection.accountInfo.server}
        </p>
      )}
      {connection.lastError && (
        <p className="text-xs text-red-400/70 font-space mt-1" title={connection.lastError}>
          {connection.lastError}
        </p>
      )}
      {!isOnline && !connection.lastError && (
        <p className="text-xs text-gray-600 font-space">
          Requer o terminal MT5 aberto com o servidor MCP interno ativado.
        </p>
      )}
      <button
        type="button"
        onClick={onToggle}
        disabled={isConnecting}
        className="cyber-button cyber-button-secondary mt-3 w-full flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <Power className="w-3 h-3" />
        <span className="font-space text-xs">{isOnline ? "Desconectar" : "Conectar"}</span>
      </button>
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
  const isExternal = isOnline && !status?.managedByElectron;
  const canControl = typeof window !== "undefined"
    && Boolean(window.electronAPI)
    && !isExternal;
  const border = isOnline ? "border-green-500/40" : state === "error" ? "border-red-500/40" : "border-cyber-border";
  const label = isOnline ? "ONLINE" : isStarting ? "INICIANDO" : state === "error" ? "ERRO" : "OFFLINE";

  return (
    <div className={`cyber-card p-4 hud-corner border ${border}`}>
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-orbitron text-sm text-white leading-tight">MCP Agente IA</h3>
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
      {isExternal && <p className="text-xs text-yellow-400/80 font-space mt-1">Instância externa: controle indisponível.</p>}
      {status?.error && <p className="text-xs text-red-400/70 font-space mt-1">{status.error}</p>}
      <button
        type="button"
        onClick={onToggle}
        disabled={!canControl || loading || isStarting}
        className="cyber-button cyber-button-secondary mt-3 w-full flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <Power className="w-3 h-3" />
        <span className="font-space text-xs">{isExternal ? "Externo" : isOnline ? "Desligar" : "Ligar"}</span>
      </button>
    </div>
  );
}

function MlCard({
  status,
  loading,
  onToggle,
}: {
  status: MlEngineStatus | null;
  loading: boolean;
  onToggle: () => void;
}) {
  const state = status?.state ?? "offline";
  const isOnline = state === "online";
  const isStarting = state === "starting";
  const isExternal = isOnline && !status?.managedByElectron;
  const canControl = typeof window !== "undefined"
    && Boolean(window.electronAPI)
    && !isExternal;
  const border = isOnline ? "border-green-500/40" : state === "error" ? "border-red-500/40" : "border-cyber-border";
  const label = isOnline ? "ONLINE" : isStarting ? "INICIANDO" : state === "error" ? "ERRO" : "OFFLINE";

  return (
    <div className={`cyber-card p-4 hud-corner border ${border}`}>
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-orbitron text-sm text-white leading-tight">ML Engine</h3>
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
      {isExternal && <p className="text-xs text-yellow-400/80 font-space mt-1">Instância externa: controle indisponível.</p>}
      {status?.error && <p className="text-xs text-red-400/70 font-space mt-1">{status.error}</p>}
      <button
        type="button"
        onClick={onToggle}
        disabled={!canControl || loading || isStarting}
        className="cyber-button cyber-button-secondary mt-3 w-full flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <Power className="w-3 h-3" />
        <span className="font-space text-xs">{isExternal ? "Externo" : isOnline ? "Desligar" : "Ligar"}</span>
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
