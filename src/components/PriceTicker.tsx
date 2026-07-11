"use client";

import { useState, useEffect, useRef } from 'react';
import { TickerData } from '@/types';
import { TrendingUp, TrendingDown, Plus, X, ChevronLeft, ChevronRight, Play, Pause } from 'lucide-react';
import { mt5Service } from '@/services/mt5Service';
import { MT5Tick } from '@/types/mt5';

interface PriceTickerProps {
  symbols?: string[];
}

const STORAGE_KEY = 'wr_trade_pro_watchlist';

export default function PriceTicker({ symbols = [] }: PriceTickerProps) {
  const [mounted, setMounted] = useState(false);
  const [tickData, setTickData] = useState<Map<string, MT5Tick>>(new Map());
  const [tickers, setTickers] = useState<TickerData[]>([]);
  const [userSymbols, setUserSymbols] = useState<string[]>([]);
  const [showAddSymbol, setShowAddSymbol] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [offset, setOffset] = useState(0);
  const [isAutoPlay, setIsAutoPlay] = useState(true);
  const tickerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Carregar símbolos do localStorage
  useEffect(() => {
    const savedSymbols = localStorage.getItem(STORAGE_KEY);
    if (savedSymbols) {
      try {
        const parsed = JSON.parse(savedSymbols);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setUserSymbols(parsed);
        }
      } catch (e) {
        console.error('Erro ao carregar símbolos:', e);
      }
    }
  }, []);

  // Salvar símbolos no localStorage quando mudar
  useEffect(() => {
    if (userSymbols.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userSymbols));
    }
  }, [userSymbols]);

  // Função auxiliar para formatar preço com o número correto de casas decimais
  const formatPrice = (price: number, digits?: number): string => {
    const decimalPlaces = digits ?? 5; // Padrão: 2 casas decimais
    return price.toFixed(decimalPlaces);
  };

  // Auto-scroll do ticker em loop contínuo
  useEffect(() => {
    if (!isAutoPlay || !containerRef.current || tickers.length === 0) {
      return;
    }

    const interval = setInterval(() => {
      const container = containerRef.current;
      const ticker = tickerRef.current;
      if (container && ticker) {
        const maxOffset = ticker.scrollWidth / 2; // Permite rolar até a metade (primeira cópia)
        if (maxOffset > 0) {
          setOffset(prev => {
            if (prev >= maxOffset) {
              return 0; // Voltar ao início sem interrupção visível
            }
            return prev + 1; // Scroll suave
          });
        }
      }
    }, 50); // 20fps para scroll suave

    return () => clearInterval(interval);
  }, [isAutoPlay, tickers.length]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // Escutar eventos de tick do MT5
    const handleTick = (tick: MT5Tick) => {
      setTickData(prev => new Map(prev).set(tick.symbol, tick));
    };

    mt5Service.on('tick', handleTick);

    // Inscrever em todos os símbolos quando conectar (uma vez só)
    const handleStateChange = (state: any) => {
      if (state.state === 'CONNECTED') {
        // Inscrever apenas uma vez por símbolo
        userSymbols.forEach(symbol => {
          mt5Service.subscribeTicks(symbol);
        });
      }
    };

    // Verificar conexão imediatamente
    const currentState = mt5Service.getConnectionState();
    if (currentState.state === 'CONNECTED') {
      userSymbols.forEach(symbol => {
        mt5Service.subscribeTicks(symbol);
      });
    }

    // Escutar mudanças de estado
    mt5Service.on('state', handleStateChange);

    return () => {
      mt5Service.off('tick', handleTick);
      mt5Service.off('state', handleStateChange);
    };
  }, [userSymbols]);

  // Converter tick data do MT5 para TickerData
  useEffect(() => {
    const newTickers: TickerData[] = userSymbols.map(symbol => {
      const tick = tickData.get(symbol);
      
      if (tick && tick.bid) {
        const currentPrice = tick.bid;
        
        // Usar valores calculados pelo Python se disponíveis
        if (tick.changePercent !== undefined && tick.changePercent !== null) {
          const prevClose = tick.previousClose || 0;
          return {
            symbol,
            price: currentPrice,
            change: tick.change || 0,
            changePercent: tick.changePercent,
            volume: tick.volume,
            high: Math.max(currentPrice, prevClose),
            low: Math.min(currentPrice, prevClose),
            timestamp: tick.time,
            digits: tick.digits, // Armazenar digits para formatação
          };
        } else {
          // Fallback: calcular localmente se Python não enviar
          const prevClose = tick.previousClose || 0;
          if (prevClose > 0) {
            const change = currentPrice - prevClose;
            const changePercent = (change / prevClose) * 100;
          return {
            symbol,
            price: currentPrice,
            change,
            changePercent,
            volume: tick.volume,
            high: Math.max(currentPrice, prevClose),
            low: Math.min(currentPrice, prevClose),
            timestamp: tick.time,
            digits: tick.digits, // Armazenar digits para formatação
          };
          } else {
            return {
              symbol,
              price: currentPrice,
              change: 0,
              changePercent: 0,
              volume: tick.volume,
              high: currentPrice,
              low: currentPrice,
              timestamp: tick.time,
            };
          }
        }
      }

      // Se não tiver dados do MT5, retorna valores zerados
      
      return {
        symbol,
        price: 0,
        change: 0,
        changePercent: 0,
        volume: 0,
        high: 0,
        low: 0,
        timestamp: new Date(),
      };
    });

    setTickers(newTickers);
  }, [tickData, userSymbols]);

  const handleAddSymbol = () => {
    const symbol = newSymbol.toUpperCase().trim();
    if (symbol && !userSymbols.includes(symbol)) {
      setUserSymbols([...userSymbols, symbol]);
      setNewSymbol('');
      setShowAddSymbol(false);
    }
  };

  const handleRemoveSymbol = (symbol: string) => {
    setUserSymbols(userSymbols.filter(s => s !== symbol));
  };

  const handleScrollLeft = () => {
    setIsAutoPlay(false); // Pausar auto-play quando usuário interagir
    setOffset(prev => Math.max(0, prev - 300));
  };

  const handleScrollRight = () => {
    setIsAutoPlay(false); // Pausar auto-play quando usuário interagir
    setOffset(prev => prev + 300);
  };

  const toggleAutoPlay = () => {
    setIsAutoPlay(!isAutoPlay);
  };

  // Duplicar tickers para criar loop contínuo
  const loopedTickers = tickers.length > 0 ? [...tickers, ...tickers] : [];

  return (
    <div className="overflow-hidden bg-cyber-card/50 border-y border-cyber-border relative">
      {/* Controles de navegação */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-cyber-border">
        <button
          onClick={handleScrollLeft}
          className="p-1 text-gray-400 hover:text-cyber-cyan transition-colors"
          title="Scroll para esquerda"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={handleScrollRight}
          className="p-1 text-gray-400 hover:text-cyber-cyan transition-colors"
          title="Scroll para direita"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        
        {/* Toggle Auto Play */}
        <button
          onClick={toggleAutoPlay}
          className={`p-1 rounded transition-colors ${
            isAutoPlay 
              ? 'text-cyber-cyan bg-cyber-cyan/20' 
              : 'text-gray-400 hover:text-cyber-cyan'
          }`}
          title={isAutoPlay ? 'Pausar auto-play' : 'Iniciar auto-play'}
        >
          {isAutoPlay ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        
        <div className="h-4 w-px bg-cyber-border mx-2" />
        <button
          onClick={() => setShowAddSymbol(!showAddSymbol)}
          className="flex items-center gap-1 px-2 py-1 cyber-badge text-xs bg-cyber-purple/20 text-cyber-purple border-cyber-purple hover:bg-cyber-purple/30 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Adicionar Ativo
        </button>
        
        {/* Input para adicionar símbolo */}
        {showAddSymbol && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
              onKeyPress={(e) => e.key === 'Enter' && handleAddSymbol()}
              placeholder="Ex: PETR4"
              className="px-2 py-1 text-xs bg-cyber-dark border border-cyber-border rounded text-white font-space focus:border-cyber-cyan focus:outline-none"
              maxLength={10}
              autoFocus
            />
            <button
              onClick={handleAddSymbol}
              className="px-3 py-1 text-xs bg-cyber-cyan/20 text-cyber-cyan border border-cyber-cyan rounded hover:bg-cyber-cyan/30 transition-colors"
            >
              Adicionar
            </button>
            <button
              onClick={() => setShowAddSymbol(false)}
              className="px-2 py-1 text-xs text-gray-400 hover:text-white transition-colors"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>

      {/* Ticker com carrossel em loop */}
      <div 
        ref={containerRef}
        className="overflow-hidden"
      >
        <div 
          ref={tickerRef}
          className="flex items-center gap-8 py-2 transition-transform duration-75"
          style={{ transform: `translateX(-${offset}px)` }}
        >
          {mounted && loopedTickers.map((ticker, index) => (
            <div 
              key={`${ticker.symbol}-${index}`} 
              className="flex items-center gap-2 whitespace-nowrap px-4 border-r border-cyber-border/50 group relative"
            >
              <span className="font-orbitron font-bold text-white">{ticker.symbol}</span>
              <span className="font-jetbrains text-cyber-cyan">
                R$ {formatPrice(ticker.price, ticker.digits)}
              </span>
              <div className={`flex items-center gap-1 ${ticker.changePercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {ticker.changePercent >= 0 ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                <span className="text-xs font-space">
                  {ticker.change >= 0 ? '+' : ''}{formatPrice(ticker.change, ticker.digits)} ({ticker.changePercent >= 0 ? '+' : ''}{ticker.changePercent.toFixed(4)}%)
                </span>
              </div>
              
              {/* Botão para remover ativo (apenas na primeira metade) */}
              {index < tickers.length && (
                <button
                  onClick={() => handleRemoveSymbol(ticker.symbol)}
                  className="absolute -top-1 -right-1 p-0.5 bg-red-500/80 rounded text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                  title={`Remover ${ticker.symbol}`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          
          {mounted && tickers.length === 0 && (
            <div className="text-gray-400 font-space text-sm px-4">
              Nenhum ativo monitorado. Clique em "Adicionar Ativo" para começar.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
