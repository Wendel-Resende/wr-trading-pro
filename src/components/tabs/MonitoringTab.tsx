"use client";

import { useState, useEffect, useRef } from "react";
import { MT5ServiceSingleton } from "@/services/mt5Service";
import { MT5Tick } from "@/types/mt5";
import StockMonitoringTable from "@/components/StockMonitoringTable";
import StockMonitoringForm from "@/components/StockMonitoringForm";
import StockDetailPanel from "@/components/StockDetailPanel";
import StockAlertsPanel from "@/components/StockAlertsPanel";
import StockReportsPanel from "@/components/StockReportsPanel";
import DividendMapCalendar from "@/components/DividendMapCalendar";
import PortfolioSummary from "@/components/PortfolioSummary";
import { useToast } from "@/contexts/ToastContext";
import { StockMonitoring, StockMonitoringInput } from "@/types/stock-monitoring";

interface MonitoringTabProps {
  mt5Connected?: boolean;
}

const mt5Service = MT5ServiceSingleton.getInstance();

export default function MonitoringTab({ mt5Connected = false }: MonitoringTabProps) {
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingStock, setEditingStock] = useState<StockMonitoring | undefined>(undefined);
  const [selectedStock, setSelectedStock] = useState<StockMonitoring | null>(null);
  const [statusFilter, setStatusFilter] = useState<"COMPRA" | "VENDA" | "NEUTRO" | "ATENCAO" | undefined>(undefined);
  const [showDividendCalendar, setShowDividendCalendar] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<"monitoramento" | "alertas" | "relatorios">("monitoramento");
  const [refreshKey, setRefreshKey] = useState(0);
  const pendingPriceUpdate = useRef<Map<string, number>>(new Map());
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscribedSymbolsRef = useRef<Set<string>>(new Set());

  // Assinar ticks dos símbolos monitorados — sem isso 'tick' nunca dispara
  // para esses ativos e sync-prices nunca roda, a menos que outra aba
  // (gráfico/ticker) por coincidência já tenha assinado o mesmo símbolo.
  useEffect(() => {
    if (!mt5Connected) return;

    let cancelled = false;

    const syncSubscriptions = async () => {
      try {
        const res = await fetch("/api/stock-monitoring");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data.success) return;

        const symbols: string[] = Array.from(
          new Set(
            (data.data as StockMonitoring[])
              .map((s) => s.asset?.symbol)
              .filter((symbol): symbol is string => Boolean(symbol))
          )
        );

        const previous = subscribedSymbolsRef.current;
        const next = new Set(symbols);

        for (const symbol of symbols) {
          if (!previous.has(symbol)) mt5Service.subscribeTicks(symbol);
        }
        for (const symbol of previous) {
          if (!next.has(symbol)) mt5Service.unsubscribeTicks(symbol);
        }
        subscribedSymbolsRef.current = next;
      } catch (err) {
        console.error("Erro ao assinar ticks dos ativos monitorados:", err);
      }
    };

    void syncSubscriptions();

    return () => {
      cancelled = true;
    };
  }, [mt5Connected, refreshKey]);

  // Ao desmontar a aba, encerrar todas as assinaturas de tick abertas por ela.
  useEffect(() => {
    return () => {
      subscribedSymbolsRef.current.forEach((symbol) => mt5Service.unsubscribeTicks(symbol));
      subscribedSymbolsRef.current.clear();
    };
  }, []);

  // Sincronizar preços via MT5 ticks com debounce de 5s
  useEffect(() => {
    const handleTick = (tick: MT5Tick) => {
      if (!tick.symbol || typeof tick.bid !== 'number') return;
      // Acumula preços recebidos
      pendingPriceUpdate.current.set(tick.symbol, tick.bid);

      // Debounce: só sincroniza com o banco após 5s de inatividade
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(async () => {
        const updates = pendingPriceUpdate.current;
        if (updates.size === 0) return;
        pendingPriceUpdate.current = new Map();

        try {
          // priceCurrent é o campo lido pelo sync-prices endpoint (position.priceCurrent)
          const positions = Array.from(updates.entries()).map(([symbol, price]) => ({
            symbol,
            priceCurrent: price,
          }));

          const res = await fetch("/api/stock-monitoring/sync-prices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ positions }),
          });

          if (!res.ok) {
            console.error("Erro ao sincronizar preços: HTTP", res.status);
            return;
          }
          const data = await res.json();
          if (data.success && data.data?.synced > 0) {
            // Forçar re-render da tabela e do resumo com novos preços
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

  const handleCreate = async (data: StockMonitoringInput) => {
    try {
      const response = await fetch("/api/stock-monitoring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (result.success) {
        setShowForm(false);
        setRefreshKey((k) => k + 1);
        toast.success("Monitoramento criado com sucesso!");
      } else {
        toast.error(result.error || "Erro ao criar monitoramento");
      }
    } catch {
      toast.error("Erro de conexão ao criar monitoramento");
    }
  };

  const handleUpdate = async (data: StockMonitoringInput) => {
    if (!editingStock) return;
    try {
      const response = await fetch(`/api/stock-monitoring/${editingStock.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (result.success) {
        setShowForm(false);
        setEditingStock(undefined);
        setRefreshKey((k) => k + 1);
        toast.success("Monitoramento atualizado com sucesso!");
      } else {
        toast.error(result.error || "Erro ao atualizar monitoramento");
      }
    } catch {
      toast.error("Erro de conexão ao atualizar monitoramento");
    }
  };

  const handleDelete = async () => {
    if (!selectedStock) return;
    try {
      const response = await fetch(`/api/stock-monitoring/${selectedStock.id}`, { method: "DELETE" });
      const result = await response.json();
      if (result.success) {
        toast.success("Monitoramento excluído com sucesso!");
        setSelectedStock(null);
        setRefreshKey((k) => k + 1);
      } else {
        toast.error(result.error || "Erro ao excluir monitoramento");
      }
    } catch {
      toast.error("Erro de conexão ao excluir monitoramento");
    }
  };

  const handleSubmit = async (data: StockMonitoringInput) => {
    if (editingStock) {
      await handleUpdate(data);
    } else {
      await handleCreate(data);
    }
  };

  return (
    <div className="cyber-card p-6 hud-corner">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-orbitron text-2xl font-bold text-white neon-text-cyan">
            Monitoramento de Ações
          </h2>
          <p className="text-sm text-gray-400 font-space mt-1">
            Acompanhe seus investimentos em ações de dividendos
          </p>
        </div>
      </div>

      {/* Tabs de Navegação */}
      <div className="mb-6">
        <div className="flex gap-1 bg-cyber-dark/50 rounded-lg p-1 border border-cyber-border flex-wrap">
          <button
            onClick={() => setActiveSubTab("monitoramento")}
            className={`flex-1 min-w-[120px] py-3 px-6 rounded-lg font-semibold font-space transition-all ${
              activeSubTab === "monitoramento"
                ? "bg-cyber-cyan/20 text-cyber-cyan border border-cyber-cyan/50"
                : "text-gray-400 hover:text-gray-200 hover:bg-cyber-dark/30"
            }`}
          >
            📊 Monitoramento
          </button>
          <button
            onClick={() => setActiveSubTab("alertas")}
            className={`flex-1 min-w-[120px] py-3 px-6 rounded-lg font-semibold font-space transition-all ${
              activeSubTab === "alertas"
                ? "bg-cyber-cyan/20 text-cyber-cyan border border-cyber-cyan/50"
                : "text-gray-400 hover:text-gray-200 hover:bg-cyber-dark/30"
            }`}
          >
            🔔 Alertas
          </button>
          <button
            onClick={() => setActiveSubTab("relatorios")}
            className={`flex-1 min-w-[120px] py-3 px-6 rounded-lg font-semibold font-space transition-all ${
              activeSubTab === "relatorios"
                ? "bg-cyber-cyan/20 text-cyber-cyan border border-cyber-cyan/50"
                : "text-gray-400 hover:text-gray-200 hover:bg-cyber-dark/30"
            }`}
          >
            📈 Relatórios
          </button>
        </div>
      </div>

      {/* Conteúdo da Tab Ativa */}
      {activeSubTab === "monitoramento" && (
        <>
          {/* Resumo da Carteira */}
          <div className="mb-6">
            <PortfolioSummary key={`summary-${refreshKey}`} mt5Connected={mt5Connected} />
          </div>

          {/* Modal de Formulário */}
          {showForm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="cyber-card max-w-4xl w-full max-h-[90vh] overflow-y-auto border border-cyber-pink/30">
                <div className="p-6">
                  <h2 className="font-orbitron text-xl font-bold text-white neon-text-pink mb-6">
                    {editingStock ? "Editar Monitoramento" : "Novo Monitoramento"}
                  </h2>
                  <StockMonitoringForm
                    stock={editingStock}
                    onSubmit={handleSubmit}
                    onCancel={() => {
                      setShowForm(false);
                      setEditingStock(undefined);
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Modal de Calendário de Dividendos */}
          {showDividendCalendar && selectedStock && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="cyber-card max-w-4xl w-full max-h-[90vh] overflow-y-auto border border-cyber-cyan/30">
                <div className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="font-orbitron text-xl font-bold text-white neon-text-cyan">
                      Calendário de Dividendos - {selectedStock.asset?.symbol ?? "—"}
                    </h2>
                    <button
                      onClick={() => setShowDividendCalendar(false)}
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <DividendMapCalendar stockId={selectedStock.id} />
                </div>
              </div>
            </div>
          )}

          {/* Modal de Detalhes da Ação */}
          {selectedStock && !showForm && !showDividendCalendar && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <StockDetailPanel
                stock={selectedStock}
                onClose={() => setSelectedStock(null)}
                onViewDividends={() => {
                  setShowDividendCalendar(true);
                }}
                onEdit={() => {
                  setEditingStock(selectedStock);
                  setShowForm(true);
                  setSelectedStock(null);
                }}
                onDelete={handleDelete}
              />
            </div>
          )}

          {/* Filtros e Ações */}
          <div className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div className="flex items-center space-x-2 flex-wrap">
                <button
                  onClick={() => setStatusFilter(undefined)}
                  className={`px-4 py-2 rounded-md text-sm font-space font-medium transition-all ${
                    statusFilter === undefined
                      ? "bg-gradient-to-r from-cyan-500 to-blue-500 text-white neon-text-cyan"
                      : "bg-cyber-dark text-gray-400 border border-cyber-border hover:border-cyber-cyan hover:text-white"
                  }`}
                >
                  Todos
                </button>
                <button
                  onClick={() => setStatusFilter("COMPRA")}
                  className={`px-4 py-2 rounded-md text-sm font-space font-medium transition-all ${
                    statusFilter === "COMPRA"
                      ? "bg-gradient-to-r from-green-500 to-emerald-500 text-white"
                      : "bg-cyber-dark text-gray-400 border border-cyber-border hover:border-green-400 hover:text-white"
                  }`}
                >
                  Compra
                </button>
                <button
                  onClick={() => setStatusFilter("VENDA")}
                  className={`px-4 py-2 rounded-md text-sm font-space font-medium transition-all ${
                    statusFilter === "VENDA"
                      ? "bg-gradient-to-r from-red-500 to-rose-500 text-white"
                      : "bg-cyber-dark text-gray-400 border border-cyber-border hover:border-red-400 hover:text-white"
                  }`}
                >
                  Venda
                </button>
                <button
                  onClick={() => setStatusFilter("NEUTRO")}
                  className={`px-4 py-2 rounded-md text-sm font-space font-medium transition-all ${
                    statusFilter === "NEUTRO"
                      ? "bg-gradient-to-r from-gray-500 to-slate-500 text-white"
                      : "bg-cyber-dark text-gray-400 border border-cyber-border hover:border-gray-400 hover:text-white"
                  }`}
                >
                  Neutro
                </button>
                <button
                  onClick={() => setStatusFilter("ATENCAO")}
                  className={`px-4 py-2 rounded-md text-sm font-space font-medium transition-all ${
                    statusFilter === "ATENCAO"
                      ? "bg-gradient-to-r from-yellow-500 to-amber-500 text-white"
                      : "bg-cyber-dark text-gray-400 border border-cyber-border hover:border-yellow-400 hover:text-white"
                  }`}
                >
                  Atenção
                </button>
              </div>

              <button
                onClick={() => {
                  setEditingStock(undefined);
                  setShowForm(true);
                }}
                className="cyber-button cyber-button-primary"
              >
                Novo Monitoramento
              </button>
            </div>
          </div>

          {/* Tabela de Monitoramento */}
          <div className="cyber-card bg-cyber-dark/50 border border-cyber-border">
            <StockMonitoringTable
              key={refreshKey}
              statusFilter={statusFilter}
              onViewDetails={(stock) => setSelectedStock(stock)}
              mt5Connected={mt5Connected}
            />
          </div>

          {/* Informações de Uso */}
          <div className="mt-6 bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-pink-500/10 border border-cyan-500/30 rounded-xl p-6">
            <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan mb-4">
              Informações de Uso
            </h3>
            <ul className="space-y-3 text-sm text-gray-300 font-space">
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-1">●</span>
                <span><strong className="text-green-400">Status COMPRA:</strong> Ação está abaixo do preço teto, boa oportunidade de compra</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400 mt-1">●</span>
                <span><strong className="text-red-400">Status VENDA:</strong> Ação está acima do preço teto reajustado, considerar venda</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gray-400 mt-1">●</span>
                <span><strong className="text-gray-400">Status NEUTRO:</strong> Ação está em faixa de preço adequada</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-yellow-400 mt-1">●</span>
                <span><strong className="text-yellow-400">Status ATENÇÃO:</strong> Ação requer atenção, verificar indicadores</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400 mt-1">●</span>
                <span><strong className="text-purple-400">Yield on Cost:</strong> Dividendos anuais projetados dividido pelo custo de aquisição</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-1">●</span>
                <span><strong className="text-cyan-400">Preço Teto:</strong> Preço máximo de compra baseado em análise fundamentalista</span>
              </li>
            </ul>
          </div>
        </>
      )}

      {activeSubTab === "alertas" && (
        <div className="cyber-card bg-cyber-dark/30 border border-cyber-border rounded-lg p-6">
          <StockAlertsPanel />
        </div>
      )}

      {activeSubTab === "relatorios" && (
        <div className="cyber-card bg-cyber-dark/30 border border-cyber-border rounded-lg p-6">
          <StockReportsPanel />
        </div>
      )}
    </div>
  );
}
