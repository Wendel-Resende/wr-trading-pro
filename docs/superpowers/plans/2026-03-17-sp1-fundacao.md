# Sub-projeto 1 — Fundação: Implementação

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organizar scripts Python em pastas limpas, quebrar `page.tsx` de 1238 linhas em 8 componentes de aba com kept-alive + lazy loading, e implementar sistema de toast global substituindo todos os `alert()`.

**Architecture:** A raiz do projeto é limpa — scripts Python ativos vão para `python/`, utilitários para `scripts/`, legado para `archive/`. O `page.tsx` vira um shell de ~150 linhas que renderiza 8 componentes de aba usando CSS `display:none` para kept-alive e `React.lazy` para lazy loading. Um `ToastProvider` no `layout.tsx` disponibiliza notificações em toda a aplicação.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, `React.lazy`, `React.createContext`

---

## Pré-requisito

> **Atenção:** O projeto não tem git inicializado. Execute a Task 0 antes de qualquer outra coisa — ela cria o repositório e um commit inicial seguro para rollback.

---

## Mapa de Arquivos

### Criados
- `python/mt5_bridge.py` ← movido da raiz
- `python/spread_api.py` ← movido da raiz
- `python/volatility_api.py` ← movido da raiz
- `python/profitdll_bridge.py` ← movido da raiz
- `python/requirements.txt` ← renomeado de `spread_requirements.txt`
- `scripts/utils/*.py` ← análises one-off movidas da raiz
- `scripts/tests/*.py` ← testes manuais movidos da raiz
- `archive/projeto_spread_legacy/` ← conteúdo de `Projeto_spread/`
- `docs/` ← arquivos `.md` da raiz movidos aqui
- `src/components/tabs/DashboardTab.tsx` ← extraído de `page.tsx`
- `src/components/tabs/OrdersTab.tsx` ← extraído de `page.tsx`
- `src/components/tabs/PortfolioTab.tsx` ← extraído de `page.tsx`
- `src/components/tabs/SpreadTab.tsx` ← extraído de `page.tsx`
- `src/components/tabs/MonitoringTab.tsx` ← extraído de `page.tsx`
- `src/components/tabs/MLPredictionsTab.tsx` ← extraído de `page.tsx`
- `src/components/tabs/MLModelsTab.tsx` ← extraído de `page.tsx`
- `src/components/tabs/AdminTab.tsx` ← extraído de `page.tsx`
- `src/components/ui/Toast.tsx` ← novo componente de toast
- `src/contexts/ToastContext.tsx` ← novo context de toast

### Modificados
- `src/app/page.tsx` ← reduzido de 1238 para ~150 linhas (shell)
- `src/app/layout.tsx` ← adicionar `ToastProvider`

### Removidos
- `src/components/SpreadNotification.tsx` ← substituído pelo Toast global

---

## Task 0: Inicializar Git

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Inicializar repositório git**

```bash
cd "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_"
git init
```

- [ ] **Step 2: Criar .gitignore adequado**

Verificar se já existe um `.gitignore`. Se não existir ou estiver incompleto, garantir que contenha:

```
node_modules/
.next/
prisma/dev.db
prisma/dev.db-journal
*.pyc
__pycache__/
.env
.env.local
archive/
scripts/
.superpowers/
```

- [ ] **Step 3: Commit inicial (ponto de rollback seguro)**

```bash
git add -A
git commit -m "chore: commit inicial antes da refatoração — snapshot do estado atual"
```

---

## Task 1: Reorganizar scripts Python e arquivos da raiz

**Files:**
- Move: `mt5_bridge.py` → `python/mt5_bridge.py`
- Move: `spread_api.py` → `python/spread_api.py`
- Move: `volatility_api.py` → `python/volatility_api.py`
- Move: `profitdll_bridge.py` → `python/profitdll_bridge.py`
- Move: `spread_requirements.txt` → `python/requirements.txt`
- Move: `analyze_*.py`, `analisa_*.py`, `import_*.py`, `detailed_analysis.py` → `scripts/utils/`
- Move: `run_api_test.py`, `test_*.py` → `scripts/tests/`
- Move: `Projeto_spread/` → `archive/projeto_spread_legacy/`
- Move: `*.md` (raiz, exceto README) → `docs/`

