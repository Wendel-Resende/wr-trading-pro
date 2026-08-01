"use client";

/**
 * Runs Governados — UI do runtime AgentRun v1 (Fase 3 do upgrade).
 *
 * Consome /api/v1/agent-runs: criação (202 + runId), processamento via
 * /advance, acompanhamento com ciclo de vida completo, DAG semântico,
 * orçamento (steps/custo/timeout) e cancelamento. Suporta dois templates:
 * - SIMPLES: 1 agente (analista-pesquisa ou analista-proposta)
 * - COMITE: 5 nós AGENT em debate (3 analistas paralelos + cético + síntese do gestor)
 *
 * Os nós AGENT/SYNTHESIS usam o LLM do servidor via proxy (Ollama/OpenAI/etc.);
 * sem provedor disponível, cai para modo simulado. O banner deixa isso explícito.
 */

import { useCallback, useEffect, useState } from "react";
import { Play, RefreshCw, XCircle, AlertTriangle, GitBranch } from "lucide-react";
import LlmInlineProviderConfig from "./LlmInlineProviderConfig";

type RunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
type NodeType = "INPUT" | "AGENT" | "EVIDENCE" | "SYNTHESIS" | "OUTPUT";

interface AgentRun {
  runId: string;
  requestedBy: string;
  kind: "RESEARCH" | "PROPOSAL";
  status: RunStatus;
  dag: { nodes: { id: string; type: NodeType; role?: string }[]; edges: [string, string][] };
  input: Record<string, unknown>;
  budget: { maxSteps?: number; maxCost?: number; timeoutMs?: number };
  output: Record<string, unknown> | null;
  error: { code?: string; message?: string } | null;
  nodeStates: Record<
    string,
    {
      status: "PENDING" | "DONE" | "FAILED";
      output?: Record<string, unknown> & {
        _llm?: { simulated: boolean; provider?: string; model?: string; totalTokens?: number; reason?: string };
      };
    }
  >;
  stepsUsed: number;
  costUsed: number;
  createdAt: string;
  finishedAt: string | null;
}

const STATUS_STYLE: Record<RunStatus, string> = {
  QUEUED: "text-yellow-400 border-yellow-500/40 bg-yellow-500/10",
  RUNNING: "text-cyan-400 border-cyan-500/40 bg-cyan-500/10",
  SUCCEEDED: "text-green-400 border-green-500/40 bg-green-500/10",
  FAILED: "text-red-400 border-red-500/40 bg-red-500/10",
  CANCELLED: "text-gray-400 border-gray-500/40 bg-gray-500/10",
};

const NODE_STATE_STYLE: Record<string, string> = {
  DONE: "text-green-400 border-green-500/40",
  FAILED: "text-red-400 border-red-500/40",
  PENDING: "text-gray-400 border-gray-500/40",
};

/** DAG de demonstração: INPUT → AGENT → EVIDENCE → SYNTHESIS → OUTPUT. */
function buildDefaultDag(role: string) {
  return {
    nodes: [
      { id: "in", type: "INPUT" as const },
      { id: "agent", type: "AGENT" as const, role },
      { id: "evidence", type: "EVIDENCE" as const },
      { id: "synthesis", type: "SYNTHESIS" as const },
      { id: "out", type: "OUTPUT" as const },
    ],
    edges: [
      ["in", "agent"],
      ["agent", "evidence"],
      ["evidence", "synthesis"],
      ["synthesis", "out"],
    ] as [string, string][],
  };
}

/** DAG do Comitê (spec 2026-07-15): 3 analistas em paralelo → cético rebate → gestor sintetiza. */
function buildCommitteeDag() {
  return {
    nodes: [
      { id: "in", type: "INPUT" as const },
      { id: "fund", type: "AGENT" as const, role: "fundamentalista-cvm", provides: ["parecer"] },
      { id: "divs", type: "AGENT" as const, role: "dividendos", provides: ["parecer"] },
      { id: "risco", type: "AGENT" as const, role: "risco", provides: ["parecer"] },
      {
        id: "cetico",
        type: "AGENT" as const,
        role: "cetico",
        reads: ["fund.parecer", "divs.parecer", "risco.parecer"],
        provides: ["parecer"],
      },
      {
        id: "evidence",
        type: "EVIDENCE" as const,
        reads: ["fund.parecer", "divs.parecer", "risco.parecer", "cetico.parecer"],
      },
      { id: "synthesis", type: "SYNTHESIS" as const, role: "gestor", provides: ["finding"] },
      { id: "out", type: "OUTPUT" as const, reads: ["synthesis.finding"] },
    ],
    edges: [
      ["in", "fund"],
      ["in", "divs"],
      ["in", "risco"],
      ["fund", "cetico"],
      ["divs", "cetico"],
      ["risco", "cetico"],
      ["cetico", "evidence"],
      ["evidence", "synthesis"],
      ["synthesis", "out"],
    ] as [string, string][],
  };
}

