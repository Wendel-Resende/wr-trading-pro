"use client";

import { useState, useEffect } from "react";
import { TrendingUp, AlertCircle, History } from "lucide-react";
import SpreadOrderForm from "@/components/SpreadOrderForm";
import SpreadSummary from "@/components/SpreadSummary";
import SpreadPendingOrders from "@/components/SpreadPendingOrders";
import SpreadOrderHistory from "@/components/SpreadOrderHistory";
import SpreadNotification from "@/components/SpreadNotification";
import SpreadAnalysis from "@/components/SpreadAnalysis";
import SpreadPairsFinder from "@/components/SpreadPairsFinder";
import VolatilityPanel from "@/components/VolatilityPanel";
import { SpreadResult } from "@/types/spread";

export default function SpreadTab() {
  const [spreadActiveTab, setSpreadActiveTab] = useState<"analysis" | "finder">("analysis");
  const [spreadSymbol1, setSpreadSymbol1] = useState("");
  const [spreadSymbol2, setSpreadSymbol2] = useState("");
  const [spreadStartDate, setSpreadStartDate] = useState("");
  const [spreadEndDate, setSpreadEndDate] = useState("");
  const [spreadGanhoMinimo, setSpreadGanhoMinimo] = useState(0.10);

  useEffect(() => {
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    setSpreadEndDate(today.toISOString().split("T")[0]);
    setSpreadStartDate(thirtyDaysAgo.toISOString().split("T")[0]);
  }, []);

  return (
    <div className="space-y-6">
      {/* Notificação - gerenciada automaticamente pelo componente */}
      <SpreadNotification />

      {/* Layout Principal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Coluna Esquerda - Boleta */}
        <div className="lg:col-span-1 space-y-4">
          <SpreadOrderForm />

          {/* Painel de Volatilidade */}
          <VolatilityPanel />
        </div>

        {/* Coluna Central - Dashboard */}
        <div className="lg:col-span-2 space-y-4">
          {/* Resumo */}
          <div className="cyber-card p-4 hud-corner">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-5 h-5 text-cyan-400" />
              <h2 className="text-lg font-bold font-orbitron text-white neon-text-cyan">
                Resumo do Dia
              </h2>
            </div>
            <SpreadSummary />
          </div>

          {/* Ordens Pendentes */}
          <div className="cyber-card p-4 hud-corner">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-5 h-5 text-yellow-400" />
              <h2 className="text-lg font-bold font-orbitron text-white neon-text-yellow">
                Ordens Pendentes
              </h2>
            </div>
            <SpreadPendingOrders />
          </div>

          {/* Histórico de Execuções */}
          <div className="cyber-card p-4 hud-corner">
            <div className="flex items-center gap-2 mb-3">
              <History className="w-5 h-5 text-green-400" />
              <h2 className="text-lg font-bold font-orbitron text-white neon-text-green">
                Histórico de Execuções
              </h2>
            </div>
            <SpreadOrderHistory />
          </div>
        </div>
      </div>

      {/* Informações Adicionais */}
      <div className="cyber-card p-4 hud-corner">
        <h3 className="text-sm font-bold font-orbitron text-white neon-text-cyan mb-2">
          Como Funciona
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-space text-gray-400">
          <div className="bg-cyber-dark/30 rounded-lg p-3">
            <p className="font-bold text-cyan-400 mb-1">1. Configure</p>
            <p>Selecione os ativos, quantidades e tipo de operação para cada lado do spread.</p>
          </div>
          <div className="bg-cyber-dark/30 rounded-lg p-3">
            <p className="font-bold text-pink-400 mb-1">2. Ative</p>
            <p>Execute imediatamente ou configure automação para disparar quando o spread atingir o alvo.</p>
          </div>
          <div className="bg-cyber-dark/30 rounded-lg p-3">
            <p className="font-bold text-purple-400 mb-1">3. Monitore</p>
            <p>Acompanhe ordens pendentes, execuções e lucro em tempo real.</p>
          </div>
        </div>
      </div>

      {/* Configuração e Análise de Spread */}
      <div className="cyber-card p-6 hud-corner">
        <h2 className="font-orbitron text-xl font-bold text-white neon-text-cyan mb-4">
          Análise de Spread
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Símbolo 1 */}
          <div>
            <label className="block text-sm font-space text-gray-400 mb-2">
              Símbolo 1 (Ex: PETR4)
            </label>
            <input
              type="text"
              value={spreadSymbol1}
              onChange={(e) => setSpreadSymbol1(e.target.value.toUpperCase())}
              placeholder="Ex: PETR4"
              className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-pink focus:outline-none transition-colors"
            />
          </div>

          {/* Símbolo 2 */}
          <div>
            <label className="block text-sm font-space text-gray-400 mb-2">
              Símbolo 2 (Ex: PETR3)
            </label>
            <input
              type="text"
              value={spreadSymbol2}
              onChange={(e) => setSpreadSymbol2(e.target.value.toUpperCase())}
              placeholder="Ex: PETR3"
              className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-pink focus:outline-none transition-colors"
            />
          </div>

          {/* Data Inicial */}
          <div>
            <label className="block text-sm font-space text-gray-400 mb-2">
              Data Inicial
            </label>
            <input
              type="date"
              value={spreadStartDate}
              onChange={(e) => setSpreadStartDate(e.target.value)}
              className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-pink focus:outline-none transition-colors"
            />
          </div>

          {/* Data Final */}
          <div>
            <label className="block text-sm font-space text-gray-400 mb-2">
              Data Final
            </label>
            <input
              type="date"
              value={spreadEndDate}
              onChange={(e) => setSpreadEndDate(e.target.value)}
              className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-pink focus:outline-none transition-colors"
            />
          </div>
        </div>

        {/* Ganhos Mínimos */}
        <div className="mb-6">
          <label className="block text-sm font-space text-gray-400 mb-2">
            Ganhos Mínimos Sugeridos
          </label>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 0.05, label: "R$ 0,05" },
              { value: 0.10, label: "R$ 0,10" },
              { value: 0.25, label: "R$ 0,25" },
              { value: 0.50, label: "R$ 0,50" },
              { value: 1.00, label: "R$ 1,00" },
              { value: 2.00, label: "R$ 2,00" },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setSpreadGanhoMinimo(option.value)}
                className={`px-4 py-2 rounded-lg font-space text-sm transition-all ${
                  spreadGanhoMinimo === option.value
                    ? "bg-gradient-to-r from-cyber-pink to-cyber-purple text-white neon-text-pink"
                    : "bg-cyber-dark border border-cyber-border text-gray-400 hover:border-cyber-pink hover:text-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Ganho Mínimo Personalizado */}
        <div className="mb-6">
          <label className="block text-sm font-space text-gray-400 mb-2">
            Ganhos Mínimo Personalizado
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              step="0.01"
              min="0"
              value={spreadGanhoMinimo}
              onChange={(e) => setSpreadGanhoMinimo(parseFloat(e.target.value) || 0)}
              placeholder="0.10"
              className="flex-1 bg-cyber-dark border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-pink focus:outline-none transition-colors"
            />
            <div className="bg-cyber-dark border border-cyber-border rounded-lg px-4 py-2 text-gray-400 font-space">
              R$
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setSpreadActiveTab("analysis")}
            className={`flex-1 py-3 px-6 rounded-lg font-orbitron font-bold transition-all ${
              spreadActiveTab === "analysis"
                ? "bg-gradient-to-r from-cyber-pink to-cyber-purple text-white neon-text-pink"
                : "bg-cyber-dark border border-cyber-border text-gray-400 hover:border-cyber-pink hover:text-white"
            }`}
          >
            Análise de Par Específico
          </button>
          <button
            onClick={() => setSpreadActiveTab("finder")}
            className={`flex-1 py-3 px-6 rounded-lg font-orbitron font-bold transition-all ${
              spreadActiveTab === "finder"
                ? "bg-gradient-to-r from-cyber-pink to-cyber-purple text-white neon-text-pink"
                : "bg-cyber-dark border border-cyber-border text-gray-400 hover:border-cyber-pink hover:text-white"
            }`}
          >
            Buscar Melhores Pares
          </button>
        </div>
      </div>

      {/* Resultados da Análise */}
      <div className="cyber-card p-6 hud-corner min-h-[600px]">
        {spreadActiveTab === "analysis" ? (
          <SpreadAnalysis
            symbol1={spreadSymbol1}
            symbol2={spreadSymbol2}
            startDate={spreadStartDate ? new Date(spreadStartDate + "T00:00:00") : new Date()}
            endDate={spreadEndDate ? new Date(spreadEndDate + "T00:00:00") : new Date()}
            ganhoMinimo={spreadGanhoMinimo}
            onAnalyze={(_result: SpreadResult | null) => {
            }}
          />
        ) : (
          <SpreadPairsFinder
            startDate={spreadStartDate ? new Date(spreadStartDate + "T00:00:00") : new Date()}
            endDate={spreadEndDate ? new Date(spreadEndDate + "T00:00:00") : new Date()}
            ganhoMinimo={spreadGanhoMinimo}
          />
        )}
      </div>
    </div>
  );
}
