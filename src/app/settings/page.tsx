"use client";

import { useState, useEffect } from 'react';
import { Save, Key, Server, Check, X, RefreshCw } from 'lucide-react';
import { LLMProvider, LLMProviderConfig } from '@/types/llm';

interface ProviderSettings {
  provider: LLMProvider;
  displayName: string;
  apiKey: string;
  endpoint?: string;
  model?: string;
  isActive: boolean;
  priority: number;
  requiresApiKey: boolean;
  requiresEndpoint: boolean;
  defaultModel: string;
}

export default function SettingsPage() {
  const [providers, setProviders] = useState<ProviderSettings[]>([
    {
      provider: 'OPENAI',
      displayName: 'OpenAI',
      apiKey: '',
      model: 'gpt-4-turbo-preview',
      isActive: true,
      priority: 1,
      requiresApiKey: true,
      requiresEndpoint: false,
      defaultModel: 'gpt-4-turbo-preview',
    },
    {
      provider: 'DEEPSEEK',
      displayName: 'Deepseek',
      apiKey: '',
      model: 'deepseek-chat',
      isActive: false,
      priority: 2,
      requiresApiKey: true,
      requiresEndpoint: false,
      defaultModel: 'deepseek-chat',
    },
    {
      provider: 'OLLAMA',
      displayName: 'Ollama (Local)',
      apiKey: '',
      endpoint: 'http://localhost:11434',
      model: 'llama2',
      isActive: false,
      priority: 3,
      requiresApiKey: false,
      requiresEndpoint: true,
      defaultModel: 'llama2',
    },
    {
      provider: 'QWEN',
      displayName: 'Qwen (Alibaba)',
      apiKey: '',
      model: 'qwen-turbo',
      isActive: false,
      priority: 4,
      requiresApiKey: true,
      requiresEndpoint: false,
      defaultModel: 'qwen-turbo',
    },
    {
      provider: 'GROQ',
      displayName: 'Groq',
      apiKey: '',
      model: 'llama-3.3-70b-versatile',
      isActive: false,
      priority: 5,
      requiresApiKey: true,
      requiresEndpoint: false,
      defaultModel: 'llama-3.3-70b-versatile',
    },
    {
      provider: 'MANUS',
      displayName: 'Manus',
      apiKey: '',
      model: 'manus-1',
      isActive: false,
      priority: 6,
      requiresApiKey: true,
      requiresEndpoint: false,
      defaultModel: 'manus-1',
    },
  ]);

  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    // Load settings from localStorage (only on client side)
    if (typeof window === 'undefined') {
      return;
    }
    
    const savedSettings = localStorage.getItem('llm-provider-settings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setProviders(parsed);
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    }
  }, []);

  const handleProviderChange = (provider: LLMProvider, field: keyof ProviderSettings, value: any) => {
    setProviders(prev =>
      prev.map(p =>
        p.provider === provider ? { ...p, [field]: value } : p
      )
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus('idle');

    try {
      // Save to localStorage
      localStorage.setItem('llm-provider-settings', JSON.stringify(providers));
      
      // Update environment variables (in a real app, this would be done via API)
      const envVars: Record<string, string> = {};
      providers.forEach(p => {
        if (p.requiresApiKey && p.apiKey) {
          envVars[`NEXT_PUBLIC_${p.provider}_API_KEY`] = p.apiKey;
        }
        if (p.requiresEndpoint && p.endpoint) {
          envVars[`NEXT_PUBLIC_${p.provider}_ENDPOINT`] = p.endpoint;
        }
      });

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (error) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async (provider: LLMProvider) => {
    const p = providers.find(p => p.provider === provider);
    if (!p) return;

    // In a real app, this would test the actual connection
    alert(`Testando conexão com ${p.displayName}...`);
  };

  const isProviderConfigured = (provider: ProviderSettings): boolean => {
    if (provider.requiresApiKey && !provider.apiKey) return false;
    if (provider.requiresEndpoint && !provider.endpoint) return false;
    return true;
  };

  return (
    <div className="min-h-screen bg-cyber-dark p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="font-orbitron text-3xl font-bold text-white mb-2">
            Configurações de IA
          </h1>
          <p className="text-gray-400 font-space">
            Configure os provedores de LLM para o assistente de trading
          </p>
        </div>

        <div className="bg-cyber-card/50 border border-cyber-border rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Key className="w-6 h-6 text-cyber-cyan" />
              <h2 className="font-orbitron text-xl font-bold text-white">
                Provedores de LLM
              </h2>
            </div>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="cyber-button cyber-button-primary px-6 py-2 flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Salvar Configurações
                </>
              )}
            </button>
          </div>

          {saveStatus === 'success' && (
            <div className="mb-4 p-3 bg-green-500/20 border border-green-500/50 rounded-lg flex items-center gap-2">
              <Check className="w-5 h-5 text-green-500" />
              <span className="text-green-400 font-space text-sm">
                Configurações salvas com sucesso!
              </span>
            </div>
          )}

          {saveStatus === 'error' && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg flex items-center gap-2">
              <X className="w-5 h-5 text-red-500" />
              <span className="text-red-400 font-space text-sm">
                Erro ao salvar configurações. Tente novamente.
              </span>
            </div>
          )}

          <div className="space-y-4">
            {providers.map((provider) => (
              <div
                key={provider.provider}
                className="bg-cyber-dark/50 border border-cyber-border rounded-lg p-4"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        isProviderConfigured(provider)
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
                            isProviderConfigured(provider)
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-yellow-500/20 text-yellow-400'
                          }`}
                        >
                          {isProviderConfigured(provider) ? 'Configurado' : 'Não configurado'}
                        </span>
                        <span className="text-xs text-gray-500 font-space">
                          Prioridade: {provider.priority}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={provider.isActive}
                        onChange={(e) =>
                          handleProviderChange(provider.provider, 'isActive', e.target.checked)
                        }
                        className="w-4 h-4 rounded border-cyber-border bg-cyber-dark text-cyber-cyan focus:ring-cyber-cyan"
                      />
                      <span className="text-sm text-gray-300 font-space">Ativo</span>
                    </label>
                    <button
                      onClick={() => handleTestConnection(provider.provider)}
                      disabled={!isProviderConfigured(provider)}
                      className="px-3 py-1.5 text-xs font-space text-cyber-cyan border border-cyber-cyan/30 rounded hover:bg-cyber-cyan/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Testar Conexão
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {provider.requiresApiKey && (
                    <div>
                      <label className="block text-sm font-space text-gray-400 mb-2">
                        API Key
                      </label>
                      <input
                        type="password"
                        value={provider.apiKey}
                        onChange={(e) =>
                          handleProviderChange(provider.provider, 'apiKey', e.target.value)
                        }
                        placeholder="Digite sua API key"
                        className="cyber-input w-full"
                      />
                    </div>
                  )}

                  {provider.requiresEndpoint && (
                    <div>
                      <label className="block text-sm font-space text-gray-400 mb-2">
                        Endpoint
                      </label>
                      <input
                        type="text"
                        value={provider.endpoint}
                        onChange={(e) =>
                          handleProviderChange(provider.provider, 'endpoint', e.target.value)
                        }
                        placeholder="http://localhost:11434"
                        className="cyber-input w-full"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-space text-gray-400 mb-2">
                      Modelo
                    </label>
                    <input
                      type="text"
                      value={provider.model}
                      onChange={(e) =>
                        handleProviderChange(provider.provider, 'model', e.target.value)
                      }
                      placeholder={provider.defaultModel}
                      className="cyber-input w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-space text-gray-400 mb-2">
                      Prioridade de Fallback
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={provider.priority}
                      onChange={(e) =>
                        handleProviderChange(provider.provider, 'priority', parseInt(e.target.value))
                      }
                      className="cyber-input w-full"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-cyber-card/50 border border-cyber-border rounded-lg p-6">
          <h3 className="font-orbitron text-lg font-bold text-white mb-4">
            Informações sobre Provedores
          </h3>
          <div className="space-y-3 text-sm text-gray-400 font-space">
            <p>
              <strong className="text-cyber-cyan">OpenAI:</strong> GPT-4 e GPT-3.5, alta qualidade, pago por uso.
            </p>
            <p>
              <strong className="text-cyber-cyan">Deepseek:</strong> Modelo de código eficiente, custo menor que OpenAI.
            </p>
            <p>
              <strong className="text-cyber-cyan">Ollama:</strong> Execução local, gratuito, requer hardware adequado.
            </p>
            <p>
              <strong className="text-cyber-cyan">Qwen:</strong> Alibaba Cloud, bom para chinês e inglês.
            </p>
            <p>
              <strong className="text-cyber-cyan">Groq:</strong> Inferência ultra-rápida com LPU, custo competitivo.
            </p>
            <p>
              <strong className="text-cyber-cyan">Manus:</strong> Especializado em análise de dados e trading.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
