"use client";

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Settings, ChevronDown } from 'lucide-react';
import { llmService, buildMarketContext } from '@/services/llmService';
import { LLMProvider, LLMMessage } from '@/types/llm';
import { MT5AccountInfo, MT5Tick } from '@/types/mt5';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  provider?: LLMProvider;
}

interface AIChatProps {
  accountInfo?: MT5AccountInfo | null;
  tickData?: Map<string, MT5Tick>;
  selectedSymbol?: string;
}

export default function AIChat({ accountInfo, tickData, selectedSymbol = 'PETR4' }: AIChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Olá! Sou seu assistente de trading. Como posso ajudar você hoje?',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider>('OPENAI');
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<LLMProvider[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load available providers
    const providers = llmService.getAvailableProviders();
    setAvailableProviders(providers);
    
    // Set first available provider as default
    if (providers.length > 0 && !providers.includes(selectedProvider)) {
      setSelectedProvider(providers[0]);
    }
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const llmMessages: LLMMessage[] = messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const marketCtx = buildMarketContext(
        accountInfo ?? null,
        tickData ?? new Map(),
        selectedSymbol
      );

      const response = await llmService.chat({
        messages: llmMessages,
        config: {
          provider: selectedProvider,
          temperature: 0.7,
          maxTokens: 2000,
        },
        context: marketCtx ? { market: marketCtx } : undefined,
      });

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.content,
        timestamp: new Date(),
        provider: response.provider,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Erro ao processar sua mensagem: ${error instanceof Error ? error.message : 'Erro desconhecido'}. Por favor, verifique a configuração do provedor de IA.`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const generateMockResponse = (userInput: string): string => {
    const lowerInput = userInput.toLowerCase();
    
    if (lowerInput.includes('comprar') || lowerInput.includes('buy')) {
      return 'Com base na análise técnica atual, recomendo considerar PETR4 e ITUB4 para compra. O RSI de PETR4 está em 35, indicando potencial de valorização. Lembre-se de sempre definir seu stop-loss.';
    } else if (lowerInput.includes('vender') || lowerInput.includes('sell')) {
      return 'A análise sugere cautela com MGLU3 devido à alta volatilidade. Considere reduzir posições se o preço cair abaixo de R$ 2,00.';
    } else if (lowerInput.includes('petr4')) {
      return 'PETR4 está negociando a R$ 34,20 com tendência de alta. Os indicadores técnicos mostram: RSI: 35, MACD: positivo, Bandas de Bollinger: preço próximo da banda inferior. Recomendação: COMPRA com confiança de 75%.';
    } else if (lowerInput.includes('vale3')) {
      return 'VALE3 está em R$ 66,50 com leve queda. RSI: 55, MACD: neutro. A ação está em consolidação. Recomendação: MANTER posição.';
    } else if (lowerInput.includes('risco') || lowerInput.includes('stop')) {
      return 'Para gerenciar risco, recomendo: 1) Stop-loss de 2-3% abaixo do preço de entrada, 2) Nunca arrisque mais que 2% do capital em uma operação, 3) Diversifique entre 5-10 ativos.';
    } else {
      return 'Posso ajudar com análise de ativos, recomendações de compra/venda, gestão de risco e estratégias de trading. Sobre qual ativo ou estratégia você gostaria de saber mais?';
    }
  };

  const getProviderDisplayName = (provider: LLMProvider): string => {
    const names: Record<LLMProvider, string> = {
      'OPENAI': 'OpenAI',
      'DEEPSEEK': 'Deepseek',
      'OLLAMA': 'Ollama',
      'QWEN': 'Qwen',
      'GROQ': 'Groq',
      'MANUS': 'Manus',
    };
    return names[provider] || provider;
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-cyber-dark/50 rounded border border-cyber-border">
      <div className="flex items-center justify-between p-3 border-b border-cyber-border bg-cyber-card/50">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-cyber-cyan" />
          <h3 className="font-orbitron text-sm font-bold text-white">Assistente IA</h3>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowProviderMenu(!showProviderMenu)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-space text-cyber-cyan border border-cyber-cyan/30 rounded hover:bg-cyber-cyan/10 transition-colors"
          >
            <Settings className="w-3 h-3" />
            <span>{getProviderDisplayName(selectedProvider)}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
          {showProviderMenu && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-cyber-card border border-cyber-border rounded-lg shadow-xl z-50">
              {availableProviders.length > 0 ? (
                availableProviders.map((provider) => (
                  <button
                    key={provider}
                    onClick={() => {
                      setSelectedProvider(provider);
                      setShowProviderMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs font-space transition-colors ${
                      selectedProvider === provider
                        ? 'bg-cyber-cyan/20 text-cyber-cyan'
                        : 'text-gray-300 hover:bg-cyber-cyan/10'
                    }`}
                  >
                    {getProviderDisplayName(provider)}
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-xs text-gray-500">
                  Nenhum provedor configurado
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-cyber">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                message.role === 'user'
                  ? 'bg-cyber-pink'
                  : 'bg-cyber-cyan'
              }`}
            >
              {message.role === 'user' ? (
                <User className="w-4 h-4 text-white" />
              ) : (
                <Bot className="w-4 h-4 text-black" />
              )}
            </div>
            <div
              className={`max-w-[80%] p-3 rounded-lg ${
                message.role === 'user'
                  ? 'bg-cyber-pink/20 border border-cyber-pink/50'
                  : 'bg-cyber-cyan/20 border border-cyber-cyan/50'
              }`}
            >
              <p className="text-sm text-gray-200 font-space">{message.content}</p>
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-gray-500">
                  {message.timestamp.toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                {message.provider && (
                  <span className="text-xs text-cyber-cyan/70 font-space">
                    {getProviderDisplayName(message.provider)}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-cyber-cyan flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-black" />
            </div>
            <div className="bg-cyber-cyan/20 border border-cyber-cyan/50 p-3 rounded-lg">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-cyber-cyan rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-cyber-cyan rounded-full animate-bounce delay-100" />
                <div className="w-2 h-2 bg-cyber-cyan rounded-full animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 border-t border-cyber-border bg-cyber-card/50">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Digite sua pergunta..."
            className="flex-1 cyber-input text-sm"
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="cyber-button cyber-button-secondary px-3"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}