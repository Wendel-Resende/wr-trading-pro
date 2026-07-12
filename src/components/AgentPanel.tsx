"use client";

import { useState, useEffect, useRef } from 'react';
import {
  Brain,
  Settings,
  Loader2,
  AlertCircle,
  Zap,
  Key,
  Server,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { MT5ServiceSingleton } from '@/services/mt5Service';

interface OperationSuggestion {
  action: 'BUY' | 'SELL' | 'HOLD';
  ticker: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  quantity: number;
  risk_score: number;
  confidence: number;
  rationale: string;
  timestamp: string;
}

interface MarketData {
  price: number;
  bid: number;
  ask: number;
  previousClose: number;
  change?: number;
  changePercent?: number;
}

const LOCAL_MODELS = [
  { id: 'ministral-3:8b', name: 'Ministral 3 (8B)', desc: 'Melhor para analise' },
  { id: 'gemma4:e2b', name: 'Gemma 4 (2B)', desc: 'Mais rapido' },
  { id: 'qwen3.5:0.8b', name: 'Qwen 3.5 (0.8B)', desc: 'Mais leve' },
];

export default function AgentPanel() {
  const [ticker, setTicker] = useState('');
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [result, setResult] = useState<OperationSuggestion | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [error, setError] = useState<string | null>(null);
  const [mt5Connected, setMt5Connected] = useState(false);
  const [isLoadingMarket, setIsLoadingMarket] = useState(false);

  // Settings — chaves de API e endpoint Ollama vivem SOMENTE no servidor (.env)
  const [llmMode, setLlmMode] = useState<'mock' | 'openai' | 'local'>('local');
  const [localModel, setLocalModel] = useState('ministral-3:8b');
  const [showSettings, setShowSettings] = useState(false);

  const currentSymbolRef = useRef<string | null>(null);

  // Load saved settings
  useEffect(() => {
    // Remove segredos legados persistidos no navegador (item 7 da Fase 0)
    localStorage.removeItem('agent-api-key');
    localStorage.removeItem('agent-local-url');

    const savedLlmMode = localStorage.getItem('agent-llm-mode') || 'local';
    const savedLocalModel = localStorage.getItem('agent-local-model') || 'ministral-3:8b';

    setLlmMode(savedLlmMode as any);
    setLocalModel(savedLocalModel);
  }, []);

  // MT5 connection listener
  useEffect(() => {
    const mt5 = MT5ServiceSingleton.getInstance();

    const checkMT5 = () => {
      const state = mt5.getConnectionState();
      setMt5Connected(state.isConnected);
    };

    const handleState = (state: { state: string }) => {
      setMt5Connected(state.state === 'CONNECTED');
    };

    checkMT5();
    mt5.on('state', handleState);

    const interval = setInterval(checkMT5, 5000);
    return () => {
      mt5.off('state', handleState);
      clearInterval(interval);
    };
  }, []);

  // Subscribe to tick when ticker changes
  useEffect(() => {
    const mt5 = MT5ServiceSingleton.getInstance();
    const normalizedTicker = ticker.trim().toUpperCase();

    if (!normalizedTicker) {
      setMarketData(null);
      setError(null);
      return;
    }

    // Unsubscribe from previous symbol
    if (currentSymbolRef.current && currentSymbolRef.current !== normalizedTicker) {
      mt5.unsubscribeTicks(currentSymbolRef.current);
    }

    currentSymbolRef.current = normalizedTicker;
    setIsLoadingMarket(true);
    setError(null);
    setMarketData(null);

    // Timeout - if no tick in 5 seconds, show error
    const timeoutId = setTimeout(() => {
      if (currentSymbolRef.current === normalizedTicker && isLoadingMarket) {
        setIsLoadingMarket(false);
        setError(`Ativo ${normalizedTicker} nao encontrado no MT5. Verifique se o simbolo esta no Market Watch.`);
      }
    }, 5000);

    const handleTick = (tick: any) => {
      if (tick.symbol === normalizedTicker && tick.last > 0) {
        setMarketData({
          price: tick.last || tick.bid || 0,
          bid: tick.bid || 0,
          ask: tick.ask || 0,
          previousClose: tick.previousClose || tick.last || 0,
          change: tick.change,
          changePercent: tick.changePercent,
        });
        setIsLoadingMarket(false);
        setError(null);
        clearTimeout(timeoutId);
      }
    };

    mt5.on('tick', handleTick);
    mt5.subscribeTicks(normalizedTicker);

    return () => {
      clearTimeout(timeoutId);
      mt5.off('tick', handleTick);
      if (currentSymbolRef.current === normalizedTicker) {
        mt5.unsubscribeTicks(normalizedTicker);
      }
    };
  }, [ticker]);

  const runAnalysis = async () => {
    if (!ticker || !marketData || marketData.price === 0) {
      setError('Digite um ativo valido e aguarde os dados carregarem');
      return;
    }

    setStatus('running');
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'suggest-operation',
          ticker: ticker.toUpperCase(),
          market_data: marketData,
          llm_mode: llmMode,
          local_model: localModel,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        setResult(data.data);
        setStatus('completed');
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err: any) {
      setError(err.message || 'Erro na analise');
      setStatus('error');
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'BUY': return 'text-green-400 bg-green-400/20 border-green-400/50';
      case 'SELL': return 'text-red-400 bg-red-400/20 border-red-400/50';
      case 'HOLD': return 'text-yellow-400 bg-yellow-400/20 border-yellow-400/50';
      default: return 'text-gray-400';
    }
  };

  const getRiskColor = (score: number) => {
    if (score <= 0.3) return 'text-green-400';
    if (score <= 0.6) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-400" />
          <h2 className="text-lg font-semibold text-white">Agente de Trading</h2>
        </div>
        <div className="flex items-center gap-2">
          {mt5Connected ? (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <Wifi className="w-3 h-3" /> MT5 OK
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-yellow-400">
              <WifiOff className="w-3 h-3" /> MT5 OFF
            </span>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 hover:bg-gray-800 rounded transition"
            title="Configurar LLM"
          >
            <Settings className={`w-4 h-4 ${showSettings ? 'text-purple-400' : 'text-gray-400'}`} />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-gray-800 rounded-lg p-4 space-y-3 border border-gray-700">
          <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <Server className="w-4 h-4" />
            Configuracao do LLM
          </h3>

          {/* LLM Mode */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Modo</label>
            <select
              value={llmMode}
              onChange={(e) => setLlmMode(e.target.value as any)}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
            >
              <option value="local">Ollama Local (Recomendado)</option>
              <option value="openai">OpenAI</option>
              <option value="mock">Mock (Teste)</option>
            </select>
          </div>

          {/* Local Model Selection */}
          {llmMode === 'local' && (
            <>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Modelo Local</label>
                <select
                  value={localModel}
                  onChange={(e) => setLocalModel(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
                >
                  {LOCAL_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.name} - {m.desc}</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-gray-500">
                <Server className="w-3 h-3 inline mr-1" />
                Endpoint do Ollama configurado no servidor (OLLAMA_ENDPOINT no .env).
              </p>
            </>
          )}

          {/* OpenAI: chave configurada no servidor */}
          {llmMode === 'openai' && (
            <p className="text-xs text-gray-500">
              <Key className="w-3 h-3 inline mr-1" />
              A chave da OpenAI é configurada no servidor (OPENAI_API_KEY no .env), nunca no navegador.
            </p>
          )}

          <button
            onClick={() => {
              localStorage.setItem('agent-llm-mode', llmMode);
              localStorage.setItem('agent-local-model', localModel);
              setShowSettings(false);
            }}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white rounded px-4 py-2 text-sm"
          >
            Salvar Configuracao
          </button>
        </div>
      )}

      {/* Ticker Input */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Ativo</label>
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="Digite o ticker (ex: PETR4, VALE3, BBDC4)"
          className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm uppercase focus:border-purple-500 focus:outline-none"
        />
      </div>

      {/* Market Data Display */}
      {ticker && (
        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold text-white">{ticker.toUpperCase()}</span>
            {isLoadingMarket ? (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Loader2 className="w-3 h-3 animate-spin" /> Carregando...
              </span>
            ) : marketData && marketData.price > 0 ? (
              <span className="flex items-center gap-1 text-xs text-green-400">
                <Wifi className="w-3 h-3" /> Live
              </span>
            ) : (
              <span className="text-xs text-yellow-400">Aguardando dados...</span>
            )}
          </div>

          {marketData && marketData.price > 0 ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div>
                  <span className="text-xs text-gray-400 block">Preco</span>
                  <span className="text-xl font-mono font-bold text-white">R$ {marketData.price.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block">Bid</span>
                  <span className="text-green-400 font-mono">{marketData.bid.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block">Ask</span>
                  <span className="text-red-400 font-mono">{marketData.ask.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block">Variacao</span>
                  <span className={`font-mono font-bold ${(marketData.changePercent || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {(marketData.changePercent || 0) >= 0 ? '+' : ''}{(marketData.changePercent || 0).toFixed(2)}%
                  </span>
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={runAnalysis}
                disabled={status === 'running'}
                className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded px-4 py-3 text-sm font-medium transition"
              >
                {status === 'running' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analisando com {llmMode === 'local' ? localModel : llmMode === 'openai' ? 'OpenAI' : 'Mock'}...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Analisar e Sugerir Operacao
                  </>
                )}
              </button>
            </>
          ) : (
            <div className="text-center py-4 text-gray-500 text-sm">
              {!ticker ? 'Digite um ticker para iniciar' : 'Conectando ao MT5...'}
            </div>
          )}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="flex items-start gap-2 bg-red-900/30 border border-red-700 rounded p-3">
          <AlertCircle className="w-4 h-4 text-red-400 mt-0.5" />
          <span className="text-red-300 text-sm">{error}</span>
        </div>
      )}

      {/* Result - Operation Suggestion */}
      {result && (
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          {/* Header */}
          <div className="bg-gray-800 px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-medium text-white">Sugestao de Operacao</span>
            <span className="text-xs text-gray-400">{new Date(result.timestamp).toLocaleTimeString('pt-BR')}</span>
          </div>

          {/* Action Badge */}
          <div className="px-4 py-4 bg-gray-850">
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border ${getActionColor(result.action)}`}>
              <span className="text-2xl font-bold">{result.action}</span>
              <span className="text-sm opacity-80">{result.ticker}</span>
            </div>
          </div>

          {/* Price Levels */}
          <div className="px-4 py-3 bg-gray-850 border-t border-gray-700">
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <span className="text-xs text-gray-400 block">Entrada</span>
                <span className="text-lg font-mono text-green-400">R$ {result.entry_price.toFixed(2)}</span>
              </div>
              <div className="text-center">
                <span className="text-xs text-gray-400 block">Stop Loss</span>
                <span className="text-lg font-mono text-red-400">R$ {result.stop_loss.toFixed(2)}</span>
              </div>
              <div className="text-center">
                <span className="text-xs text-gray-400 block">Target</span>
                <span className="text-lg font-mono text-green-400">R$ {result.take_profit.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Risk & Confidence */}
          <div className="px-4 py-3 bg-gray-850 border-t border-gray-700">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs text-gray-400 block mb-1">Risco</span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        result.risk_score <= 0.3 ? 'bg-green-500' :
                        result.risk_score <= 0.6 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${result.risk_score * 100}%` }}
                    />
                  </div>
                  <span className={`text-sm font-mono ${getRiskColor(result.risk_score)}`}>
                    {(result.risk_score * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
              <div>
                <span className="text-xs text-gray-400 block mb-1">Confianca</span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500"
                      style={{ width: `${result.confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-mono text-purple-400">
                    {(result.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Quantity */}
          <div className="px-4 py-3 bg-gray-850 border-t border-gray-700">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Lotes (100 acoes)</span>
              <span className="text-white font-mono">{result.quantity} lotes</span>
            </div>
          </div>

          {/* Rationale */}
          <div className="px-4 py-3 bg-gray-850 border-t border-gray-700">
            <span className="text-xs text-gray-400 block mb-1">Analise do Agente</span>
            <p className="text-sm text-gray-300">{result.rationale}</p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {status === 'idle' && !result && !error && (
        <div className="text-center py-6 text-gray-500">
          <Brain className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Digite um ativo e clique em analisar</p>
        </div>
      )}
    </div>
  );
}