"use client";

/**
 * Fundamentos CVM — 138 empresas B3, séries trimestrais 2011–2025.
 * Fonte: banco DERIVADO do lab (data/cvm), read-only, sem point-in-time —
 * a proveniência é exibida no topo da tab. O modelo canônico CvmFiling/
 * CvmFact permanece reservado à futura ingestão bruta do portal da CVM.
 */

import { useEffect, useMemo, useState } from "react";
import { Search, Landmark, AlertTriangle } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine,
} from "recharts";

interface Company {
  cdCvm: string;
  ticker: string;
  nome: string;
  setor: string | null;
  segmento: string | null;
}

interface Quarter {
  ano: number;
  trimestre: number;
  dataRef: string | null;
  receitaLiquida: number | null;
  lucroBruto: number | null;
  ebit: number | null;
  ebitda: number | null;
  lucroLiquido: number | null;
  ativoTotal: number | null;
  caixa: number | null;
  patrimonioLiquido: number | null;
  dividaCp: number | null;
  dividaLp: number | null;
  fco: number | null;
  capex: number | null;
  fcf: number | null;
  dividendosPagos: number | null;
  margemBruta: number | null;
  margemEbit: number | null;
  margemEbitda: number | null;
  margemLiquida: number | null;
  roe: number | null;
  roa: number | null;
  endividamento: number | null;
  liquidezCorrente: number | null;
  dividaPl: number | null;
}

interface DividendQuarter {
  ano: number;
  trimestre: number;
  dataRef: string | null;
  dividendosPagos: number | null;
  jcpPagos: number | null;
  proventosSaidaCaixa: number | null;
}

interface DividendQuality {
  ticker: string;
  score: number | null;
  classe: string | null;
  scoreRecorrencia: number | null;
  scoreCrescimento: number | null;
  scorePayout: number | null;
  scoreCoberturaCaixa: number | null;
  scoreSaudeFinanceira: number | null;
  scoreResiliencia: number | null;
  scoreYieldPreco: number | null;
  alertas: string | null;
  saudeFinanceira?: number | null;
  saudeClassificacao?: string | null;
  monteCarlo?: string | null;
}

interface PortfolioPosition {
  ticker: string;
  nome: string | null;
  macroSetor: string | null;
  gateMonteCarlo: string | null;
  scoreQualidade: number | null;
  scoreFinal: number | null;
  saudeFinanceira: number | null;
  pesoSugeridoPct: number | null;
  racional: string | null;
}

interface DividendsData {
  ranking: DividendQuality[];
  portfolio: PortfolioPosition[];
}

interface CompanyDetail {
  company: Company;
  quarters: Quarter[];
  dividends: {
    quarters: DividendQuarter[];
    summary: { totalProventosSaidaCaixa: number | null } | null;
    quality: DividendQuality | null;
    health: { score: number | null; classificacao: string | null; periodo: string } | null;
  } | null;
  provenance: { source: string; pointInTime: boolean; note: string };
}

const GATE_COLORS: Record<string, string> = {
  "Núcleo robusto": "text-green-400 border-green-500/40 bg-green-500/10",
  "Manter com teto": "text-cyan-400 border-cyan-500/40 bg-cyan-500/10",
  "Observação controlada": "text-yellow-400 border-yellow-500/40 bg-yellow-500/10",
  Reduzir: "text-red-400 border-red-500/40 bg-red-500/10",
};

const gateClass = (gate: string | null | undefined): string =>
  GATE_COLORS[gate ?? ""] ?? "text-gray-400 border-gray-500/40 bg-gray-500/10";