- [ ] **Step 1: Criar pastas de destino**

```bash
mkdir -p "python" "scripts/utils" "scripts/tests" "archive/projeto_spread_legacy" "docs/legacy"
```

- [ ] **Step 2: Mover scripts Python ativos**

```bash
mv mt5_bridge.py python/
mv spread_api.py python/
mv volatility_api.py python/
mv profitdll_bridge.py python/
mv spread_requirements.txt python/requirements.txt
```

- [ ] **Step 3: Mover scripts de análise one-off**

```bash
mv analyze_orders.py scripts/utils/
mv analyze_monitoramento.py scripts/utils/
mv detailed_analysis.py scripts/utils/
mv import_spreadsheet_data.py scripts/utils/
mv analyze_planilha.py scripts/utils/
mv analisa_planilha_calculos.py scripts/utils/
mv analisa_monitoramento_completo.py scripts/utils/
```

- [ ] **Step 4: Mover scripts de teste manual**

```bash
mv run_api_test.py scripts/tests/
mv test_spread_api.py scripts/tests/
mv test_current_prices.py scripts/tests/
mv test_asset_creation.py scripts/tests/
```

- [ ] **Step 5: Mover protótipo legado**

```bash
mv Projeto_spread/* archive/projeto_spread_legacy/
rmdir Projeto_spread
```

- [ ] **Step 6: Mover arquivos .md da raiz para docs/legacy**

```bash
# Mover todos os .md da raiz exceto README (se existir)
find . -maxdepth 1 -name "*.md" ! -name "README.md" -exec mv {} docs/legacy/ \;
```

- [ ] **Step 7: Verificar raiz limpa**

```bash
ls -la *.py 2>/dev/null || echo "Nenhum .py na raiz"
ls python/
ls scripts/utils/
ls scripts/tests/
ls archive/projeto_spread_legacy/ | head -5
```

Esperado: nenhum `.py` solto na raiz, pastas criadas com arquivos corretos.

- [ ] **Step 8: Criar README.md na pasta python/ documentando os serviços**

Criar `python/README.md`:

```markdown
# Python Services

Scripts Python que servem o Next.js WR Trading Pro.

## Serviços ativos

| Script | Porta | Função |
|--------|-------|--------|
| `mt5_bridge.py` | 8766 (WebSocket) | Bridge MT5 → Next.js |
| `spread_api.py` | 5000 (HTTP) | API de análise de spread |
| `volatility_api.py` | 5555 (HTTP) | API de volatilidade |
| `profitdll_bridge.py` | - | Bridge Profit DLL (futuro) |

## Como iniciar

```bash
# Instalar dependências
pip install -r requirements.txt

# Iniciar bridge MT5 (obrigatório para dados em tempo real)
python mt5_bridge.py

# Iniciar API de spread (necessário para análise de pares)
python spread_api.py

# Iniciar API de volatilidade
python volatility_api.py
```
```

- [ ] **Step 9: Commit**

```bash
git add python/ scripts/ archive/ docs/legacy/
git commit -m "chore: organizar scripts Python em pastas — python/, scripts/, archive/"
```

---

## Task 2: Criar sistema de Toast global

**Files:**
- Create: `src/contexts/ToastContext.tsx`
- Create: `src/components/ui/Toast.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Criar o contexto e hook do Toast**

Criar `src/contexts/ToastContext.tsx`:

```typescript
"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toasts: Toast[];
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    warning: (message: string) => void;
    info: (message: string) => void;
  };
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const add = useCallback((type: ToastType, message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = {
    success: (message: string) => add("success", message),
    error: (message: string) => add("error", message),
    warning: (message: string) => add("warning", message),
    info: (message: string) => add("info", message),
  };

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx.toast;
}

export function useToasts() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts must be used inside ToastProvider");
  return { toasts: ctx.toasts, dismiss: ctx.dismiss };
}
```

- [ ] **Step 2: Criar o componente visual Toast**

Criar `src/components/ui/Toast.tsx`:

```typescript
"use client";

