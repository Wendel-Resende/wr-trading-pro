"use client";

import { useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, AlertTriangle, Loader2 } from 'lucide-react';
import { mt5Service } from '@/services/mt5Service';
import { MT5Tick, MT5OrderRequest } from '@/types/mt5';
import { useToast } from '@/contexts/ToastContext';

interface OrderFormProps {
  symbols?: string[];  // Lista de símbolos disponíveis (opcional)
}

export default function OrderForm({ symbols = [] }: OrderFormProps) {
  const toast = useToast();
  const [orderType, setOrderType] = useState<'BUY' | 'SELL'>('BUY');
  const [orderStyle, setOrderStyle] = useState<'MARKET' | 'LIMIT' | 'STOP'>('MARKET');
  const [inputSymbol, setInputSymbol] = useState('');
  const [quantity, setQuantity] = useState(0.01); // MT5 usa lotes (0.01, 0.1, 1.0)
  const [price, setPrice] = useState<number | undefined>();
  const [stopLoss, setStopLoss] = useState<number | undefined>();
  const [takeProfit, setTakeProfit] = useState<number | undefined>();
  const [tickData, setTickData] = useState<MT5Tick | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [symbolError, setSymbolError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Obter preço atual (bid para venda, ask para compra)
  const currentPrice = orderType === 'BUY' 
    ? (tickData?.ask || 0)
    : (tickData?.bid || 0);

  // Usar preço definido para ordens LIMIT/STOP, ou preço de mercado
  const executionPrice = price || currentPrice;
  
  const totalValue = quantity * executionPrice;
  const estimatedPnL = orderType === 'BUY'
    ? ((takeProfit || 0) - executionPrice) * quantity
    : (executionPrice - (stopLoss || 0)) * quantity;

  // Calcular variação percentual
  const prevClose = tickData?.previousClose || 0;
  const change = prevClose > 0 ? currentPrice - prevClose : 0;
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

  // Calcular spread em pontos
  const spread = tickData?.bid && tickData?.ask ? tickData.ask - tickData.bid : 0;
  const spreadPoints = spread && tickData?.digits ? Math.round(spread * Math.pow(10, tickData.digits)) : 0;

  // Formatar preço com o número correto de casas decimais
  const formatPrice = (p: number, d?: number): string => {
    const decimals = d ?? tickData?.digits ?? 2;
    return p.toFixed(decimals);
  };

  // Buscar dados do símbolo quando digitado
  useEffect(() => {
    if (inputSymbol.length >= 2) {
      setIsLoading(true);
      setSymbolError(null);
      mt5Service.subscribeTicks(inputSymbol);
    }

    const handleTick = (tick: MT5Tick) => {
      if (tick.symbol === inputSymbol) {
        setTickData(tick);
        setIsLoading(false);
        setSymbolError(null);
        
        // Se não tiver preço definido e for ordem MARKET, usar preço atual
        if (orderStyle === 'MARKET' && !price) {
          const marketPrice = orderType === 'BUY' ? tick.ask : tick.bid;
          if (marketPrice) {
            setPrice(marketPrice);
          }
        }
      }
    };

    const handleError = (error: any) => {
      if (error.symbol === inputSymbol) {
        setIsLoading(false);
        setSymbolError(error.message || 'Símbolo não encontrado');
      }
    };

    mt5Service.on('tick', handleTick);
    mt5Service.on('error', handleError);

    return () => {
      mt5Service.off('tick', handleTick);
      mt5Service.off('error', handleError);
    };
  }, [inputSymbol, orderType, orderStyle, price]);

  // Atualizar preço quando mudar tipo de ordem
  useEffect(() => {
    if (orderStyle === 'MARKET' && tickData) {
      const marketPrice = orderType === 'BUY' ? tickData.ask : tickData.bid;
      if (marketPrice) {
        setPrice(marketPrice);
      }
    }
  }, [orderType, tickData, orderStyle]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const symbol = inputSymbol.trim().toUpperCase();
    if (!symbol) {
      toast.error('Informe um ativo.');
      return;
    }
    if (quantity <= 0) {
      toast.error('Quantidade deve ser maior que zero.');
      return;
    }

    let request: MT5OrderRequest;
    if (orderStyle === 'MARKET') {
      request = {
        action: 'TRADE_ACTION_DEAL',
        symbol,
        volume: quantity,
        type: orderType === 'BUY' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
        sl: stopLoss,
        tp: takeProfit,
      };
    } else {
      if (!price || price <= 0) {
        toast.error('Informe o preço da ordem.');
        return;
      }
      const pendingType =
        orderStyle === 'LIMIT'
          ? orderType === 'BUY' ? 'ORDER_TYPE_BUY_LIMIT' : 'ORDER_TYPE_SELL_LIMIT'
          : orderType === 'BUY' ? 'ORDER_TYPE_BUY_STOP' : 'ORDER_TYPE_SELL_STOP';
      request = {
        action: 'TRADE_ACTION_PENDING',
        symbol,
        volume: quantity,
        type: pendingType,
        price,
        sl: stopLoss,
        tp: takeProfit,
      };
    }

    setIsSubmitting(true);
    try {
      const result = await mt5Service.sendOrder(request);
      toast.success(`Ordem enviada — ticket ${result.order || result.deal || '—'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar ordem.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="cyber-card p-4 hud-corner">
      <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan mb-4">
        Nova Ordem
      </h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Symbol Display */}
        <div className="bg-cyber-dark/50 p-3 rounded border border-cyber-border">
          <div className="flex justify-between items-center">
            <div className="flex-1 mr-4">
              <p className="text-xs text-gray-400 font-space mb-1">Ativo</p>
              <div className="relative">
                <input
                  type="text"
                  value={inputSymbol}
                  onChange={(e) => setInputSymbol(e.target.value.toUpperCase())}
                  placeholder="Ex: PETR4, BTCUSD, EURUSD"
                  className="w-full bg-cyber-dark border border-cyber-border rounded px-3 py-2 text-white font-orbitron text-xl font-bold focus:border-cyber-cyan focus:outline-none"
                  maxLength={15}
                />
                {isLoading && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyber-cyan animate-spin" />
                )}
              </div>
            </div>
            <div className="text-right min-w-[120px]">
              <p className="text-xs text-gray-400 font-space">
                {orderStyle === 'MARKET' ? 'Preço de Mercado' : 'Preço da Ordem'}
              </p>
              <p className="font-jetbrains text-xl text-cyber-cyan">
                {executionPrice > 0 ? formatPrice(executionPrice) : '---'}
              </p>
            </div>
          </div>
          
          {/* Informações de mercado */}
          {tickData && (
            <div className="mt-3 pt-3 border-t border-cyber-border/50 grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-gray-400 font-space">Spread</p>
                <p className="font-jetbrains text-yellow-400">
                  {spreadPoints} pts ({formatPrice(spread)})
                </p>
              </div>
              <div className={`text-center ${changePercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                <p className="text-gray-400 font-space">Variação</p>
                <p className="font-jetbrains">
                  {changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%
                </p>
              </div>
              <div className="text-right">
                <p className="text-gray-400 font-space">Fechamento Ant.</p>
                <p className="font-jetbrains text-white">
                  {formatPrice(prevClose)}
                </p>
              </div>
            </div>
          )}
          
          {symbolError && (
            <div className="mt-2 text-xs text-red-400 font-space">
              {symbolError}
            </div>
          )}
        </div>

        {/* Order Type Selection */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setOrderType('BUY')}
            className={`cyber-button font-bold ${
              orderType === 'BUY'
                ? 'cyber-button-primary'
                : 'bg-cyber-dark border border-cyber-border text-gray-400'
            }`}
          >
            <ArrowUp className="w-4 h-4 inline mr-1" />
            COMPRA
            {tickData && (
              <span className="ml-2 text-xs opacity-75">
                {formatPrice(tickData.ask)}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setOrderType('SELL')}
            className={`cyber-button font-bold ${
              orderType === 'SELL'
                ? 'bg-red-600 text-white'
                : 'bg-cyber-dark border border-cyber-border text-gray-400'
            }`}
          >
            <ArrowDown className="w-4 h-4 inline mr-1" />
            VENDA
            {tickData && (
              <span className="ml-2 text-xs opacity-75">
                {formatPrice(tickData.bid)}
              </span>
            )}
          </button>
        </div>

        {/* Order Style Selection */}
        <div>
          <label className="text-xs text-gray-400 font-space mb-2 block">Tipo de Ordem</label>
          <div className="grid grid-cols-3 gap-2">
            {(['MARKET', 'LIMIT', 'STOP'] as const).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => setOrderStyle(style)}
                className={`cyber-badge text-sm ${
                  orderStyle === style
                    ? 'bg-cyber-cyan/20 text-cyber-cyan border-cyber-cyan'
                    : 'bg-cyber-dark text-gray-400 border-cyber-border'
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        {/* Price Input */}
        {orderStyle !== 'MARKET' && (
          <div>
            <label className="text-xs text-gray-400 font-space mb-2 block">
              {orderStyle === 'LIMIT' ? 'Preço Limite' : 'Preço de Disparo'}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-space">
                R$
              </span>
              <input
                type="number"
                step="0.01"
                value={price || ''}
                onChange={(e) => setPrice(parseFloat(e.target.value) || undefined)}
                className="cyber-input w-full pl-12"
                required
              />
              {currentPrice > 0 && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                  Mercado: {formatPrice(currentPrice)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Quantity Input */}
        <div>
          <label className="text-xs text-gray-400 font-space mb-2 block">Quantidade</label>
          <div className="relative">
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={quantity}
              onChange={(e) => setQuantity(parseFloat(e.target.value) || 0.01)}
              className="cyber-input w-full"
              required
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-space text-sm">
              {tickData?.digits ? 'lotes' : 'unidades'}
            </span>
          </div>
        </div>

        {/* Stop Loss */}
        <div>
          <label className="text-xs text-gray-400 font-space mb-2 block">
            Stop Loss (opcional)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-space">
              R$
            </span>
            <input
              type="number"
              step="0.01"
              value={stopLoss || ''}
              onChange={(e) => setStopLoss(e.target.value ? parseFloat(e.target.value) : undefined)}
              className="cyber-input w-full pl-12"
            />
          </div>
        </div>

        {/* Take Profit */}
        <div>
          <label className="text-xs text-gray-400 font-space mb-2 block">
            Take Profit (opcional)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-space">
              R$
            </span>
            <input
              type="number"
              step="0.01"
              value={takeProfit || ''}
              onChange={(e) => setTakeProfit(e.target.value ? parseFloat(e.target.value) : undefined)}
              className="cyber-input w-full pl-12"
            />
          </div>
        </div>

        {/* Order Summary */}
        <div className="bg-cyber-dark/50 p-3 rounded border border-cyber-border space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400 font-space">Valor Total</span>
            <span className="font-jetbrains text-white">
              {formatPrice(totalValue)}
            </span>
          </div>
          {takeProfit && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400 font-space">Lucro Estimado</span>
              <span className={`font-jetbrains ${estimatedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {estimatedPnL >= 0 ? '+' : ''}{formatPrice(estimatedPnL)}
              </span>
            </div>
          )}
          {tickData && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400 font-space">Spread em $</span>
              <span className="font-jetbrains text-yellow-400">
                {formatPrice(spread * quantity)}
              </span>
            </div>
          )}
        </div>

        {/* Aviso: operação real na conta MT5 conectada */}
        <div className="flex items-start gap-2 bg-yellow-500/10 p-3 rounded border border-yellow-500/30">
          <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-yellow-200 font-space">
            Ordem enviada de verdade para a conta conectada no terminal MT5 — confira símbolo, quantidade e preço antes de enviar.
          </p>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full cyber-button font-bold text-lg ${
            orderType === 'BUY' ? 'cyber-button-primary' : 'bg-red-600 text-white'
          } disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
        >
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {isSubmitting ? 'ENVIANDO...' : orderType === 'BUY' ? 'ENVIAR ORDEM DE COMPRA' : 'ENVIAR ORDEM DE VENDA'}
        </button>
      </form>
    </div>
  );
}
