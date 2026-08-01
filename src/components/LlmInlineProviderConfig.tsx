"use client";

/**
 * Configuração inline de provider LLM — WR Trading Pro
 *
 * Componente compartilhado embutido junto do seletor de provider/modelo em
 * AgentPanel (painel legado) e AgentRunsPanel (Runs Governados), para que o
 * usuário configure a API key sem sair da tela onde escolhe o provider.
 *
 * Consome exclusivamente /api/llm/config (GET status sanitizado / POST
 * salvar-limpar, ambos server-side e autenticados pelo middleware global).
 * A chave NUNCA é persistida em localStorage/cookie/URL — só trafega uma vez
 * no corpo do POST, sobre HTTPS/loopback, e nunca é ecoada de volta.
 *
 * Sem WR_LLM_CONFIG_ENCRYPTION_KEY configurada no servidor, a rota falha
 * fechado (503): os campos ficam desabilitados e a mensagem explica
 * exatamente o que falta — nunca finge que salvou.
 */

import { useCallback, useEffect, useState } from "react";
import { Key, Save, Trash2, ShieldAlert, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";

export type LlmUiConfigurableProvider = "OPENAI" | "DEEPSEEK" | "OPENROUTER" | "ANTHROPIC" | "LM_STUDIO";

export interface LlmProviderStatus {
  provider: LlmUiConfigurableProvider;
  displayName: string;
  configured: boolean;
  source: "ui" | "env" | "none";
  model?: string;
  endpoint?: string;
}

const UI_CONFIGURABLE_PROVIDERS = new Set<string>(["OPENAI", "DEEPSEEK", "OPENROUTER", "ANTHROPIC", "LM_STUDIO"]);

export function isLlmUiConfigurableProvider(provider: string): provider is LlmUiConfigurableProvider {
  return UI_CONFIGURABLE_PROVIDERS.has(provider);
}

interface LlmInlineProviderConfigProps {
  /** Provider atualmente selecionado no seletor do painel pai (ex.: "ANTHROPIC"). */
  provider: string;
  /**
   * Chamado após salvar/limpar com sucesso — o painel pai deve re-buscar
   * /api/llm/providers para que o catálogo/status apareça atualizado
   * imediatamente, sem reload nem logout/login.
   */
  onChanged: () => void;
  /** Incrementar este número força a expansão do formulário (ex.: após bloquear um envio). */
  forceOpenSignal?: number;
  className?: string;
}

export default function LlmInlineProviderConfig({
  provider,
  onChanged,
  forceOpenSignal,
  className,
}: LlmInlineProviderConfigProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LlmProviderStatus | null>(null);
  const [encryptionKeyConfigured, setEncryptionKeyConfigured] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const configurable = isLlmUiConfigurableProvider(provider);

  const loadStatus = useCallback(async () => {
    if (!isLlmUiConfigurableProvider(provider)) return;
    try {
      const res = await fetch("/api/llm/config");
      const data = await res.json().catch(() => null);
      if (data?.success) {
        setEncryptionKeyConfigured(!!data.data.encryptionKeyConfigured);
        const found = (data.data.providers as LlmProviderStatus[]).find((p) => p.provider === provider);
        setStatus(found ?? null);
      }
    } catch {
      // Falha silenciosa: os campos continuam utilizáveis (o POST revalida
      // tudo server-side); só o badge de status fica indisponível.
    }
  }, [provider]);

  // Troca de provider: reseta o formulário (nunca reaproveita rascunho de
  // outro provider) e recarrega o status.
  useEffect(() => {
    setApiKey("");
    setModel("");
    setEndpoint("");
    setMessage(null);
    if (configurable) void loadStatus();
  }, [provider, configurable, loadStatus]);

  useEffect(() => {
    if (forceOpenSignal !== undefined && forceOpenSignal > 0 && configurable) setOpen(true);
  }, [forceOpenSignal, configurable]);

  if (!configurable) return null; // OLLAMA/QWEN/GROQ/MANUS: sem UI de config (endpoint/env apenas)

  const save = async () => {
    if (!apiKey.trim() && !model.trim() && !(provider === "LM_STUDIO" && endpoint.trim())) {
      setMessage({ text: "Preencha ao menos um campo (chave, modelo ou endpoint) antes de salvar.", isError: true });
      return;
    }
    setSaving(true);
    setMessage(null);
    const body: Record<string, string> = { provider, action: "save" };
    if (apiKey.trim()) body.apiKey = apiKey.trim();
    if (model.trim()) body.model = model.trim();
    if (provider === "LM_STUDIO" && endpoint.trim()) body.endpoint = endpoint.trim();

    try {
      const res = await fetch("/api/llm/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setMessage({ text: data?.error || `Falha ao salvar (HTTP ${res.status}).`, isError: true });
        return;
      }
      // Nunca ecoa a chave de volta — só limpa os campos digitados.
      setApiKey("");
      setModel("");
      setEndpoint("");
      setMessage({ text: "Configuração salva — já em vigor, sem precisar reiniciar ou logar novamente.", isError: false });
      await loadStatus();
      onChanged();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Erro ao salvar.", isError: true });
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/llm/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, action: "clear" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setMessage({ text: data?.error || "Falha ao limpar.", isError: true });
        return;
      }
      setMessage({ text: "Configuração da UI removida — volta a usar o .env do servidor (se houver).", isError: false });
      await loadStatus();
      onChanged();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Erro ao limpar.", isError: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 text-[0.7rem] font-space px-2 py-1 rounded border transition-colors ${
          status?.configured
            ? "text-green-400 border-green-500/40 hover:bg-green-500/10"
            : "text-yellow-400 border-yellow-500/40 hover:bg-yellow-500/10"
        }`}
      >
        {status?.configured ? <CheckCircle2 className="w-3 h-3" /> : <Key className="w-3 h-3" />}
        {status?.configured
          ? `Configurado (${status.source === "ui" ? "UI" : ".env"})`
          : "Não configurado — configurar chave"}
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {open && (
        <div className="mt-2 p-3 rounded-lg border border-gray-700 bg-gray-800/70 space-y-2 max-w-md">
          {!encryptionKeyConfigured && (
            <div className="flex items-start gap-2 text-[0.7rem] text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 rounded p-2">
              <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                O servidor não tem <code>WR_LLM_CONFIG_ENCRYPTION_KEY</code> configurada (mínimo 32
                caracteres) — salvar/limpar chaves por aqui está desabilitado (falha fechada, nunca finge
                que salvou). Gere um valor com{" "}
                <code>node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;hex&apos;))&quot;</code>,
                adicione <code>WR_LLM_CONFIG_ENCRYPTION_KEY=&quot;...&quot;</code> ao <code>.env</code> do
                servidor e reinicie-o. Até lá, o provider pode ser configurado via variável de ambiente
                própria dele no <code>.env</code>.
              </span>
            </div>
          )}

          <div>
            <label className="block text-[0.65rem] text-gray-400 mb-1">
              API key {provider === "LM_STUDIO" ? "(opcional)" : ""}
            </label>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="••••••••••••"
              disabled={!encryptionKeyConfigured || saving}
              className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-[0.65rem] text-gray-400 mb-1">Modelo padrão (opcional)</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={status?.model ?? "usa o default do servidor"}
              disabled={!encryptionKeyConfigured || saving}
              className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white disabled:opacity-50"
            />
          </div>

          {provider === "LM_STUDIO" && (
            <div>
              <label className="block text-[0.65rem] text-gray-400 mb-1">Endpoint (loopback apenas)</label>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder={status?.endpoint ?? "http://127.0.0.1:1234/v1"}
                disabled={!encryptionKeyConfigured || saving}
                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white disabled:opacity-50"
              />
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={!encryptionKeyConfigured || saving}
              className="flex items-center gap-1 text-xs bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded px-3 py-1.5"
            >
              <Save className="w-3 h-3" /> Salvar
            </button>
            <button
              type="button"
              onClick={clear}
              disabled={!encryptionKeyConfigured || saving || status?.source !== "ui"}
              className="flex items-center gap-1 text-xs border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed rounded px-3 py-1.5"
            >
              <Trash2 className="w-3 h-3" /> Limpar
            </button>
          </div>

          {message && (
            <p className={`text-[0.7rem] ${message.isError ? "text-red-400" : "text-green-400"}`}>{message.text}</p>
          )}
        </div>
      )}
    </div>
  );
}
