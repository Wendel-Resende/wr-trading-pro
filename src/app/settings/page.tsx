"use client";

import { useState, useEffect } from 'react';
import { Key, Server, RefreshCw, ShieldCheck, Save, Trash2, AlertTriangle } from 'lucide-react';
import { LLMProvider, LlmProviderStatus, LlmUiConfigurableProvider } from '@/types/llm';
import { llmService } from '@/services/llmService';

interface ProviderInfo {
  provider: LLMProvider;
  displayName: string;
  envVar: string;
  description: string;
}

// Providers sem configuração pela UI — status somente leitura, via .env.
const ENV_ONLY_PROVIDERS: ProviderInfo[] = [
  {
    provider: 'OLLAMA',
    displayName: 'Ollama (Local)',
    envVar: 'OLLAMA_ENDPOINT',
    description: 'Execução local (somente localhost), gratuito, requer hardware adequado.',
  },
  {
    provider: 'QWEN',
    displayName: 'Qwen (Alibaba)',
    envVar: 'QWEN_API_KEY',
    description: 'Alibaba Cloud, bom para chinês e inglês.',
  },
  {
    provider: 'GROQ',
    displayName: 'Groq',
    envVar: 'GROQ_API_KEY',
    description: 'Inferência ultra-rápida com LPU, custo competitivo.',
  },
  {
    provider: 'MANUS',
    displayName: 'Manus',
    envVar: 'MANUS_API_KEY',
    description: 'Especializado em análise de dados e trading.',
  },
];

const UI_PROVIDER_DESCRIPTIONS: Record<LlmUiConfigurableProvider, string> = {
  OPENAI: 'GPT-4 e variantes, alta qualidade, pago por uso.',
  DEEPSEEK: 'Modelo de código eficiente, custo menor que OpenAI.',
  OPENROUTER: 'Roteador de múltiplos modelos, incluindo opções gratuitas (ex.: openrouter/free).',
  ANTHROPIC: 'Claude via API nativa Messages — forte em raciocínio e seguir instruções.',
  LM_STUDIO: 'Servidor local OpenAI-compatible. API key opcional; endpoint padrão http://127.0.0.1:1234/v1.',
};

interface FormState {
  apiKey: string;
  model: string;
  endpoint: string;
  saving: boolean;
  message: string | null;
  messageIsError: boolean;
}

const EMPTY_FORM: FormState = { apiKey: '', model: '', endpoint: '', saving: false, message: null, messageIsError: false };