const fmtBRL = (v: number | null): string => {
  if (v === null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `R$ ${(v / 1e9).toFixed(2)} bi`;
  if (abs >= 1e6) return `R$ ${(v / 1e6).toFixed(1)} mi`;
  if (abs >= 1e3) return `R$ ${(v / 1e3).toFixed(0)} mil`;
  return `R$ ${v.toFixed(0)}`;
};

const fmtPct = (v: number | null): string => (v === null ? "—" : `${v.toFixed(2)}%`);

interface FundamentalPoint {
  period: { ano: number; trimestre: number };
  value: number | null;
  unit: "percent" | "ratio" | "multiple";
  source: "pipeline-cvm" | "derivado-wr";
  dataRef: string | null;
  knowledgeDate: string;
  estimadoPorPrazoLegal: boolean;
  note?: string;
}
interface FundamentalSheet {
  company: { cdCvm: string; ticker: string; nome: string; setor: string | null };
  series: Record<string, FundamentalPoint[]>;
  provenance: {
    db: string;
    tables: string[];
    legalLagRule: string;
    base: { source: string; pointInTime: boolean; note: string };
    generatedAt: string;
  };
}

export default function CvmFundamentalsTab() {
  const [view, setView] = useState<"empresas" | "dividendos">("empresas");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [sheet, setSheet] = useState<FundamentalSheet | null>(null);
  const [dividends, setDividends] = useState<DividendsData | null>(null);
  const [rankSearch, setRankSearch] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/cvm/companies")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setCompanies(data.companies ?? []))
      .catch(() => setError("Não foi possível carregar a lista de empresas CVM."))
      .finally(() => setLoadingList(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoadingDetail(true);
    setError("");
    fetch(`/api/cvm/companies/${selected}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setDetail(data))
      .catch(() => setError("Não foi possível carregar os fundamentos desta empresa."))
      .finally(() => setLoadingDetail(false));
  }, [selected]);

  // Ficha fundamentalista: série do pipeline CVM + conversão de caixa derivada
  useEffect(() => {
    if (!selected) {
      setSheet(null);
      return;
    }
    setSheet(null);
    fetch(`/api/cvm/companies/${selected}/fundamentals`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setSheet(data))
      .catch(() => setError("Não foi possível carregar a ficha fundamentalista."));
  }, [selected]);

  // Ranking de dividendos: carregado na primeira visita à visão
  useEffect(() => {
    if (view !== "dividendos" || dividends) return;
    fetch("/api/cvm/dividends")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setDividends(data))
      .catch(() => setError("Não foi possível carregar o ranking de dividendos."));
  }, [view, dividends]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) =>
        c.ticker.toLowerCase().includes(q) ||
        c.nome.toLowerCase().includes(q) ||
        (c.setor ?? "").toLowerCase().includes(q)
    );
  }, [companies, search]);

  const filteredRanking = useMemo(() => {
    if (!dividends) return [];
    const q = rankSearch.trim().toLowerCase();
    if (!q) return dividends.ranking;
    return dividends.ranking.filter(
      (r) => r.ticker.toLowerCase().includes(q) || (r.classe ?? "").toLowerCase().includes(q)
    );
  }, [dividends, rankSearch]);

  const quarters = detail?.quarters ?? [];
  const last = quarters.length > 0 ? quarters[quarters.length - 1] : null;
  const chartData = useMemo(
    () =>
      quarters.slice(-20).map((q) => ({
        periodo: `${q.ano}T${q.trimestre}`,
        receita: q.receitaLiquida === null ? null : q.receitaLiquida / 1e6,
        lucro: q.lucroLiquido === null ? null : q.lucroLiquido / 1e6,
        margemLiquida: q.margemLiquida,
        margemEbitda: q.margemEbitda,
        roe: q.roe,
      })),
    [quarters]
  );

  // Zip das séries da ficha por período (todas alinhadas por construção no assembler).
  // value === null é preservado como lacuna (connectNulls no gráfico), nunca vira 0.
  const sheetChart = useMemo(() => {
    if (!sheet) return [] as Record<string, number | string | null>[];
    const keys = Object.keys(sheet.series);
    const ref = keys.length ? sheet.series[keys[0]] : [];
    return ref.slice(-20).map((_, idxFromTail) => {
      const i = ref.length - Math.min(ref.length, 20) + idxFromTail;
      const p = ref[i].period;
      const row: Record<string, number | string | null> = { periodo: `${p.ano}T${p.trimestre}` };
      for (const k of keys) row[k] = sheet.series[k][i]?.value ?? null;
      return row;
    });
  }, [sheet]);
  const sheetStamp = sheet?.series.roe?.[sheet.series.roe.length - 1] ?? null;

  return (
    <div className="space-y-6">
      {/* Proveniência — sempre visível */}
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
        <p className="text-yellow-400 text-sm font-space">
          <span className="font-bold">Fonte:</span>{" "}
          {detail?.provenance.source ?? "CVM (derivado — pipeline do lab, snapshot 2026-07-14)"}.
          Valores derivados/normalizados, sem point-in-time (sem protocolo, publicação ou
          versionamento de retificação).
        </p>
      </div>

      {/* Sub-navegação */}
      <div className="flex gap-2">
        {(
          [
            { id: "empresas", label: "Empresas" },
            { id: "dividendos", label: "Dividendos & Carteira" },
          ] as const
        ).map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`px-4 py-2 rounded-lg font-orbitron text-xs uppercase tracking-wider transition-colors border ${
              view === v.id
                ? "bg-cyber-pink/20 border-cyber-pink/60 text-white"
                : "border-cyber-border text-gray-400 hover:text-white hover:bg-cyber-dark"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "dividendos" && (
        <div className="space-y-6">
          {!dividends && !error && (
            <div className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-12 text-center">
              <p className="text-gray-400 font-space">Carregando ranking de dividendos…</p>
            </div>
          )}

          {dividends && (
            <>
              {/* Carteira 12 */}
              <div className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-5">
                <h3 className="font-orbitron text-sm font-bold text-cyber-cyan uppercase tracking-wider mb-1">
                  Carteira 12 Dividendos/JCP
                </h3>
                <p className="text-xs text-gray-500 font-space mb-4">
                  Seleção do lab com gates de score, saúde financeira e Monte Carlo — peso uniforme
                  de 8,33% por ativo. Não é recomendação de investimento.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {dividends.portfolio.map((p) => (
                    <div
                      key={p.ticker}
                      className="border border-cyber-border rounded-lg p-3 bg-cyber-dark/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-orbitron font-bold text-white">{p.ticker}</span>
                        <span
                          className={`text-[0.65rem] font-space px-2 py-0.5 rounded-full border ${gateClass(p.gateMonteCarlo)}`}
                        >
                          {p.gateMonteCarlo ?? "—"}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 font-space truncate">{p.nome ?? ""}</p>
                      <div className="flex items-baseline justify-between mt-2">
                        <span className="text-xs text-gray-500 font-space">{p.macroSetor ?? "—"}</span>
                        <span className="text-lg font-bold text-cyber-cyan font-space">
                          {p.scoreQualidade?.toFixed(1) ?? "—"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Ranking completo */}
              <div className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <h3 className="font-orbitron text-sm font-bold text-cyber-cyan uppercase tracking-wider">
                    Ranking — Score de Qualidade de Dividendos ({filteredRanking.length})
                  </h3>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={rankSearch}
                      onChange={(e) => setRankSearch(e.target.value)}
                      placeholder="Ticker ou classe..."
                      className="bg-cyber-dark/50 border border-cyber-border rounded-lg pl-9 pr-3 py-2 text-sm text-white font-space focus:border-cyber-pink outline-none"
                    />
                  </div>
                </div>
                <div className="overflow-x-auto overflow-y-auto max-h-[36rem]">
                  <table className="w-full text-sm font-space">
                    <thead className="sticky top-0 bg-cyber-dark">
                      <tr className="text-left text-gray-400 border-b border-cyber-border">
                        <th className="py-2 pr-3">#</th>
                        <th className="py-2 pr-3">Ticker</th>
                        <th className="py-2 pr-3">Score</th>
                        <th className="py-2 pr-3">Classe</th>
                        <th className="py-2 pr-3">Recorr.</th>
                        <th className="py-2 pr-3">Cresc.</th>
                        <th className="py-2 pr-3">Cobert.</th>
                        <th className="py-2 pr-3">Saúde</th>
                        <th className="py-2">Monte Carlo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRanking.map((r, i) => (
                        <tr
                          key={r.ticker}
                          className="border-b border-cyber-border/40 text-gray-200 hover:bg-cyber-dark/60"
                        >
                          <td className="py-2 pr-3 text-gray-500">{i + 1}</td>
                          <td className="py-2 pr-3 font-orbitron font-bold text-white">{r.ticker}</td>
                          <td className="py-2 pr-3 font-bold text-cyber-cyan">
                            {r.score?.toFixed(1) ?? "—"}
                          </td>
                          <td className="py-2 pr-3">{r.classe ?? "—"}</td>
                          <td className="py-2 pr-3">{r.scoreRecorrencia?.toFixed(0) ?? "—"}</td>
                          <td className="py-2 pr-3">{r.scoreCrescimento?.toFixed(0) ?? "—"}</td>
                          <td className="py-2 pr-3">{r.scoreCoberturaCaixa?.toFixed(0) ?? "—"}</td>
                          <td className="py-2 pr-3">
                            {r.saudeFinanceira?.toFixed(1) ?? "—"}
                            {r.saudeClassificacao ? ` (${r.saudeClassificacao})` : ""}
                          </td>
                          <td className="py-2">
                            {r.monteCarlo ? (
                              <span
                                className={`text-[0.65rem] px-2 py-0.5 rounded-full border ${gateClass(r.monteCarlo)}`}
                              >
                                {r.monteCarlo}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {view === "empresas" && (
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Lista de empresas */}
        <div className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-4 lg:col-span-1">
          <h2 className="font-orbitron text-sm font-bold text-cyber-cyan uppercase tracking-wider mb-3 flex items-center gap-2">
            <Landmark className="w-4 h-4" /> Empresas ({filtered.length})
          </h2>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ticker, nome ou setor..."
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg pl-9 pr-3 py-2 text-sm text-white font-space focus:border-cyber-pink outline-none"
            />
          </div>
          <div className="overflow-y-auto max-h-[32rem] space-y-1 pr-1">
            {loadingList && <p className="text-gray-400 text-sm font-space">Carregando…</p>}
            {!loadingList &&
              filtered.map((c) => (
                <button
                  key={c.cdCvm}
                  onClick={() => setSelected(c.cdCvm)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                    selected === c.cdCvm
                      ? "bg-cyber-pink/20 border border-cyber-pink/50"
                      : "hover:bg-cyber-dark border border-transparent"
                  }`}
                >
                  <span className="font-orbitron text-sm font-bold text-white">{c.ticker}</span>
                  <span className="block text-xs text-gray-400 font-space truncate">{c.nome}</span>
                </button>
              ))}
          </div>
        </div>

        {/* Detalhe */}
        <div className="lg:col-span-3 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm font-space">
              {error}
            </div>
          )}

          {!selected && !error && (
            <div className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-12 text-center">
              <Landmark className="w-12 h-12 text-cyber-cyan/50 mx-auto mb-4" />
              <p className="text-gray-400 font-space">
                Selecione uma empresa para ver os fundamentos trimestrais (2011–2025).
              </p>
            </div>
          )}

          {loadingDetail && (
            <div className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-12 text-center">
              <p className="text-gray-400 font-space">Carregando fundamentos…</p>
            </div>
          )}

          {detail && !loadingDetail && last && (
            <>
              {/* Cabeçalho da empresa */}
              <div className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-5">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <h2 className="font-orbitron text-2xl font-bold text-white neon-text-pink">
                    {detail.company.ticker}
                  </h2>
                  <span className="text-gray-300 font-space">{detail.company.nome}</span>
                  <span className="text-xs text-gray-500 font-space">
                    CVM {detail.company.cdCvm}
                    {detail.company.setor ? ` · ${detail.company.setor}` : ""}
                  </span>
                </div>
                <p className="text-xs text-gray-500 font-space mt-1">
                  Último período: {last.ano}T{last.trimestre}
                  {last.dataRef ? ` (ref. ${last.dataRef})` : ""} · {quarters.length} trimestres
                </p>
              </div>

              {/* Cards de resumo */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {[
                  { label: "Receita Líq.", value: fmtBRL(last.receitaLiquida) },
                  { label: "Lucro Líq.", value: fmtBRL(last.lucroLiquido) },
                  { label: "EBITDA", value: fmtBRL(last.ebitda) },
                  { label: "ROE", value: fmtPct(last.roe) },
                  { label: "Margem Líq.", value: fmtPct(last.margemLiquida) },
                  { label: "Dívida/PL", value: fmtPct(last.dividaPl) },
                ].map((card) => (
                  <div
                    key={card.label}
                    className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-4"
                  >
                    <p className="text-[0.65rem] text-gray-400 font-orbitron uppercase tracking-wider">
                      {card.label}
                    </p>
                    <p className="text-lg font-bold text-white font-space mt-1">{card.value}</p>
                  </div>
                ))}
              </div>

              {/* Receita e lucro */}
              <div className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-5">
                <h3 className="font-orbitron text-sm font-bold text-cyber-cyan uppercase tracking-wider mb-4">
                  Receita × Lucro Líquido (R$ mi) — últimos {chartData.length} trimestres
                </h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="periodo" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
                      labelStyle={{ color: "#e2e8f0" }}
                      formatter={(v: number) => [`R$ ${Number(v).toFixed(1)} mi`]}
                    />
                    <Legend />
                    <ReferenceLine y={0} stroke="#475569" />
                    <Bar dataKey="receita" name="Receita" fill="#22d3ee" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="lucro" name="Lucro Líq." fill="#ec4899" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Margens e ROE */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-5">
                  <h3 className="font-orbitron text-sm font-bold text-cyber-cyan uppercase tracking-wider mb-4">
                    Margens (%)
                  </h3>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="periodo" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
                        labelStyle={{ color: "#e2e8f0" }}
                        formatter={(v: number) => [`${Number(v).toFixed(2)}%`]}
                      />
                      <Legend />
                      <ReferenceLine y={0} stroke="#475569" />
                      <Line type="monotone" dataKey="margemEbitda" name="Margem EBITDA" stroke="#a855f7" dot={false} strokeWidth={2} connectNulls />
                      <Line type="monotone" dataKey="margemLiquida" name="Margem Líquida" stroke="#22d3ee" dot={false} strokeWidth={2} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-5">
                  <h3 className="font-orbitron text-sm font-bold text-cyber-cyan uppercase tracking-wider mb-4">
                    ROE (%)
                  </h3>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="periodo" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
                        labelStyle={{ color: "#e2e8f0" }}
                        formatter={(v: number) => [`${Number(v).toFixed(2)}%`]}
                      />
                      <ReferenceLine y={0} stroke="#475569" />
                      <Line type="monotone" dataKey="roe" name="ROE" stroke="#ec4899" dot={false} strokeWidth={2} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Tabela dos últimos trimestres */}
              <div className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-5 overflow-x-auto">
                <h3 className="font-orbitron text-sm font-bold text-cyber-cyan uppercase tracking-wider mb-4">
                  Últimos 12 trimestres
                </h3>
                <table className="w-full text-sm font-space">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-cyber-border">
                      <th className="py-2 pr-4">Período</th>
                      <th className="py-2 pr-4">Receita</th>
                      <th className="py-2 pr-4">Lucro Líq.</th>
                      <th className="py-2 pr-4">EBITDA</th>
                      <th className="py-2 pr-4">FCO</th>
                      <th className="py-2 pr-4">ROE</th>
                      <th className="py-2 pr-4">Marg. Líq.</th>
                      <th className="py-2">Liq. Corr.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quarters.slice(-12).reverse().map((q) => (
                      <tr key={`${q.ano}T${q.trimestre}`} className="border-b border-cyber-border/40 text-gray-200">
                        <td className="py-2 pr-4 font-bold">{q.ano}T{q.trimestre}</td>
                        <td className="py-2 pr-4">{fmtBRL(q.receitaLiquida)}</td>
                        <td className={`py-2 pr-4 ${q.lucroLiquido !== null && q.lucroLiquido < 0 ? "text-red-400" : ""}`}>
                          {fmtBRL(q.lucroLiquido)}
                        </td>
                        <td className="py-2 pr-4">{fmtBRL(q.ebitda)}</td>
                        <td className="py-2 pr-4">{fmtBRL(q.fco)}</td>
                        <td className="py-2 pr-4">{fmtPct(q.roe)}</td>
                        <td className="py-2 pr-4">{fmtPct(q.margemLiquida)}</td>
                        <td className="py-2">{q.liquidezCorrente === null ? "—" : q.liquidezCorrente.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Dividendos & scores da empresa */}
              {detail.dividends && (
                <div className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-5">
                  <h3 className="font-orbitron text-sm font-bold text-cyber-cyan uppercase tracking-wider mb-4">
                    Dividendos & JCP
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                    <div className="border border-cyber-border rounded-lg p-3 bg-cyber-dark/50">
                      <p className="text-[0.65rem] text-gray-400 font-orbitron uppercase tracking-wider">
                        Score Qualidade
                      </p>
                      <p className="text-lg font-bold text-cyber-cyan font-space mt-1">
                        {detail.dividends.quality?.score?.toFixed(1) ?? "—"}
                      </p>
                      <p className="text-xs text-gray-400 font-space">
                        {detail.dividends.quality?.classe ?? "sem classificação"}
                      </p>
                    </div>
                    <div className="border border-cyber-border rounded-lg p-3 bg-cyber-dark/50">
                      <p className="text-[0.65rem] text-gray-400 font-orbitron uppercase tracking-wider">
                        Saúde Financeira
                      </p>
                      <p className="text-lg font-bold text-white font-space mt-1">
                        {detail.dividends.health?.score?.toFixed(1) ?? "—"}
                      </p>
                      <p className="text-xs text-gray-400 font-space">
                        {detail.dividends.health
                          ? `${detail.dividends.health.classificacao ?? "—"} (${detail.dividends.health.periodo})`
                          : "sem dados"}
                      </p>
                    </div>
                    <div className="border border-cyber-border rounded-lg p-3 bg-cyber-dark/50">
                      <p className="text-[0.65rem] text-gray-400 font-orbitron uppercase tracking-wider">
                        Total Pago (2011–25)
                      </p>
                      <p className="text-lg font-bold text-white font-space mt-1">
                        {fmtBRL(detail.dividends.summary?.totalProventosSaidaCaixa ?? null)}
                      </p>
                    </div>
                    <div className="border border-cyber-border rounded-lg p-3 bg-cyber-dark/50">
                      <p className="text-[0.65rem] text-gray-400 font-orbitron uppercase tracking-wider">
                        Alertas
                      </p>
                      <p className="text-xs text-yellow-400/90 font-space mt-1">
                        {detail.dividends.quality?.alertas ?? "nenhum"}
                      </p>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={detail.dividends.quarters.slice(-24).map((q) => ({
                        periodo: `${q.ano}T${q.trimestre}`,
                        proventos:
                          q.proventosSaidaCaixa === null ? null : q.proventosSaidaCaixa / 1e6,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="periodo" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
                        labelStyle={{ color: "#e2e8f0" }}
                        formatter={(v: number) => [`R$ ${Number(v).toFixed(1)} mi`, "Proventos"]}
                      />
                      <Bar
                        dataKey="proventos"
                        name="Proventos (saída de caixa)"
                        fill="#a855f7"
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Ficha Fundamentalista — série do pipeline CVM + conversão de caixa derivada */}
              {sheet && (
                <div className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-5 space-y-6">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="font-orbitron text-sm font-bold text-cyber-cyan uppercase tracking-wider">
                      Ficha Fundamentalista
                    </h3>
                    {sheetStamp && (
                      <span className="text-[0.65rem] text-gray-400 font-space">
                        conhecimento estimado (prazo legal) — último: {sheetStamp.knowledgeDate}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div>
                      <p className="text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-2">Retornos — ROE / ROA / ROIC (%)</p>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={sheetChart}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="periodo" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} labelStyle={{ color: "#e2e8f0" }} formatter={(v: number) => [`${Number(v).toFixed(2)}%`]} />
                          <Legend />
                          <ReferenceLine y={0} stroke="#475569" />
                          <Line type="monotone" dataKey="roe" name="ROE" stroke="#ec4899" dot={false} strokeWidth={2} connectNulls />
                          <Line type="monotone" dataKey="roa" name="ROA" stroke="#22d3ee" dot={false} strokeWidth={2} connectNulls />
                          <Line type="monotone" dataKey="roic" name="ROIC" stroke="#a855f7" dot={false} strokeWidth={2} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-2">Alavancagem — Dívida/PL & Dívida Líq./EBITDA (x)</p>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={sheetChart}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="periodo" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} labelStyle={{ color: "#e2e8f0" }} formatter={(v: number) => [`${Number(v).toFixed(2)}x`]} />
                          <Legend />
                          <ReferenceLine y={0} stroke="#475569" />
                          <Line type="monotone" dataKey="dividaPl" name="Dívida/PL" stroke="#f59e0b" dot={false} strokeWidth={2} connectNulls />
                          <Line type="monotone" dataKey="dividaLiquidaEbitda" name="Dív. Líq./EBITDA" stroke="#ec4899" dot={false} strokeWidth={2} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-2">
                        Conversão de caixa — FCO / Lucro (x) · <span className="text-cyber-cyan">derivado no WR</span>
                      </p>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={sheetChart}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="periodo" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} labelStyle={{ color: "#e2e8f0" }} formatter={(v: number) => [`${Number(v).toFixed(2)}x`]} />
                          <ReferenceLine y={1} stroke="#475569" strokeDasharray="4 4" />
                          <Line type="monotone" dataKey="conversaoCaixa" name="FCO/Lucro" stroke="#34d399" dot={false} strokeWidth={2} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-2">Payout (%)</p>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={sheetChart}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="periodo" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} labelStyle={{ color: "#e2e8f0" }} formatter={(v: number) => [`${Number(v).toFixed(1)}%`]} />
                          <ReferenceLine y={0} stroke="#475569" />
                          <Line type="monotone" dataKey="payoutRatio" name="Payout" stroke="#a855f7" dot={false} strokeWidth={2} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="border-t border-cyber-border/40 pt-3 text-[0.7rem] text-gray-400 font-space space-y-1">
                    <p>
                      <span className="text-cyber-cyan uppercase tracking-wider">Proveniência:</span>{" "}
                      indicadores da fonte <span className="text-gray-300">pipeline CVM</span> (fundamental_indicators/indicadores); conversão de caixa <span className="text-gray-300">derivada no WR</span> (FCO/Lucro). Dados ausentes aparecem como lacuna, nunca zero.
                    </p>
                    <p>{sheet.provenance.legalLagRule}</p>
                    <p className="text-gray-500">{sheet.provenance.base.note}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
