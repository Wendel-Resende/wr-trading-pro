"use client";

import { useState, useEffect } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { mt5Service } from '@/services/mt5Service';

interface OrderBookEntry {
  price: number;
  volume: number;
}

interface OrderBookProps {
  defaultSymbol?: string;
}

export default function OrderBook({ defaultSymbol = 'EURUSD' }: OrderBookProps) {
  const [bids, setBids] = useState<OrderBookEntry[]>([]);
  const [asks, setAsks] = useState<OrderBookEntry[]>([]);
  const [spread, setSpread] = useState<{ value: number; points: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(defaultSymbol);
  const [symbolInput, setSymbolInput] = useState<string>(defaultSymbol);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!selectedSymbol) return;

    setErrorMessage(null); // limpar erro ao trocar de símbolo

    const handleOrderBook = (data: any) => {
      if (data.symbol === selectedSymbol) {
        const bidEntries = (data.bids || []).map((e: any) => ({
          price: e.price,
          volume: e.volume,
        }));
        const askEntries = (data.asks || []).map((e: any) => ({
          price: e.price,
          volume: e.volume,
        }));

        setBids(bidEntries);
        setAsks(askEntries);
        setLoading(false);
        setErrorMessage(null); // book chegou — limpar qualquer erro anterior

        // Calcular spread
        if (bidEntries.length > 0 && askEntries.length > 0) {
          const bestBid = bidEntries[0].price;
          const bestAsk = askEntries[0].price;
          const spreadValue = bestAsk - bestBid;
          // Para Forex, 1 pip geralmente é 0.0001 (4 casas decimais)
          const pipMultiplier = data.digits ? Math.pow(10, data.digits) : 10000;
          const spreadPoints = spreadValue * pipMultiplier;

          setSpread({
            value: spreadValue,
            points: spreadPoints,
          });
        }
      }
    };

    const handleOrderBookError = (data: any) => {
      if (data?.type !== 'orderBook' || data?.symbol !== selectedSymbol) return;
      setErrorMessage(typeof data.message === 'string' ? data.message : 'Book de ofertas indisponível');
      setLoading(false);
    };

    // Registrar listeners ANTES de inscrever, para nunca perder o primeiro evento.
    mt5Service.on('orderbook', handleOrderBook);
    mt5Service.on('error', handleOrderBookError);

    // Verificar se está conectado antes de solicitar
    const connectionState = mt5Service.getConnectionState();
    if (connectionState.state === 'CONNECTED') {
      setLoading(true);
      // Inscrever em atualizações contínuas do book (igual a boleta)
      mt5Service.subscribeOrderBook(selectedSymbol);
    } else {
      console.log('MT5 não está conectado, aguardando...');
    }

    return () => {
      mt5Service.off('orderbook', handleOrderBook);
      mt5Service.off('error', handleOrderBookError);
      // Desinscrever do book ao desmontar componente
      if (selectedSymbol) {
        mt5Service.unsubscribeOrderBook(selectedSymbol);
      }
    };
  }, [selectedSymbol]);

  // Calcular volume máximo para normalização
  const maxBidVolume = Math.max(...bids.map((b) => b.volume), 0);
  const maxAskVolume = Math.max(...asks.map((a) => a.volume), 0);

  // Obter volume máximo total para centralizar
  const maxVolume = Math.max(maxBidVolume, maxAskVolume);

  // Atualizar quando o símbolo externo muda
  useEffect(() => {
    if (defaultSymbol && defaultSymbol !== selectedSymbol) {
      setSelectedSymbol(defaultSymbol);
      setSymbolInput(defaultSymbol);
    }
  }, [defaultSymbol]);

  // Buscar book ao pressionar Enter
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && symbolInput.trim()) {
      const symbol = symbolInput.trim().toUpperCase();
      setSelectedSymbol(symbol);
      setSymbolInput(symbol);
    }
  };

  // Buscar book ao perder foco
  const handleBlur = () => {
    if (symbolInput.trim()) {
      const symbol = symbolInput.trim().toUpperCase();
      setSelectedSymbol(symbol);
      setSymbolInput(symbol);
    }
  };

  if (!mounted) {
    return (
      <div className="cyber-card p-4 hud-corner">
        <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan flex items-center gap-2 mb-4">
          <span>Book de Ofertas</span>
          <input
            type="text"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder="Digite o ativo (ex: EURUSD)"
            className="bg-cyber-dark/50 border border-cyber-border rounded px-3 py-1 text-sm text-gray-400 font-jetbrains focus:outline-none focus:border-cyber-cyan w-40"
          />
        </h3>
        <div className="text-gray-400 font-space text-sm text-center py-8">
          Carregando...
        </div>
      </div>
    );
  }

  const connectionState = mt5Service.getConnectionState();
  if (connectionState.state !== 'CONNECTED') {
    return (
      <div className="cyber-card p-4 hud-corner">
        <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan flex items-center gap-2 mb-4">
          <span>Book de Ofertas</span>
          <input
            type="text"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder="Digite o ativo (ex: EURUSD)"
            className="bg-cyber-dark/50 border border-cyber-border rounded px-3 py-1 text-sm text-gray-400 font-jetbrains focus:outline-none focus:border-cyber-cyan w-40"
          />
        </h3>
        <div className="text-gray-400 font-space text-sm text-center py-8">
          Conecte-se ao MT5 para visualizar o book de ofertas
        </div>
      </div>
    );
  }

  if (loading || bids.length === 0 || asks.length === 0) {
    return (
      <div className="cyber-card p-4 hud-corner">
        <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan flex items-center gap-2 mb-4">
          <span>Book de Ofertas</span>
          <input
            type="text"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder="Digite o ativo (ex: EURUSD)"
            className="bg-cyber-dark/50 border border-cyber-border rounded px-3 py-1 text-sm text-gray-400 font-jetbrains focus:outline-none focus:border-cyber-cyan w-40"
          />
        </h3>
        <div className="text-gray-400 font-space text-sm text-center py-8">
          {errorMessage ? errorMessage : loading ? 'Buscando dados...' : 'Sem dados disponíveis para este ativo'}
        </div>
      </div>
    );
  }

  return (
    <div className="cyber-card p-4 hud-corner">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan flex items-center gap-2">
          <span>Book de Ofertas</span>
          <input
            type="text"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder="Digite o ativo (ex: EURUSD)"
            className="bg-cyber-dark/50 border border-cyber-border rounded px-3 py-1 text-sm text-gray-400 font-jetbrains focus:outline-none focus:border-cyber-cyan w-40"
          />
        </h3>
        {spread && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 font-space">Spread:</span>
            <span className="text-yellow-400 font-jetbrains text-sm">
              {spread.points.toFixed(1)} pts ({spread.value.toFixed(selectedSymbol?.endsWith('JPY') ? 3 : 5)})
            </span>
          </div>
        )}
      </div>

      {/* Cabeçalho */}
      <div className="grid grid-cols-3 gap-2 text-xs font-space text-gray-400 mb-2 px-2">
        <div className="text-right">Vol Compra</div>
        <div className="text-center">Preço</div>
        <div>Vol Venda</div>
      </div>

      {/* Container do book */}
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {/* Ordens de Venda (Asks) - EM CIMA - Ordens decrescentes (maior → menor) */}
        {[...asks].reverse().slice(0, 10).map((ask, index) => {
          const volumePercent = (ask.volume / maxVolume) * 100;
          return (
            <div key={`ask-${index}`} className="relative">
              {/* Barra de volume vermelha à direita */}
              <div
                className="absolute right-0 top-0 bottom-0 bg-red-500/20 rounded-l transition-all duration-300"
                style={{ width: `${volumePercent}%` }}
              />
              <div className="relative grid grid-cols-3 gap-2 text-sm font-jetbrains px-2 py-1 hover:bg-cyber-dark/50 transition-colors">
                <div className="text-right" />
                <div className="text-center text-red-400 font-bold">
                  {ask.price.toFixed(selectedSymbol?.endsWith('JPY') ? 3 : 5)}
                </div>
                <div className="text-red-200">
                  {ask.volume.toFixed(2)}
                </div>
              </div>
            </div>
          );
        })}

        {/* Linha do Spread */}
        {bids.length > 0 && asks.length > 0 && (
          <div className="my-2 border-t border-b border-cyber-border py-2">
            <div className="grid grid-cols-3 gap-2 text-sm font-bold px-2">
              <div className="text-right text-green-200" />
              <div className="text-center">
                <span className="text-yellow-400 text-xs font-space">
                  Spread: {spread?.points.toFixed(1)} pts
                </span>
              </div>
              <div className="text-red-200" />
            </div>
          </div>
        )}

        {/* Ordens de Compra (Bids) - EMBAIXO - Ordens decrescentes (maior → menor) */}
        {bids.slice(0, 10).map((bid, index) => {
          const volumePercent = (bid.volume / maxVolume) * 100;
          return (
            <div key={`bid-${index}`} className="relative">
              {/* Barra de volume verde à esquerda */}
              <div
                className="absolute left-0 top-0 bottom-0 bg-green-500/20 rounded-r transition-all duration-300"
                style={{ width: `${volumePercent}%` }}
              />
              <div className="relative grid grid-cols-3 gap-2 text-sm font-jetbrains px-2 py-1 hover:bg-cyber-dark/50 transition-colors">
                <div className="text-right text-green-200">
                  {bid.volume.toFixed(2)}
                </div>
                <div className="text-center text-green-400 font-bold">
                  {bid.price.toFixed(selectedSymbol?.endsWith('JPY') ? 3 : 5)}
                </div>
                <div />
              </div>
            </div>
          );
        })}
      </div>

      {/* Legenda */}
      <div className="mt-4 pt-3 border-t border-cyber-border flex justify-center gap-6 text-xs font-space">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-green-500 rounded"></div>
          <span className="text-gray-400">Ordens de Compra</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-red-500 rounded"></div>
          <span className="text-gray-400">Ordens de Venda</span>
        </div>
      </div>
    </div>
  );
}
