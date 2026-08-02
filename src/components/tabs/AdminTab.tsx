"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, CheckCircle, XCircle, Loader2, Wifi, WifiOff, Bot, Power, Plug, Save, Trash2 } from "lucide-react";
import { MT5ServiceSingleton } from "@/services/mt5Service";
import type { MT5ConnectionStatus } from "@/types/mt5";

interface Mt5ConnectionProfile {
  id: string;
  name: string;
  endpoint: string;
  isActive: boolean;
  updatedAt: string;
}

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

  const [mt5Profiles, setMt5Profiles] = useState<Mt5ConnectionProfile[]>([]);
  const [isLoadingMt5Profiles, setIsLoadingMt5Profiles] = useState(true);
  const [mt5ProfileForm, setMt5ProfileForm] = useState({ name: "", endpoint: "http://127.0.0.1:22346/mcp", apiKey: "" });
  const [mt5ProfileMessage, setMt5ProfileMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [mt5ProfileBusy, setMt5ProfileBusy] = useState(false);

  const loadMt5Profiles = useCallback(async () => {
    setIsLoadingMt5Profiles(true);
    try {
      const res = await fetch("/api/mt5/connections");
      const data = await res.json().catch(() => null);
      if (data?.success) setMt5Profiles(data.data.profiles ?? []);
    } catch {
      // status indisponível — lista fica vazia
    } finally {
      setIsLoadingMt5Profiles(false);
    }
  }, []);

  useEffect(() => {
    loadMt5Profiles();
  }, [loadMt5Profiles]);

  const addMt5Profile = async () => {
    if (!mt5ProfileForm.name.trim() || !mt5ProfileForm.endpoint.trim() || !mt5ProfileForm.apiKey.trim()) {
      setMt5ProfileMessage({ text: "Preencha nome, endpoint e API key.", isError: true });
      return;
    }
    setMt5ProfileBusy(true);
    setMt5ProfileMessage(null);
    try {
      const res = await fetch("/api/mt5/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: mt5ProfileForm.name.trim(),
          endpoint: mt5ProfileForm.endpoint.trim(),
          apiKey: mt5ProfileForm.apiKey.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setMt5ProfileMessage({ text: data?.error || `Falha ao cadastrar (HTTP ${res.status}).`, isError: true });
        return;
      }
      setMt5ProfileForm({ name: "", endpoint: "http://127.0.0.1:22346/mcp", apiKey: "" });
      setMt5ProfileMessage({ text: "Conta cadastrada.", isError: false });
      await loadMt5Profiles();
    } catch (err) {
      setMt5ProfileMessage({ text: err instanceof Error ? err.message : "Erro ao cadastrar.", isError: true });
    } finally {
      setMt5ProfileBusy(false);
    }
  };

  const activateMt5Profile = async (id: string) => {
    setMt5ProfileBusy(true);
    setMt5ProfileMessage(null);
    try {
      const res = await fetch(`/api/mt5/connections/${id}/activate`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setMt5ProfileMessage({ text: data?.error || "Falha ao ativar conta.", isError: true });
        return;
      }
      mt5Service.disconnect();
      setMt5ProfileMessage({ text: "Conta ativada — clique em Conectar no card MT5 acima.", isError: false });
      await loadMt5Profiles();
    } finally {
      setMt5ProfileBusy(false);
    }
  };

  const deleteMt5Profile = async (id: string) => {
    setMt5ProfileBusy(true);
    setMt5ProfileMessage(null);
    try {
      const res = await fetch(`/api/mt5/connections/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setMt5ProfileMessage({ text: data?.error || "Falha ao remover conta.", isError: true });
        return;
      }
      await loadMt5Profiles();
    } finally {
      setMt5ProfileBusy(false);
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

      <div className="border-t border-cyber-border pt-6 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Plug className="w-5 h-5 text-cyber-cyan" />
          <h3 className="font-orbitron text-lg font-bold text-white">Contas MT5 (MCP nativo)</h3>
        </div>
        <p className="text-xs text-gray-500 font-space mb-4">
          Cadastre uma conta por corretora/mercado (ex.: &quot;B3 - XP Demo&quot;, &quot;Forex&quot;). Endpoint/API key
          são gerados no terminal MT5 em <code>Tools &gt; Options &gt; MCP &gt; Generate</code>. Só um terminal
          fica aberto por vez, então o endpoint costuma repetir — o que muda é a API key. Ative a conta desejada
          aqui e depois clique em Conectar no card MT5 acima.
        </p>

        <div className="space-y-2 mb-4">
          {isLoadingMt5Profiles ? (
            <p className="text-sm text-gray-500 font-space">Carregando contas...</p>
          ) : mt5Profiles.length === 0 ? (
            <p className="text-sm text-gray-500 font-space">Nenhuma conta cadastrada ainda.</p>
          ) : (
            mt5Profiles.map((profile) => (
              <div
                key={profile.id}
                className={`flex items-center justify-between bg-cyber-dark/50 border rounded-lg p-3 ${
                  profile.isActive ? "border-green-500/40" : "border-cyber-border"
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-orbitron text-sm font-bold text-white">{profile.name}</span>
                    {profile.isActive && (
                      <span className="text-xs font-space px-2 py-0.5 rounded bg-green-500/20 text-green-400">ATIVA</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 font-space mt-1">{profile.endpoint}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => activateMt5Profile(profile.id)}
                    disabled={mt5ProfileBusy || profile.isActive}
                    className="cyber-button px-3 py-1.5 text-xs flex items-center gap-1.5 border border-cyber-cyan/40 text-cyber-cyan hover:bg-cyber-cyan/10 disabled:opacity-50"
                  >
                    <Power className="w-3.5 h-3.5" /> {profile.isActive ? "Ativa" : "Ativar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteMt5Profile(profile.id)}
                    disabled={mt5ProfileBusy}
                    className="cyber-button px-3 py-1.5 text-xs flex items-center gap-1.5 border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remover
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Nome</label>
            <input
              type="text"
              value={mt5ProfileForm.name}
              onChange={(e) => setMt5ProfileForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Ex: B3 - XP Demo"
              disabled={mt5ProfileBusy}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Endpoint</label>
            <input
              type="text"
              value={mt5ProfileForm.endpoint}
              onChange={(e) => setMt5ProfileForm((prev) => ({ ...prev, endpoint: e.target.value }))}
              placeholder="http://127.0.0.1:22346/mcp"
              disabled={mt5ProfileBusy}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">API key</label>
            <input
              type="password"
              autoComplete="off"
              value={mt5ProfileForm.apiKey}
              onChange={(e) => setMt5ProfileForm((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder="••••••••••••"
              disabled={mt5ProfileBusy}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm disabled:opacity-50"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={addMt5Profile}
            disabled={mt5ProfileBusy}
            className="cyber-button cyber-button-primary px-4 py-1.5 text-sm flex items-center gap-1.5 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" /> Cadastrar conta
          </button>
          {mt5ProfileMessage && (
            <span className={`text-xs font-space ${mt5ProfileMessage.isError ? "text-red-400" : "text-green-400"}`}>
              {mt5ProfileMessage.text}
            </span>
          )}
        </div>
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