const COMMITTEE_TITLES: Record<string, string> = {
  "fundamentalista-cvm": "Fundamentalista CVM",
  dividendos: "Dividendos",
  risco: "Risco",
  cetico: "Cético (contraditor)",
  gestor: "Gestor (síntese)",
};

const TICKER_INPUT_RE = /^[A-Za-z]{4}\d{1,2}$/;

interface LlmProviders {
  providers: string[];
  providerConfigured: Record<string, boolean>;
  ollama: { models: string[]; defaultModel: string };
  lmStudio: { models: string[]; defaultModel: string | null };
  modelDefaults: Record<string, string | null>;
}

export default function AgentRunsPanel() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selected, setSelected] = useState<AgentRun | null>(null);
  const [kind, setKind] = useState<"RESEARCH" | "PROPOSAL">("RESEARCH");
  const [question, setQuestion] = useState("");
  const [maxSteps, setMaxSteps] = useState(100);
  const [llmInfo, setLlmInfo] = useState<LlmProviders | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [template, setTemplate] = useState<"SIMPLES" | "COMITE">("SIMPLES");
  const [ticker, setTicker] = useState("");
  // Incrementado para forçar a expansão do formulário inline de configuração
  // (ex.: quando o envio é bloqueado por provider não configurado).
  const [configOpenSignal, setConfigOpenSignal] = useState(0);

  const refreshLlmInfo = useCallback(async () => {
    try {
      const r = await fetch("/api/llm/providers");
      if (!r.ok) return;
      const data = await r.json();
      if (data?.providers) setLlmInfo(data);
    } catch {
      // catálogo indisponível — seletor mantém a última lista conhecida
    }
  }, []);

  useEffect(() => {
    void refreshLlmInfo();
  }, [refreshLlmInfo]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/agent-runs?limit=25");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.json();
      const list: AgentRun[] = body.data ?? body;
      setRuns(list);
      setSelected((prev) => (prev ? list.find((x) => x.runId === prev.runId) ?? prev : prev));
    } catch {
      setError("Não foi possível listar os runs.");
    }
  }, []);

  useEffect(() => {
    // Reaper primeiro: runs RUNNING órfãos de um processo morto viram FAILED
    // (ORPHANED_RUN) antes da listagem — sem isso ficariam "rodando" para
    // sempre na tela. Falha do reaper não bloqueia a listagem.
    fetch("/api/v1/agent-runs/reap", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        refresh();
      });
  }, [refresh]);

  // Enquanto houver run QUEUED/RUNNING, atualiza a cada 3s
  useEffect(() => {
    const active = runs.some((r) => r.status === "QUEUED" || r.status === "RUNNING");
    if (!active) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [runs, refresh]);

  const submit = async () => {
    if (template === "COMITE" && !TICKER_INPUT_RE.test(ticker.trim())) {
      setError("O comitê delibera sobre 1 ativo: informe um ticker B3 válido (ex.: WEGE3).");
      return;
    }
    if (provider && llmInfo?.providerConfigured?.[provider] === false) {
      setError('Este provider ainda não está configurado. Configure a chave em "Configurar" abaixo do seletor de provedor — o run não é enviado sem isso, e nenhum outro provider é usado no seu lugar.');
      setConfigOpenSignal((n) => n + 1);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const create = await fetch("/api/v1/agent-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          dag:
            template === "COMITE"
              ? buildCommitteeDag()
              : buildDefaultDag(kind === "RESEARCH" ? "analista-pesquisa" : "analista-proposta"),
          input: {
            question: question.trim() || "(sem pergunta)",
            ...(template === "COMITE" ? { ticker: ticker.trim().toUpperCase() } : {}),
            ...(provider ? { llmProvider: provider } : {}),
            ...(model ? { llmModel: model } : {}),
          },
          // Comitê: ~5 chamadas LLM — teto de tokens explícito (spec) e o
          // mesmo timeout de 5 min (Ollama local pode levar minutos por chamada).
          budget:
            template === "COMITE"
              ? { maxSteps, maxCost: 30_000, timeoutMs: 300_000 }
              : { maxSteps, timeoutMs: 300_000 },
          // Margem de 60s: o servidor fixa knowledgeTime = now() e rejeita
          // knowledgeTime > decisionTime — clock do browser + latência não
          // podem ficar atrás do relógio do servidor.
          decisionTime: new Date(Date.now() + 60_000).toISOString(),
        }),
      });
      const created = await create.json();
      if (!create.ok) {
        setError(created?.error?.message ?? created?.error ?? "Falha ao criar o run.");
        return;
      }
      const runId: string = created.data?.runId ?? created.runId;
      // Processa imediatamente (runtime síncrono determinístico)
      await fetch(`/api/v1/agent-runs/${runId}/advance`, { method: "POST" });
      await refresh();
    } catch {
      setError("Falha ao criar/processar o run.");
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (runId: string) => {
    try {
      await fetch(`/api/v1/agent-runs/${runId}/cancel`, { method: "POST" });
      await refresh();
    } catch {
      setError("Falha ao cancelar.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-cyber-cyan/10 border border-cyber-cyan/30 rounded-lg px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-cyber-cyan flex-shrink-0 mt-0.5" />
        <p className="text-cyber-cyan text-sm font-space">
          Runtime governado: os nós AGENT/SYNTHESIS usam o <span className="font-bold">LLM do
          servidor</span> (Ollama/OpenAI/etc., com fallback) e o custo do orçamento é em tokens.
          Sem provedor disponível, a execução cai para o modo simulado — sempre marcado como tal
          no detalhe de cada nó. Propostas nunca geram ordens, por construção. Escolha o provedor
          abaixo e use &quot;Configurar&quot; para informar a chave sem sair desta tela — a visão
          geral de todos os provedores continua em{" "}
          <a href="/settings" className="underline hover:text-white">Configurações de IA</a>.
        </p>
      </div>

      {/* Criar run */}
      <div className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-5">
        <h3 className="font-orbitron text-sm font-bold text-cyber-cyan uppercase tracking-wider mb-4 flex items-center gap-2">
          <GitBranch className="w-4 h-4" /> Novo Run
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-1">
              Template
            </label>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value as "SIMPLES" | "COMITE")}
              className="bg-cyber-dark/50 border border-cyber-border rounded-lg px-3 py-2 text-sm text-white font-space outline-none focus:border-cyber-pink"
            >
              <option value="SIMPLES">Simples (1 agente)</option>
              <option value="COMITE">Comitê (4 papéis + gestor)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-1">
              Tipo
            </label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "RESEARCH" | "PROPOSAL")}
              className="bg-cyber-dark/50 border border-cyber-border rounded-lg px-3 py-2 text-sm text-white font-space outline-none focus:border-cyber-pink"
            >
              <option value="RESEARCH">RESEARCH (pesquisa)</option>
              <option value="PROPOSAL">PROPOSAL (proposta, sem execução)</option>
            </select>
          </div>
          <div className="flex-1 min-w-[16rem]">
            <label className="block text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-1">
              Pergunta / contexto
            </label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ex.: avaliar tendência de PETR4 no curto prazo"
              className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-3 py-2 text-sm text-white font-space outline-none focus:border-cyber-pink"
            />
          </div>
          {template === "COMITE" && (
            <div>
              <label className="block text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-1">
                Ticker (obrigatório)
              </label>
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="WEGE3"
                maxLength={6}
                className="w-28 bg-cyber-dark/50 border border-cyber-border rounded-lg px-3 py-2 text-sm text-white font-space outline-none focus:border-cyber-pink"
              />
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-1">
              Provedor
            </label>
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setModel("");
              }}
              className="bg-cyber-dark/50 border border-cyber-border rounded-lg px-3 py-2 text-sm text-white font-space outline-none focus:border-cyber-pink"
            >
              <option value="">Auto (fallback)</option>
              {(llmInfo?.providers ?? []).map((p) => (
                <option key={p} value={p}>
                  {p}{llmInfo?.providerConfigured?.[p] === false ? " (não configurado)" : ""}
                </option>
              ))}
            </select>
            {provider && (
              <LlmInlineProviderConfig
                provider={provider}
                onChanged={refreshLlmInfo}
                forceOpenSignal={configOpenSignal}
                className="mt-1"
              />
            )}
          </div>
          {provider && (
            <div>
              <label className="block text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-1">
                Modelo
              </label>
              {provider === "OLLAMA" || provider === "LM_STUDIO" ? (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="bg-cyber-dark/50 border border-cyber-border rounded-lg px-3 py-2 text-sm text-white font-space outline-none focus:border-cyber-pink"
                >
                  <option value="">
                    {(provider === "OLLAMA" ? llmInfo?.ollama.defaultModel : llmInfo?.lmStudio.defaultModel) ?? "padrão do servidor"}
                    {" (padrão)"}
                  </option>
                  {(provider === "OLLAMA" ? llmInfo?.ollama.models : llmInfo?.lmStudio.models)?.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={llmInfo?.modelDefaults?.[provider] ?? "modelo padrão do servidor"}
                  className="w-52 bg-cyber-dark/50 border border-cyber-border rounded-lg px-3 py-2 text-sm text-white font-space outline-none focus:border-cyber-pink"
                />
              )}
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-1">
              Max steps
            </label>
            <input
              type="number"
              min={1}
              max={10000}
              value={maxSteps}
              onChange={(e) => setMaxSteps(Number(e.target.value) || 100)}
              className="w-24 bg-cyber-dark/50 border border-cyber-border rounded-lg px-3 py-2 text-sm text-white font-space outline-none focus:border-cyber-pink"
            />
          </div>
          <button
            onClick={submit}
            disabled={submitting}
            className="cyber-button cyber-button-primary flex items-center gap-2 px-4 py-2"
          >
            <Play className="w-4 h-4" />
            {submitting ? "Criando..." : "Criar e Processar"}
          </button>
        </div>
        {error && (
          <p className="mt-3 text-sm text-red-400 font-space bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Lista */}
        <div className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-orbitron text-sm font-bold text-cyber-cyan uppercase tracking-wider">
              Runs ({runs.length})
            </h3>
            <button
              onClick={refresh}
              className="text-gray-400 hover:text-white transition-colors"
              title="Atualizar"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-2 overflow-y-auto max-h-[28rem] pr-1">
            {runs.length === 0 && (
              <p className="text-gray-400 text-sm font-space">
                Nenhum run ainda — crie o primeiro acima.
              </p>
            )}
            {runs.map((r) => (
              <button
                key={r.runId}
                onClick={() => setSelected(r)}
                className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                  selected?.runId === r.runId
                    ? "bg-cyber-pink/10 border-cyber-pink/50"
                    : "border-cyber-border hover:bg-cyber-dark"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-space text-sm text-white truncate">
                    {r.kind} · {String((r.input as Record<string, unknown>).question ?? r.runId)}
                  </span>
                  <span
                    className={`text-[0.65rem] font-space px-2 py-0.5 rounded-full border flex-shrink-0 ${STATUS_STYLE[r.status]}`}
                  >
                    {r.status}
                  </span>
                </div>
                <p className="text-xs text-gray-500 font-space mt-0.5">
                  {new Date(r.createdAt).toLocaleString("pt-BR")} · steps {r.stepsUsed} · custo{" "}
                  {r.costUsed}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Detalhe */}
        <div className="cyber-card bg-cyber-dark/80 border border-cyber-border rounded-xl p-5">
          <h3 className="font-orbitron text-sm font-bold text-cyber-cyan uppercase tracking-wider mb-4">
            Detalhe
          </h3>
          {!selected && (
            <p className="text-gray-400 text-sm font-space">Selecione um run na lista.</p>
          )}
          {selected && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`text-xs font-space px-2 py-0.5 rounded-full border ${STATUS_STYLE[selected.status]}`}
                >
                  {selected.status}
                </span>
                <span className="text-xs text-gray-400 font-space">{selected.kind}</span>
                <span className="text-xs text-gray-500 font-space truncate">{selected.runId}</span>
                {selected.status === "QUEUED" && (
                  <button
                    onClick={() => cancel(selected.runId)}
                    className="ml-auto flex items-center gap-1 text-xs text-red-400 hover:text-red-300 font-space"
                  >
                    <XCircle className="w-4 h-4" /> Cancelar
                  </button>
                )}
              </div>

              <div>
                <p className="text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-2">
                  DAG ({selected.dag.nodes.length} nós)
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {selected.dag.nodes.map((n, i) => {
                    const nodeState = selected.nodeStates[n.id];
                    const state = nodeState?.status ?? "PENDING";
                    const llm = nodeState?.output?._llm;
                    const llmTag = llm ? (llm.simulated ? "SIM" : llm.provider ?? "LLM") : null;
                    return (
                      <span key={n.id} className="flex items-center gap-1.5">
                        {i > 0 && <span className="text-gray-600">→</span>}
                        <span
                          className={`text-[0.65rem] font-space px-2 py-1 rounded border ${NODE_STATE_STYLE[state]}`}
                          title={`${n.type}${n.role ? ` (${n.role})` : ""} — ${state}${
                            llm
                              ? llm.simulated
                                ? ` · simulado (${llm.reason ?? "sem LLM"})`
                                : ` · ${llm.provider}/${llm.model} · ${llm.totalTokens ?? "?"} tokens`
                              : ""
                          }`}
                        >
                          {n.type}
                          {n.role ? `:${n.role}` : ""}
                          {llmTag && (
                            <span className={llm && !llm.simulated ? "text-cyber-cyan" : "text-yellow-400"}>
                              {" "}
                              [{llmTag}]
                            </span>
                          )}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="border border-cyber-border rounded-lg p-2">
                  <p className="text-[0.6rem] text-gray-400 font-orbitron uppercase">Steps</p>
                  <p className="text-sm text-white font-space">
                    {selected.stepsUsed}
                    {selected.budget.maxSteps ? ` / ${selected.budget.maxSteps}` : ""}
                  </p>
                </div>
                <div className="border border-cyber-border rounded-lg p-2">
                  <p className="text-[0.6rem] text-gray-400 font-orbitron uppercase">Custo</p>
                  <p className="text-sm text-white font-space">{selected.costUsed}</p>
                </div>
                <div className="border border-cyber-border rounded-lg p-2">
                  <p className="text-[0.6rem] text-gray-400 font-orbitron uppercase">Fim</p>
                  <p className="text-sm text-white font-space">
                    {selected.finishedAt
                      ? new Date(selected.finishedAt).toLocaleTimeString("pt-BR")
                      : "—"}
                  </p>
                </div>
              </div>

              {selected.error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <p className="text-xs text-red-400 font-space">
                    {selected.error.code ?? "ERRO"}: {selected.error.message ?? "sem detalhe"}
                  </p>
                </div>
              )}

              {selected.dag.nodes.some((n) => n.role && COMMITTEE_TITLES[n.role]) && (
                <div>
                  <p className="text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-2">
                    Pareceres do Comitê
                  </p>
                  <div className="space-y-2">
                    {selected.dag.nodes
                      .filter((n) => n.type === "AGENT" && n.role && COMMITTEE_TITLES[n.role])
                      .map((n) => {
                        const state = selected.nodeStates[n.id];
                        const parecer = state?.output?.parecer;
                        const llm = state?.output?._llm;
                        const isCetico = n.role === "cetico";
                        return (
                          <div
                            key={n.id}
                            className={`border rounded-lg p-3 ${
                              isCetico ? "border-cyber-pink/40 bg-cyber-pink/5" : "border-cyber-border bg-cyber-dark/40"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <p className={`text-xs font-orbitron uppercase tracking-wider ${isCetico ? "text-cyber-pink" : "text-cyber-cyan"}`}>
                                {COMMITTEE_TITLES[n.role!]}
                              </p>
                              <p className="text-[0.6rem] text-gray-500 font-space">
                                {llm
                                  ? llm.simulated
                                    ? `simulado (${llm.reason ?? "sem LLM"})`
                                    : `${llm.provider}/${llm.model} · ${llm.totalTokens ?? "?"} tokens`
                                  : "pendente"}
                              </p>
                            </div>
                            <p className="text-xs text-gray-300 font-space whitespace-pre-wrap max-h-40 overflow-y-auto">
                              {typeof parecer === "string" ? parecer : "—"}
                            </p>
                          </div>
                        );
                      })}
                    {selected.output && (
                      <div className="border border-green-500/40 bg-green-500/5 rounded-lg p-3">
                        <p className="text-xs font-orbitron uppercase tracking-wider text-green-400 mb-1">
                          {COMMITTEE_TITLES.gestor}
                        </p>
                        <p className="text-xs text-gray-300 font-space whitespace-pre-wrap max-h-40 overflow-y-auto">
                          {String(
                            (selected.output as Record<string, unknown>).thesis ??
                              (selected.output as Record<string, unknown>).rationale ??
                              "—",
                          )}
                        </p>
                        {Array.isArray((selected.output as Record<string, unknown>).risks) && (
                          <p className="text-[0.65rem] text-yellow-400/80 font-space mt-1">
                            Riscos: {((selected.output as Record<string, unknown>).risks as string[]).join(" · ")}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selected.output && (
                <div>
                  <p className="text-xs text-gray-400 font-orbitron uppercase tracking-wider mb-2">
                    Output
                  </p>
                  <pre className="text-xs text-gray-300 font-mono bg-cyber-dark/60 border border-cyber-border rounded-lg p-3 overflow-x-auto max-h-48">
                    {JSON.stringify(selected.output, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