import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { useToasts, ToastType } from "@/contexts/ToastContext";

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="w-5 h-5 text-green-400" />,
  error: <AlertCircle className="w-5 h-5 text-red-400" />,
  warning: <AlertTriangle className="w-5 h-5 text-yellow-400" />,
  info: <Info className="w-5 h-5 text-cyan-400" />,
};

const colors: Record<ToastType, string> = {
  success: "border-green-500/50 bg-green-500/10",
  error: "border-red-500/50 bg-red-500/10",
  warning: "border-yellow-500/50 bg-yellow-500/10",
  info: "border-cyan-500/50 bg-cyan-500/10",
};

export function ToastContainer() {
  const { toasts, dismiss } = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-3 p-4 rounded-lg border cyber-card ${colors[t.type]} animate-in slide-in-from-right`}
        >
          <div className="flex-shrink-0 mt-0.5">{icons[t.type]}</div>
          <p className="flex-1 text-sm font-space text-white">{t.message}</p>
          <button
            onClick={() => dismiss(t.id)}
            className="flex-shrink-0 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Adicionar ToastProvider e ToastContainer ao layout**

Modificar `src/app/layout.tsx`:

```typescript
import type { Metadata } from "next";
import { Orbitron, Space_Mono, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/contexts/ToastContext";
import { ToastContainer } from "@/components/ui/Toast";

const orbitron = Orbitron({
  subsets: ["latin"],
  variable: "--font-orbitron",
  display: "swap",
});

const space = Space_Mono({
  subsets: ["latin"],
  variable: "--font-space",
  display: "swap",
  weight: ["400", "700"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WR Trading Pro - Plataforma de Trading Avançada",
  description: "Plataforma de trading com análise quantitativa, machine learning e integrações em tempo real",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${orbitron.variable} ${space.variable} ${jetbrains.variable} antialiased`}>
        <ToastProvider>
          {children}
          <ToastContainer />
        </ToastProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verificar que compila sem erros**

```bash
cd "C:\Users\rwres\OneDrive\Área de Trabalho\AI\wr_trade_pro_"
npx tsc --noEmit
```

Esperado: sem erros de TypeScript.

- [ ] **Step 5: Commit**

```bash
git add src/contexts/ToastContext.tsx src/components/ui/Toast.tsx src/app/layout.tsx
git commit -m "feat: adicionar sistema de Toast global (substitui alert())"
```

---

## Task 3: Extrair DashboardTab

**Files:**
- Create: `src/components/tabs/DashboardTab.tsx`
- Modify: `src/app/page.tsx` (remover conteúdo do dashboard)

- [ ] **Step 1: Criar `src/components/tabs/DashboardTab.tsx`**

Mover todo o JSX do `activeTab === 'dashboard'` de `page.tsx` para este componente. O componente recebe as props necessárias do shell:

```typescript
"use client";

import { useState } from "react";
import { DollarSign, TrendingUp, Activity, BarChart3 } from "lucide-react";
import CandlestickChart from "@/components/CandlestickChart";
import AIChat from "@/components/AIChat";
import OrderForm from "@/components/OrderForm";
import OrderBook from "@/components/OrderBook";
import OpenPositions from "@/components/OpenPositions";
import { MT5AccountInfo, MT5Tick } from "@/types/mt5";

interface DashboardTabProps {
  accountInfo: MT5AccountInfo | null;
  tickData: Map<string, MT5Tick>;
}

export default function DashboardTab({ accountInfo, tickData }: DashboardTabProps) {
  const [chartData, setChartData] = useState<any[]>([]);
  const [showVolume, setShowVolume] = useState(false);
  const [selectedTimeframe, setSelectedTimeframe] = useState("1H");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [selectedIndicators, setSelectedIndicators] = useState([
    { name: "MA7", enabled: false, color: "#f59e0b" },
    { name: "MA21", enabled: false, color: "#8b5cf6" },
    { name: "MA50", enabled: false, color: "#ec4899" },
    { name: "RSI", enabled: false, color: "#06b6d4" },
  ]);

  return (
    <div className="py-4 space-y-6">
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
          <h2 className="font-orbitron text-lg font-bold text-white neon-text-pink mb-4">
            Gráfico de Preços
          </h2>
          <label className="flex items-center gap-2 text-sm font-space text-gray-400 cursor-pointer hover:text-white mb-4">
            <input
              type="checkbox"
              checked={showVolume}
              onChange={(e) => setShowVolume(e.target.checked)}
              className="w-4 h-4 accent-cyber-cyan"
            />
            Mostrar Volume
          </label>
          <CandlestickChart
            data={chartData}
            showVolume={showVolume}
            timeframe={selectedTimeframe}
            onTimeframeChange={setSelectedTimeframe}
            indicators={selectedIndicators}
            onIndicatorChange={setSelectedIndicators}
          />
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

// StatCard inline (componente local reutilizado do page.tsx)
function StatCard({ title, value, change, positive, icon }: {
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

- [ ] **Step 2: Verificar TypeScript**

```bash
npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/tabs/DashboardTab.tsx
git commit -m "feat: extrair DashboardTab de page.tsx"
```

---

## Task 4: Extrair as 7 abas restantes

**Files:**
- Create: `src/components/tabs/OrdersTab.tsx`
- Create: `src/components/tabs/PortfolioTab.tsx`
- Create: `src/components/tabs/SpreadTab.tsx`
- Create: `src/components/tabs/MonitoringTab.tsx`
- Create: `src/components/tabs/MLPredictionsTab.tsx`
- Create: `src/components/tabs/MLModelsTab.tsx`
- Create: `src/components/tabs/AdminTab.tsx`

- [ ] **Step 1: Criar OrdersTab.tsx**

```typescript
"use client";

import MT5Orders from "@/components/MT5Orders";

export default function OrdersTab() {
  return <MT5Orders />;
}
```

- [ ] **Step 2: Criar PortfolioTab.tsx**

```typescript
"use client";

import Portfolio from "@/components/Portfolio";

export default function PortfolioTab() {
  return (
    <div className="cyber-card p-6 hud-corner">
      <h2 className="font-orbitron text-2xl font-bold text-white neon-text-purple mb-6">
        Gestão de Portfólio
      </h2>
      <Portfolio />
    </div>
  );
}
```

- [ ] **Step 3: Criar SpreadTab.tsx**

Mover todo o JSX do `activeTab === 'spread'` de `page.tsx` para este componente. O componente mantém seu próprio estado de spread (símbolo1, símbolo2, datas, etc.):

```typescript
"use client";

import { useState, useEffect } from "react";
import SpreadOrderForm from "@/components/SpreadOrderForm";
import SpreadSummary from "@/components/SpreadSummary";
import SpreadPendingOrders from "@/components/SpreadPendingOrders";
import SpreadOrderHistory from "@/components/SpreadOrderHistory";
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

  const handlePairSelected = (result: SpreadResult) => {
    setSpreadSymbol1(result.symbol1);
    setSpreadSymbol2(result.symbol2);
    setSpreadActiveTab("analysis");
  };

  return (
    <div className="space-y-6">
      {/* Conteúdo do spread — mover JSX exato do page.tsx activeTab === 'spread' */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <SpreadOrderForm />
          <SpreadSummary />
        </div>
        <div className="lg:col-span-2 space-y-4">
          <div className="flex gap-2">
            <button
              onClick={() => setSpreadActiveTab("analysis")}
              className={`px-4 py-2 font-space text-sm rounded ${spreadActiveTab === "analysis" ? "bg-cyber-cyan/20 text-cyber-cyan border border-cyber-cyan/50" : "text-gray-400 hover:text-white"}`}
            >
              Análise de Spread
            </button>
            <button
              onClick={() => setSpreadActiveTab("finder")}
              className={`px-4 py-2 font-space text-sm rounded ${spreadActiveTab === "finder" ? "bg-cyber-pink/20 text-cyber-pink border border-cyber-pink/50" : "text-gray-400 hover:text-white"}`}
            >
              Buscar Pares
            </button>
          </div>
          {spreadActiveTab === "analysis" ? (
            <SpreadAnalysis
              symbol1={spreadSymbol1}
              symbol2={spreadSymbol2}
              startDate={spreadStartDate}
              endDate={spreadEndDate}
              ganhoMinimo={spreadGanhoMinimo}
              onSymbol1Change={setSpreadSymbol1}
              onSymbol2Change={setSpreadSymbol2}
              onStartDateChange={setSpreadStartDate}
              onEndDateChange={setSpreadEndDate}
              onGanhoMinimoChange={setSpreadGanhoMinimo}
            />
          ) : (
            <SpreadPairsFinder onPairSelected={handlePairSelected} />
          )}
          <VolatilityPanel />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SpreadPendingOrders />
        <SpreadOrderHistory />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Criar MonitoringTab.tsx**

Mover todo o JSX e handlers de monitoramento de `page.tsx` para este componente. O componente gerencia seu próprio estado de monitoramento:

```typescript
"use client";

import { useState } from "react";
import StockMonitoringTable from "@/components/StockMonitoringTable";
import StockMonitoringForm from "@/components/StockMonitoringForm";
import StockDetailPanel from "@/components/StockDetailPanel";
import StockAlertsPanel from "@/components/StockAlertsPanel";
import StockReportsPanel from "@/components/StockReportsPanel";
import DividendMapCalendar from "@/components/DividendMapCalendar";
import { useToast } from "@/contexts/ToastContext";
import { StockMonitoring, StockMonitoringInput } from "@/types/stock-monitoring";

export default function MonitoringTab() {
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingStock, setEditingStock] = useState<StockMonitoring | undefined>();
  const [selectedStock, setSelectedStock] = useState<StockMonitoring | null>(null);
  const [statusFilter, setStatusFilter] = useState<"COMPRA" | "VENDA" | "NEUTRO" | "ATENCAO" | undefined>();
  const [showDividendCalendar, setShowDividendCalendar] = useState(false);
  const [activeTab, setActiveTab] = useState<"monitoramento" | "alertas" | "relatorios">("monitoramento");
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCreate = async (data: StockMonitoringInput) => {
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
  };

  const handleUpdate = async (data: StockMonitoringInput) => {
    if (!editingStock) return;
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
  };

  const handleDelete = async () => {
    if (!selectedStock) return;
    const response = await fetch(`/api/stock-monitoring/${selectedStock.id}`, { method: "DELETE" });
    const result = await response.json();
    if (result.success) {
      toast.success("Monitoramento excluído com sucesso!");
      setSelectedStock(null);
      setRefreshKey((k) => k + 1);
    } else {
      toast.error(result.error || "Erro ao excluir monitoramento");
    }
  };

  // Renderização — mover JSX exato da aba monitoramento do page.tsx
  return (
    <div className="space-y-6">
      {/* Conteúdo idêntico ao que estava em page.tsx para activeTab === 'monitoramento' */}
      {showForm ? (
        <StockMonitoringForm
          initialData={editingStock}
          onSubmit={editingStock ? handleUpdate : handleCreate}
          onCancel={() => { setShowForm(false); setEditingStock(undefined); }}
        />
      ) : selectedStock ? (
        <StockDetailPanel
          stock={selectedStock}
          onClose={() => setSelectedStock(null)}
          onEdit={() => { setEditingStock(selectedStock); setShowForm(true); setSelectedStock(null); }}
          onDelete={handleDelete}
          onViewDividends={() => setShowDividendCalendar(true)}
        />
      ) : showDividendCalendar && selectedStock ? (
        <DividendMapCalendar
          stock={selectedStock}
          onClose={() => setShowDividendCalendar(false)}
        />
      ) : (
        <>
          <div className="flex gap-2 border-b border-cyber-border pb-2">
            {(["monitoramento", "alertas", "relatorios"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 font-space text-sm capitalize ${activeTab === tab ? "text-cyber-cyan border-b-2 border-cyber-cyan" : "text-gray-400 hover:text-white"}`}
              >
                {tab}
              </button>
            ))}
          </div>
          {activeTab === "monitoramento" && (
            <StockMonitoringTable
              key={refreshKey}
              statusFilter={statusFilter}
              onViewDetails={setSelectedStock}
              onEdit={(stock) => { setEditingStock(stock); setShowForm(true); }}
              onNewStock={() => setShowForm(true)}
              onFilterChange={setStatusFilter}
            />
          )}
          {activeTab === "alertas" && <StockAlertsPanel />}
          {activeTab === "relatorios" && <StockReportsPanel />}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Criar MLPredictionsTab.tsx**

```typescript
"use client";

import PredictionChart from "@/components/PredictionChart";

export default function MLPredictionsTab() {
  return (
    <div className="cyber-card p-6 hud-corner">
      <h2 className="font-orbitron text-2xl font-bold text-white neon-text-cyan mb-6">
        Previsões de Machine Learning
      </h2>
      <PredictionChart data={[]} symbol="PETR4" timeframe="1H" />
    </div>
  );
}
```

- [ ] **Step 6: Criar MLModelsTab.tsx**

```typescript
"use client";

import { Cpu } from "lucide-react";

export default function MLModelsTab() {
  return (
    <div className="cyber-card p-6 hud-corner">
      <h2 className="font-orbitron text-2xl font-bold text-white neon-text-pink mb-6">
        Modelos de Machine Learning
      </h2>
      <div className="bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-pink-500/10 border border-cyan-500/30 rounded-2xl p-12 text-center">
        <div className="flex justify-center mb-6">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center animate-pulse">
            <Cpu className="w-12 h-12 text-white" />
          </div>
        </div>
        <h3 className="font-orbitron text-3xl font-bold text-white mb-4">Em Desenvolvimento</h3>
        <p className="text-gray-400 text-lg">Modelos com dados MT5 — em breve</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Criar AdminTab.tsx**

```typescript
"use client";

import Link from "next/link";

export default function AdminTab() {
  return (
    <div className="cyber-card p-6 hud-corner">
      <h2 className="font-orbitron text-2xl font-bold text-white neon-text-cyan mb-6">
        Administração
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/admin/metrics" className="cyber-card p-4 hud-corner hover:border-cyber-cyan/50 transition-colors block">
          <h3 className="font-orbitron text-white mb-2">Métricas do Sistema</h3>
          <p className="text-sm text-gray-400 font-space">Performance e uptime dos serviços</p>
        </Link>
        <Link href="/admin/logs" className="cyber-card p-4 hud-corner hover:border-cyber-cyan/50 transition-colors block">
          <h3 className="font-orbitron text-white mb-2">Logs</h3>
          <p className="text-sm text-gray-400 font-space">Log de erros e eventos do sistema</p>
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Verificar TypeScript**

```bash
npx tsc --noEmit
```

Esperado: sem erros de TypeScript.

- [ ] **Step 9: Commit**

```bash
git add src/components/tabs/
git commit -m "feat: extrair 8 componentes de aba de page.tsx"
```

---

## Task 5: Refatorar page.tsx como shell com kept-alive

**Files:**
- Modify: `src/app/page.tsx` (reduzir de 1238 para ~150 linhas)
- Delete: `src/components/SpreadNotification.tsx` (substituído pelo Toast)

- [ ] **Step 1: Reescrever page.tsx como shell**

Substituir todo o conteúdo de `src/app/page.tsx` por:

```typescript
"use client";

import { useState, useEffect, lazy, Suspense } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard, FileText, BarChart3, Brain, Cpu,
  ArrowDownLeft, TrendingUp, Database, Wifi, WifiOff, Zap, LogOut
} from "lucide-react";
import MT5ConnectionForm from "@/components/MT5ConnectionForm";
import Modal from "@/components/Modal";
import PriceTicker from "@/components/PriceTicker";
import { MT5ServiceSingleton } from "@/services/mt5Service";
import { MT5AccountInfo, MT5Tick } from "@/types/mt5";

// Lazy load de cada aba — só carrega quando acessada pela 1ª vez
const DashboardTab = lazy(() => import("@/components/tabs/DashboardTab"));
const OrdersTab = lazy(() => import("@/components/tabs/OrdersTab"));
const PortfolioTab = lazy(() => import("@/components/tabs/PortfolioTab"));
const SpreadTab = lazy(() => import("@/components/tabs/SpreadTab"));
const MonitoringTab = lazy(() => import("@/components/tabs/MonitoringTab"));
const MLPredictionsTab = lazy(() => import("@/components/tabs/MLPredictionsTab"));
const MLModelsTab = lazy(() => import("@/components/tabs/MLModelsTab"));
const AdminTab = lazy(() => import("@/components/tabs/AdminTab"));

type TabId = "dashboard" | "orders" | "portfolio" | "spread" | "monitoramento" | "ml" | "models" | "admin";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "orders", label: "Ordens", icon: FileText },
  { id: "portfolio", label: "Portfólio", icon: BarChart3 },
  { id: "ml", label: "Previsões ML", icon: Brain },
  { id: "models", label: "Modelos ML", icon: Cpu },
  { id: "spread", label: "Spread B3", icon: ArrowDownLeft },
  { id: "monitoramento", label: "Monitoramento", icon: TrendingUp },
  { id: "admin", label: "Admin", icon: Database },
];

export default function Dashboard() {
  const router = useRouter();
  const mt5Service = MT5ServiceSingleton.getInstance();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [mountedTabs, setMountedTabs] = useState<Set<TabId>>(new Set());
  const [mt5Connected, setMt5Connected] = useState(false);
  const [accountInfo, setAccountInfo] = useState<MT5AccountInfo | null>(null);
  const [tickData, setTickData] = useState<Map<string, MT5Tick>>(new Map());
  const [showMT5Modal, setShowMT5Modal] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => { setMounted(true); }, []);

  // Verificar autenticação
  useEffect(() => {
    if (!mounted) return;
    try {
      const authData = localStorage.getItem("wr_trading_auth");
      if (!authData || !JSON.parse(authData).isAuthenticated) {
        router.push("/login");
      }
    } catch {
      router.push("/login");
    }
  }, [mounted, router]);

  // Timer
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Eventos MT5
  useEffect(() => {
    const handleTick = (tick: MT5Tick) => {
      if (tick.symbol && tick.bid) {
        setTickData((prev) => new Map(prev).set(tick.symbol!, tick));
      }
    };
    const handleAccount = (account: MT5AccountInfo) => setAccountInfo(account);
    const handleState = (state: any) => {
      setMt5Connected(state.state === "CONNECTED");
      if (state.state === "CONNECTED" && state.accountInfo) setAccountInfo(state.accountInfo);
    };

    mt5Service.on("tick", handleTick);
    mt5Service.on("account", handleAccount);
    mt5Service.on("state", handleState);

    const state = mt5Service.getConnectionState();
    if (state.state === "CONNECTED" && state.accountInfo) setAccountInfo(state.accountInfo);

    return () => {
      mt5Service.off("tick", handleTick);
      mt5Service.off("account", handleAccount);
      mt5Service.off("state", handleState);
    };
  }, []);

  // Kept-alive: ao clicar numa aba, adiciona ao Set de abas montadas
  const handleTabChange = (tabId: TabId) => {
    setActiveTab(tabId);
    setMountedTabs((prev) => new Set(prev).add(tabId));
  };

  // Montar Dashboard por padrão
  useEffect(() => {
    setMountedTabs(new Set<TabId>(["dashboard"]));
  }, []);

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
                  <button onClick={() => { mt5Service.disconnect(); setMt5Connected(false); }} className="text-xs text-gray-400 hover:text-white font-space ml-1">Desconectar</button>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-red-400" />
                  <span className="text-sm text-red-400 font-space">Desconectado</span>
                  <button onClick={() => setShowMT5Modal(true)} className="text-xs text-cyber-pink hover:text-white font-space ml-1">Conectar</button>
                </>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400 font-space">Hora do Mercado</p>
              <p className="text-sm font-jetbrains text-cyber-cyan">{currentTime.toLocaleTimeString("pt-BR")}</p>
            </div>
            <button onClick={() => { localStorage.removeItem("wr_trading_auth"); router.push("/login"); }} className="cyber-button cyber-button-secondary flex items-center gap-2" title="Sair">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Abas de navegação */}
      <div className="border-b border-cyber-border bg-cyber-card/30">
        <div className="px-4 flex gap-1 flex-wrap">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              className={`flex items-center gap-2 px-4 py-3 font-space text-sm transition-colors ${
                activeTab === id ? "text-cyber-cyan border-b-2 border-cyber-cyan" : "text-gray-400 hover:text-white"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <PriceTicker symbols={[]} />

      {/* Modal MT5 */}
      <Modal isOpen={showMT5Modal} onClose={() => setShowMT5Modal(false)} title="Conectar ao MetaTrader 5">
        <MT5ConnectionForm onClose={() => setShowMT5Modal(false)} onConnected={() => setMt5Connected(true)} />
      </Modal>

      {/* Conteúdo — kept-alive via display:none */}
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
            <Suspense fallback={<TabLoader />}><MonitoringTab /></Suspense>
          </div>
        )}
        {mountedTabs.has("ml") && (
          <div style={{ display: activeTab === "ml" ? "block" : "none" }}>
            <Suspense fallback={<TabLoader />}><MLPredictionsTab /></Suspense>
          </div>
        )}
        {mountedTabs.has("models") && (
          <div style={{ display: activeTab === "models" ? "block" : "none" }}>
            <Suspense fallback={<TabLoader />}><MLModelsTab /></Suspense>
          </div>
        )}
        {mountedTabs.has("admin") && (
          <div style={{ display: activeTab === "admin" ? "block" : "none" }}>
            <Suspense fallback={<TabLoader />}><AdminTab /></Suspense>
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
```

- [ ] **Step 2: Remover SpreadNotification.tsx (substituído pelo Toast)**

```bash
rm src/components/SpreadNotification.tsx
```

Verificar se há imports de `SpreadNotification` e removê-los:

```bash
grep -r "SpreadNotification" src/ --include="*.tsx" --include="*.ts"
```

Remover qualquer import encontrado.

- [ ] **Step 3: Verificar TypeScript**

```bash
npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 4: Testar no browser**

```bash
npm run dev
```

Verificar manualmente:
- [ ] Plataforma carrega sem erros no console
- [ ] Trocar entre abas não causa erros
- [ ] Ao voltar para Dashboard, os dados ainda estão lá (kept-alive funcionando)
- [ ] Notificações Toast aparecem no canto inferior direito (testar criando um monitoramento)

- [ ] **Step 5: Commit final**

```bash
git add src/app/page.tsx src/app/layout.tsx
git add -u src/components/SpreadNotification.tsx  # remove
git commit -m "feat: refatorar page.tsx como shell kept-alive — 1238 linhas → ~150 linhas"
```

---

## Validação Final do Sub-projeto 1

- [ ] `python/` tem os 4 scripts ativos + requirements.txt + README.md
- [ ] `scripts/utils/` e `scripts/tests/` têm os scripts utilitários
- [ ] `archive/projeto_spread_legacy/` tem o protótipo Streamlit
- [ ] Raiz do projeto limpa — sem `.py` soltos
- [ ] `src/components/tabs/` tem 8 arquivos `.tsx`
- [ ] `page.tsx` tem ~150 linhas
- [ ] `src/contexts/ToastContext.tsx` existe e funciona
- [ ] `src/components/ui/Toast.tsx` existe
- [ ] Trocar de aba não perde dados (kept-alive)
- [ ] `SpreadNotification.tsx` removido
- [ ] `npm run dev` sem erros no console
- [ ] `npx tsc --noEmit` sem erros

```bash
# Verificação rápida
echo "=== Raiz Python ===" && ls *.py 2>/dev/null || echo "Limpa"
echo "=== python/ ===" && ls python/
echo "=== tabs/ ===" && ls src/components/tabs/
echo "=== page.tsx linhas ===" && wc -l src/app/page.tsx
```
