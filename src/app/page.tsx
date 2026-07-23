"use client";

import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard, FileText, BarChart3, Brain,
  ArrowDownLeft, TrendingUp, Database, Wifi, WifiOff, Zap, LogOut, Bot, Landmark
} from "lucide-react";
import MT5ConnectionForm from "@/components/MT5ConnectionForm";
import Modal from "@/components/Modal";
import PriceTicker from "@/components/PriceTicker";
import { MT5ServiceSingleton } from "@/services/mt5Service";
import { MT5AccountInfo, MT5Tick } from "@/types/mt5";

const DashboardTab = lazy(() => import("@/components/tabs/DashboardTab"));
const OrdersTab = lazy(() => import("@/components/tabs/OrdersTab"));
const PortfolioTab = lazy(() => import("@/components/tabs/PortfolioTab"));
const SpreadTab = lazy(() => import("@/components/tabs/SpreadTab"));
const MonitoringTab = lazy(() => import("@/components/tabs/MonitoringTab"));
const MLPredictionsTab = lazy(() => import("@/components/tabs/MLPredictionsTab"));
const OptionsTab = lazy(() => import("@/components/tabs/OptionsTab"));
const AdminTab = lazy(() => import("@/components/tabs/AdminTab"));
const AgentTab = lazy(() => import("@/components/tabs/AgentTab"));
const CvmFundamentalsTab = lazy(() => import("@/components/tabs/CvmFundamentalsTab"));

type TabId = "dashboard" | "orders" | "portfolio" | "spread" | "monitoramento" | "ml" | "opcoes" | "fundamentos" | "admin" | "agentes";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "orders", label: "Ordens", icon: FileText },
  { id: "portfolio", label: "Portfólio", icon: BarChart3 },
  { id: "ml", label: "Previsões ML", icon: Brain },
  { id: "spread", label: "Spread B3", icon: ArrowDownLeft },
  { id: "opcoes", label: "Opções", icon: TrendingUp },
  { id: "fundamentos", label: "Fundamentos CVM", icon: Landmark },
  { id: "monitoramento", label: "Monitoramento", icon: TrendingUp },
  { id: "agentes", label: "Agentes", icon: Bot },
  { id: "admin", label: "Admin", icon: Database },
];

const mt5Service = MT5ServiceSingleton.getInstance();

