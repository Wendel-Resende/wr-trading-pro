"use client";

import { useState, useEffect } from 'react';
import { Key, Server, RefreshCw, ShieldCheck } from 'lucide-react';
import { LLMProvider } from '@/types/llm';
import { llmService } from '@/services/llmService';

interface ProviderInfo {
  provider: LLMProvider;
  displayName: string;
  envVar: string;
  description: string;
}

const PROVIDERS: ProviderInfo[] = [
  {
    provider: 'OPENAI',
    displayName: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    description: 'GPT-4 e GPT-3.5, alta qualidade, pago por uso.',
  },
  {
    provider: 'DEEPSEEK',
    displayName: 'Deepseek',
    envVar: 'DEEPSEEK_API_KEY',
    description: 'Modelo de código eficiente, custo menor que OpenAI.',
  },
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

export default function SettingsPage() {
  const [configuredProviders, setConfiguredProviders] = useState<LLMProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadProviders = async () => {
    setIsLoading(true);
    const providers = await llmService.getAvailableProviders();
    setConfiguredProviders(providers);
    setIsLoading(false);
  };

  useEffect(() => {
    // Remove segredos legados persistidos no navegador (item 7 da Fase 0):
    // versões antigas desta página salvavam API keys em localStorage.
    localStorage.removeItem('llm-provider-settings');

    loadProviders();
  }, []);

  const isConfigured = (provider: LLMProvider) => configuredProviders.includes(provider);

  return (
    <div className="min-h-screen bg-cyber-dark p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="font-orbitron text-3xl font-bold text-white mb-2">
            Configurações de IA
          </h1>
          <p className="text-gray-400 font-space">
            Status dos provedores de LLM configurados no servidor
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
              onClick={loadProviders}
              disabled={isLoading}
              className="cyber-button cyber-button-primary px-6 py-2 flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              {isLoading ? 'Verificando...' : 'Atualizar Status'}
            </button>
          </div>

          <div className="mb-6 p-3 bg-cyber-cyan/10 border border-cyber-cyan/30 rounded-lg flex items-start gap-2">
            <ShieldCheck className="w-5 h-5 text-cyber-cyan mt-0.5 flex-shrink-0" />
            <div className="text-sm text-gray-300 font-space">
              <p className="mb-1">
                As chaves de API são configuradas <strong className="text-cyber-cyan">apenas no servidor</strong>,
                via arquivo <code className="text-cyber-cyan">.env</code> na raiz do projeto
                (ver <code className="text-cyber-cyan">.env.example</code>). Elas nunca são enviadas ao navegador
                nem armazenadas em <code>localStorage</code>.
              </p>
              <p>
                O endpoint do Ollama aceita somente URLs locais
                (<code>http://localhost</code> / <code>127.0.0.1</code>). Após editar o <code>.env</code>,
                reinicie o servidor Next.js.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {PROVIDERS.map((provider) => (
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
              1. Copie <code className="text-cyber-cyan">.env.example</code> para{' '}
              <code className="text-cyber-cyan">.env</code> na raiz do projeto.
            </p>
            <p>
              2. Preencha as variáveis dos provedores desejados (ex.:{' '}
              <code className="text-cyber-cyan">OPENAI_API_KEY</code>). Nunca use o prefixo{' '}
              <code className="text-cyber-cyan">NEXT_PUBLIC_</code> para segredos.
            </p>
            <p>
              3. Reinicie o servidor (<code className="text-cyber-cyan">npm run dev</code> ou o
              executável Electron) e clique em &quot;Atualizar Status&quot;.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