export default function SettingsPage() {
  const [configuredProviders, setConfiguredProviders] = useState<LLMProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [uiStatuses, setUiStatuses] = useState<LlmProviderStatus[]>([]);
  const [encryptionKeyConfigured, setEncryptionKeyConfigured] = useState(true);
  const [isLoadingUiConfig, setIsLoadingUiConfig] = useState(true);
  const [forms, setForms] = useState<Record<LlmUiConfigurableProvider, FormState>>({
    OPENAI: { ...EMPTY_FORM },
    DEEPSEEK: { ...EMPTY_FORM },
    OPENROUTER: { ...EMPTY_FORM },
    ANTHROPIC: { ...EMPTY_FORM },
    LM_STUDIO: { ...EMPTY_FORM },
  });

  const loadProviders = async () => {
    setIsLoading(true);
    const providers = await llmService.getAvailableProviders();
    setConfiguredProviders(providers);
    setIsLoading(false);
  };

  const loadUiConfig = async () => {
    setIsLoadingUiConfig(true);
    try {
      const res = await fetch('/api/llm/config');
      const data = await res.json().catch(() => null);
      if (data?.success) {
        setUiStatuses(data.data.providers ?? []);
        setEncryptionKeyConfigured(!!data.data.encryptionKeyConfigured);
      }
    } catch {
      // status indisponível — os cards mostram "não configurado" por padrão
    } finally {
      setIsLoadingUiConfig(false);
    }
  };

  const refreshAll = async () => {
    await Promise.all([loadProviders(), loadUiConfig()]);
  };

  useEffect(() => {
    // Remove segredos legados persistidos no navegador (item 7 da Fase 0):
    // versões antigas desta página salvavam API keys em localStorage.
    localStorage.removeItem('llm-provider-settings');

    refreshAll();
  }, []);

  const isConfigured = (provider: LLMProvider) => configuredProviders.includes(provider);
  const statusFor = (provider: LlmUiConfigurableProvider) => uiStatuses.find((s) => s.provider === provider);

  const updateForm = (provider: LlmUiConfigurableProvider, patch: Partial<FormState>) => {
    setForms((prev) => ({ ...prev, [provider]: { ...prev[provider], ...patch } }));
  };

  const saveProvider = async (provider: LlmUiConfigurableProvider) => {
    const form = forms[provider];
    updateForm(provider, { saving: true, message: null, messageIsError: false });

    const body: Record<string, string> = { provider, action: 'save' };
    if (form.apiKey.trim()) body.apiKey = form.apiKey.trim();
    if (form.model.trim()) body.model = form.model.trim();
    if (provider === 'LM_STUDIO' && form.endpoint.trim()) body.endpoint = form.endpoint.trim();

    try {
      const res = await fetch('/api/llm/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        updateForm(provider, {
          saving: false,
          message: data?.error || `Falha ao salvar (HTTP ${res.status}).`,
          messageIsError: true,
        });
        return;
      }

      // Nunca ecoa a chave de volta — só limpa os campos digitados e recarrega o status.
      updateForm(provider, { apiKey: '', model: '', endpoint: '', saving: false, message: 'Configuração salva.', messageIsError: false });
      await refreshAll();
    } catch (err) {
      updateForm(provider, {
        saving: false,
        message: err instanceof Error ? err.message : 'Erro ao salvar.',
        messageIsError: true,
      });
    }
  };

  const clearProvider = async (provider: LlmUiConfigurableProvider) => {
    updateForm(provider, { saving: true, message: null, messageIsError: false });
    try {
      const res = await fetch('/api/llm/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, action: 'clear' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        updateForm(provider, { saving: false, message: data?.error || 'Falha ao limpar.', messageIsError: true });
        return;
      }
      updateForm(provider, { ...EMPTY_FORM, message: 'Configuração da UI removida — voltando ao .env (se houver).' });
      await refreshAll();
    } catch (err) {
      updateForm(provider, {
        saving: false,
        message: err instanceof Error ? err.message : 'Erro ao limpar.',
        messageIsError: true,
      });
    }
  };

  return (
    <div className="min-h-screen bg-cyber-dark p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="font-orbitron text-3xl font-bold text-white mb-2">
            Configurações de IA
          </h1>
          <p className="text-gray-400 font-space">
            Provedores de LLM configuráveis pela plataforma, e status dos provedores configurados via .env
          </p>
        </div>

        {!encryptionKeyConfigured && (
          <div className="mb-6 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-gray-300 font-space">
              <strong className="text-yellow-400">WR_LLM_CONFIG_ENCRYPTION_KEY</strong> não está configurada no
              servidor (mínimo 32 caracteres) — salvar/limpar chaves pela UI está desabilitado (falha fechada).
              A configuração via <code>.env</code> continua funcionando normalmente.
            </div>
          </div>
        )}

        <div className="bg-cyber-card/50 border border-cyber-border rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Key className="w-6 h-6 text-cyber-cyan" />
              <h2 className="font-orbitron text-xl font-bold text-white">
                Provedores configuráveis pela plataforma
              </h2>
            </div>
            <button
              onClick={refreshAll}
              disabled={isLoading || isLoadingUiConfig}
              className="cyber-button cyber-button-primary px-6 py-2 flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading || isLoadingUiConfig ? 'animate-spin' : ''}`} />
              {isLoading || isLoadingUiConfig ? 'Verificando...' : 'Atualizar Status'}
            </button>
          </div>

          <div className="mb-6 p-3 bg-cyber-cyan/10 border border-cyber-cyan/30 rounded-lg flex items-start gap-2">
            <ShieldCheck className="w-5 h-5 text-cyber-cyan mt-0.5 flex-shrink-0" />
            <div className="text-sm text-gray-300 font-space">
              <p className="mb-1">
                As chaves informadas aqui são enviadas <strong className="text-cyber-cyan">uma vez</strong> ao
                servidor e persistidas cifradas (AES-256-GCM). Elas nunca são exibidas novamente, nunca vão para{' '}
                <code>localStorage</code>/cookie/URL, e nunca aparecem em respostas da API.
              </p>
              <p>
                A configuração salva aqui sobrepõe o <code>.env</code> automaticamente, sem reiniciar o servidor.
                Se preferir, configure via <code>.env</code> (ver <code>.env.example</code>) — o valor salvo pela UI
                tem prioridade quando presente.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {(['OPENAI', 'DEEPSEEK', 'OPENROUTER', 'ANTHROPIC', 'LM_STUDIO'] as LlmUiConfigurableProvider[]).map((provider) => {
              const status = statusFor(provider);
              const form = forms[provider];
              return (
                <div key={provider} className="bg-cyber-dark/50 border border-cyber-border rounded-lg p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          status?.configured
                            ? 'bg-cyber-cyan/20 border border-cyber-cyan/50'
                            : 'bg-gray-700/50 border border-gray-600'
                        }`}
                      >
                        <Server className="w-5 h-5 text-cyber-cyan" />
                      </div>
                      <div>
                        <h3 className="font-orbitron text-lg font-bold text-white">
                          {status?.displayName ?? provider}
                        </h3>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span
                            className={`text-xs font-space px-2 py-0.5 rounded ${
                              status?.configured
                                ? 'bg-green-500/20 text-green-400'
                                : 'bg-yellow-500/20 text-yellow-400'
                            }`}
                          >
                            {status?.configured ? 'Configurada' : 'Não configurada'}
                          </span>
                          {status?.configured && (
                            <span className="text-xs text-gray-500 font-space">
                              origem: {status.source === 'ui' ? 'UI (persistida)' : status.source === 'env' ? '.env' : '—'}
                            </span>
                          )}
                          {status?.model && (
                            <span className="text-xs text-gray-500 font-space">modelo: <code>{status.model}</code></span>
                          )}
                          {status?.endpoint && (
                            <span className="text-xs text-gray-500 font-space">endpoint: <code>{status.endpoint}</code></span>
                          )}
                        </div>
                        <p className="text-sm text-gray-400 font-space mt-2">
                          {UI_PROVIDER_DESCRIPTIONS[provider]}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        API key {provider === 'LM_STUDIO' ? '(opcional)' : ''}
                      </label>
                      <input
                        type="password"
                        autoComplete="off"
                        value={form.apiKey}
                        onChange={(e) => updateForm(provider, { apiKey: e.target.value })}
                        placeholder="••••••••••••"
                        disabled={!encryptionKeyConfigured || form.saving}
                        className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Modelo padrão (opcional)</label>
                      <input
                        type="text"
                        value={form.model}
                        onChange={(e) => updateForm(provider, { model: e.target.value })}
                        placeholder={provider === 'OPENROUTER' ? 'openrouter/free' : 'usa o default do servidor'}
                        disabled={!encryptionKeyConfigured || form.saving}
                        className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm disabled:opacity-50"
                      />
                    </div>
                    {provider === 'LM_STUDIO' ? (
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Endpoint (loopback apenas)</label>
                        <input
                          type="text"
                          value={form.endpoint}
                          onChange={(e) => updateForm(provider, { endpoint: e.target.value })}
                          placeholder="http://127.0.0.1:1234/v1"
                          disabled={!encryptionKeyConfigured || form.saving}
                          className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm disabled:opacity-50"
                        />
                      </div>
                    ) : (
                      <div className="hidden md:block" />
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => saveProvider(provider)}
                      disabled={!encryptionKeyConfigured || form.saving}
                      className="cyber-button cyber-button-primary px-4 py-1.5 text-sm flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" /> Salvar
                    </button>
                    <button
                      onClick={() => clearProvider(provider)}
                      disabled={!encryptionKeyConfigured || form.saving || status?.source !== 'ui'}
                      className="cyber-button px-4 py-1.5 text-sm flex items-center gap-1.5 border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Limpar
                    </button>
                    {form.message && (
                      <span className={`text-xs font-space ${form.messageIsError ? 'text-red-400' : 'text-green-400'}`}>
                        {form.message}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-cyber-card/50 border border-cyber-border rounded-lg p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Server className="w-6 h-6 text-cyber-cyan" />
            <h2 className="font-orbitron text-xl font-bold text-white">
              Outros provedores (somente .env)
            </h2>
          </div>
          <div className="space-y-4">
            {ENV_ONLY_PROVIDERS.map((provider) => (
              <div
                key={provider.provider}
                className="bg-cyber-dark/50 border border-cyber-border rounded-lg p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        isConfigured(provider.provider)
                          ? 'bg-cyber-cyan/20 border border-cyber-cyan/50'
                          : 'bg-gray-700/50 border border-gray-600'
                      }`}
                    >
                      <Server className="w-5 h-5 text-cyber-cyan" />
                    </div>
                    <div>
                      <h3 className="font-orbitron text-lg font-bold text-white">
                        {provider.displayName}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className={`text-xs font-space px-2 py-0.5 rounded ${
                            isConfigured(provider.provider)
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-yellow-500/20 text-yellow-400'
                          }`}
                        >
                          {isConfigured(provider.provider)
                            ? 'Configurado no servidor'
                            : 'Não configurado'}
                        </span>
                        <span className="text-xs text-gray-500 font-space">
                          Variável: <code>{provider.envVar}</code>
                        </span>
                      </div>
                      <p className="text-sm text-gray-400 font-space mt-2">
                        {provider.description}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-cyber-card/50 border border-cyber-border rounded-lg p-6">
          <h3 className="font-orbitron text-lg font-bold text-white mb-4">
            Como configurar
          </h3>
          <div className="space-y-3 text-sm text-gray-400 font-space">
            <p>
              1. Para os provedores no topo desta página, informe a API key (e opcionalmente modelo/endpoint) e
              clique em &quot;Salvar&quot;. A configuração entra em vigor imediatamente, sem reiniciar o servidor.
            </p>
            <p>
              2. Para os demais provedores (ou como alternativa aos campos acima), copie{' '}
              <code className="text-cyber-cyan">.env.example</code> para <code className="text-cyber-cyan">.env</code>{' '}
              na raiz do projeto e preencha as variáveis desejadas. Nunca use o prefixo{' '}
              <code className="text-cyber-cyan">NEXT_PUBLIC_</code> para segredos.
            </p>
            <p>
              3. Após editar o <code className="text-cyber-cyan">.env</code>, reinicie o servidor (
              <code className="text-cyber-cyan">npm run dev</code> ou o executável Electron) e clique em
              &quot;Atualizar Status&quot;.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