export default function Dashboard() {
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [mountedTabs, setMountedTabs] = useState<Set<TabId>>(new Set<TabId>(["dashboard"]));
  const [mt5Connected, setMt5Connected] = useState(false);
  const [accountInfo, setAccountInfo] = useState<MT5AccountInfo | null>(null);
  const [tickData, setTickData] = useState<Map<string, MT5Tick>>(new Map());
  const [showMT5Modal, setShowMT5Modal] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  const pendingTicksRef = useRef<Map<string, MT5Tick>>(new Map());
  const tickDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleTick = (tick: MT5Tick) => {
      if (!tick.symbol || !tick.bid) return;

      pendingTicksRef.current.set(tick.symbol, tick);

      if (tickDebounceRef.current) {
        clearTimeout(tickDebounceRef.current);
      }

      tickDebounceRef.current = setTimeout(() => {
        const pending = pendingTicksRef.current;
        if (pending.size === 0) return;
        setTickData((prev) => {
          const next = new Map(prev);
          pending.forEach((t, sym) => next.set(sym, t));
          return next;
        });
        pendingTicksRef.current = new Map();
        tickDebounceRef.current = null;
      }, 200);
    };
    const handleAccount = (account: MT5AccountInfo) => setAccountInfo(account);
    const handleState = (state: { state: string; accountInfo?: MT5AccountInfo }) => {
      setMt5Connected(state.state === "CONNECTED");
      if (state.state === "CONNECTED" && state.accountInfo) setAccountInfo(state.accountInfo);
    };

    mt5Service.on("tick", handleTick);
    mt5Service.on("account", handleAccount);
    mt5Service.on("state", handleState);

    const state = mt5Service.getConnectionState();
    if (state.state === "CONNECTED") {
      setMt5Connected(true);
      if (state.accountInfo) setAccountInfo(state.accountInfo);
    }

    return () => {
      mt5Service.off("tick", handleTick);
      mt5Service.off("account", handleAccount);
      mt5Service.off("state", handleState);
      if (tickDebounceRef.current) {
        clearTimeout(tickDebounceRef.current);
      }
    };
  }, []);

  const handleTabChange = (tabId: TabId) => {
    setActiveTab(tabId);
    setMountedTabs((prev) => new Set(prev).add(tabId));
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-cyber-darker">
      {/* Header */}
      <header className="border-b border-cyber-border bg-cyber-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-gradient-to-br from-cyber-pink to-cyber-purple flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-orbitron text-xl font-bold text-white neon-text-cyan">WR TRADING PRO</h1>
              <p className="text-xs text-cyber-cyan/70 font-space">Plataforma de Trading Avançada</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyber-dark/50 border border-cyber-border">
              {mt5Connected ? (
                <>
                  <Wifi className="w-4 h-4 text-green-400" />
                  <span className="text-sm text-green-400 font-space">Conectado</span>
                  <button
                    onClick={() => { mt5Service.disconnect(); setMt5Connected(false); }}
                    className="text-xs text-gray-400 hover:text-white transition-colors font-space ml-1"
                  >
                    Desconectar
                  </button>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-red-400" />
                  <span className="text-sm text-red-400 font-space">Desconectado</span>
                  <button
                    onClick={() => setShowMT5Modal(true)}
                    className="text-xs text-cyber-pink hover:text-white transition-colors font-space ml-1"
                  >
                    Conectar
                  </button>
                </>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400 font-space">Hora do Mercado</p>
              <p className="text-sm font-jetbrains text-cyber-cyan">
                {currentTime.toLocaleTimeString("pt-BR")}
              </p>
            </div>
            <button
              onClick={async () => {
                try {
                  const response = await fetch("/api/auth/logout", { method: "POST" });
                  if (!response.ok) throw new Error(`logout HTTP ${response.status}`);
                  localStorage.removeItem("wr_trading_auth"); // limpa resquício do login antigo
                  router.replace("/login");
                  router.refresh();
                } catch (error) {
                  console.warn("Não foi possível encerrar a sessão:", error);
                }
              }}
              className="cyber-button cyber-button-secondary flex items-center gap-2"
              title="Sair"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Tab navigation */}
      <div className="border-b border-cyber-border bg-cyber-card/30">
        <div className="px-4 flex gap-1 flex-wrap">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              className={`flex items-center gap-2 px-4 py-3 font-space text-sm transition-colors ${
                activeTab === id
                  ? "text-cyber-cyan border-b-2 border-cyber-cyan"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <PriceTicker symbols={[]} />

      {/* MT5 Connection Modal */}
      <Modal isOpen={showMT5Modal} onClose={() => setShowMT5Modal(false)} title="Conectar ao MetaTrader 5">
        <MT5ConnectionForm
          onClose={() => setShowMT5Modal(false)}
          onConnected={() => { setMt5Connected(true); setShowMT5Modal(false); }}
        />
      </Modal>

      {/* Tab content — kept-alive via display:none */}
      <main className="px-4 py-6">
        {mountedTabs.has("dashboard") && (
          <div style={{ display: activeTab === "dashboard" ? "block" : "none" }}>
            <Suspense fallback={<TabLoader />}>
              <DashboardTab accountInfo={accountInfo} tickData={tickData} />
            </Suspense>
          </div>
        )}
        {mountedTabs.has("orders") && (
          <div style={{ display: activeTab === "orders" ? "block" : "none" }}>
            <Suspense fallback={<TabLoader />}><OrdersTab /></Suspense>
          </div>
        )}
        {mountedTabs.has("portfolio") && (
          <div style={{ display: activeTab === "portfolio" ? "block" : "none" }}>
            <Suspense fallback={<TabLoader />}><PortfolioTab /></Suspense>
          </div>
        )}
        {mountedTabs.has("spread") && (
          <div style={{ display: activeTab === "spread" ? "block" : "none" }}>
            <Suspense fallback={<TabLoader />}><SpreadTab /></Suspense>
          </div>
        )}
        {mountedTabs.has("monitoramento") && (
          <div style={{ display: activeTab === "monitoramento" ? "block" : "none" }}>
            <Suspense fallback={<TabLoader />}><MonitoringTab mt5Connected={mt5Connected} /></Suspense>
          </div>
        )}
        {mountedTabs.has("ml") && (
          <div style={{ display: activeTab === "ml" ? "block" : "none" }}>
            <Suspense fallback={<TabLoader />}><MLPredictionsTab /></Suspense>
          </div>
        )}
        {mountedTabs.has("opcoes") && (
          <div style={{ display: activeTab === "opcoes" ? "block" : "none" }}>
            <Suspense fallback={<TabLoader />}><OptionsTab /></Suspense>
          </div>
        )}
        {mountedTabs.has("fundamentos") && (
          <div style={{ display: activeTab === "fundamentos" ? "block" : "none" }}>
            <Suspense fallback={<TabLoader />}><CvmFundamentalsTab /></Suspense>
          </div>
        )}
        {mountedTabs.has("admin") && (
          <div style={{ display: activeTab === "admin" ? "block" : "none" }}>
            <Suspense fallback={<TabLoader />}><AdminTab /></Suspense>
          </div>
        )}
        {mountedTabs.has("agentes") && (
          <div style={{ display: activeTab === "agentes" ? "block" : "none" }}>
            <Suspense fallback={<TabLoader />}><AgentTab /></Suspense>
          </div>
        )}
      </main>
    </div>
  );
}

function TabLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-cyber-cyan border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
