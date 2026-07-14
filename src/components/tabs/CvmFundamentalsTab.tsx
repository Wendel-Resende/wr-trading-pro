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

interface CompanyDetail {
  company: Company;
  quarters: Quarter[];
  provenance: { source: string; pointInTime: boolean; note: string };
}

const fmtBRL = (v: number | null): string => {
  if (v === null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `R$ ${(v / 1e9).toFixed(2)} bi`;
  if (abs >= 1e6) return `R$ ${(v / 1e6).toFixed(1)} mi`;
  if (abs >= 1e3) return `R$ ${(v / 1e3).toFixed(0)} mil`;
  return `R$ ${v.toFixed(0)}`;
};

const fmtPct = (v: number | null): string => (v === null ? "—" : `${v.toFixed(2)}%`);

export default function CvmFundamentalsTab() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
