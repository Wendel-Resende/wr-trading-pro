"use client";

import { useState, useEffect } from 'react';
import { Play, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { MT5ServiceSingleton } from '@/services/mt5Service';
import { spreadOrderService } from '@/services/spreadOrderService';
import { MT5Tick } from '@/types/mt5';
import type { SpreadPendingOrder } from '@/types/spread';

interface SpreadOrderFormProps {
  symbol1?: string;
  symbol2?: string;
}

export default function SpreadOrderForm({ symbol1: initialSymbol1 = '', symbol2: initialSymbol2 = '' }: SpreadOrderFormProps) {
  const mt5Service = MT5ServiceSingleton.getInstance();
  
  // Estado da Boleta
  const [symbol1, setSymbol1] = useState(initialSymbol1);
  const [symbol2, setSymbol2] = useState(initialSymbol2);
  const [quantity1, setQuantity1] = useState(100);
  const [quantity2, setQuantity2] = useState(100);
  const [action1, setAction1] = useState<'buy' | 'sell'>('sell');
  const [action2, setAction2] = useState<'buy' | 'sell'>('buy');
  
  // Preços atuais
  const [price1, setPrice1] = useState<number | null>(null);
  const [price2, setPrice2] = useState<number | null>(null);
  
  // Estado da automação
  const [targetSpread, setTargetSpread] = useState<number>(0.20);
  const [condition, setCondition] = useState<'greater_than' | 'less_than' | 'equal_to'>('greater_than');
  const [sending, setSending] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Calcular spread atual (pode ser negativo)
  const currentSpread = price1 !== null && price2 !== null ? price1 - price2 : null;

  // Limpar mensagem de sucesso após 3 segundos
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Escutar ticks do MT5
  useEffect(() => {
    const handleTick = (tick: MT5Tick) => {
      if (tick.symbol === symbol1 && tick.bid) {
        setPrice1(tick.bid);
      }
      if (tick.symbol === symbol2 && tick.bid) {
        setPrice2(tick.bid);
      }
    };

    mt5Service.on('tick', handleTick);

    // Inscrever nos símbolos
    if (symbol1) mt5Service.subscribeTicks(symbol1);
    if (symbol2) mt5Service.subscribeTicks(symbol2);

    return () => {
      mt5Service.off('tick', handleTick);
      if (symbol1) mt5Service.unsubscribeTicks(symbol1);
      if (symbol2) mt5Service.unsubscribeTicks(symbol2);
    };
  }, [symbol1, symbol2]);

  // Escutar evento de execução de ordem
  useEffect(() => {
    const handleExecuteOrder = (order: SpreadPendingOrder) => {
      // Executar ordem via MT5 quando solicitado pelo serviço
      executeMT5Orders(order);
    };

    spreadOrderService.on('executeOrder', handleExecuteOrder);

    return () => {
      spreadOrderService.off('executeOrder', handleExecuteOrder);
    };
  }, []);

  const executeMT5Orders = async (order: SpreadPendingOrder) => {
    try {
      // Enviar ordem 1
      mt5Service.sendOrder({
        action: 'TRADE_ACTION_DEAL',
        symbol: order.symbol1,
        volume: order.quantity1,
        type: order.action1 === 'buy' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
        price: order.price1,
      });

      // Enviar ordem 2
      mt5Service.sendOrder({
        action: 'TRADE_ACTION_DEAL',
        symbol: order.symbol2,
        volume: order.quantity2,
        type: order.action2 === 'buy' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
        price: order.price2,
      });

      // Aguardar execução
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Marcar como executada com sucesso
      spreadOrderService.markAsExecuted(order.id);
    } catch (error) {
      console.error('Erro ao executar ordens MT5:', error);
      spreadOrderService.markAsExecuted(order.id, undefined, String(error));
    }
  };

  const handleSendOrders = async () => {
    if (!symbol1 || !symbol2 || price1 === null || price2 === null) {
      return;
    }

    setSending(true);

    try {
      // Executar ordens imediatamente
      const spreadValue = price1 - price2;
      const newOrder = await spreadOrderService.addPendingOrder({
        symbol1,
        symbol2,
        quantity1,
        quantity2,
        price1,
        price2,
        action1,
        action2,
        targetSpread: spreadValue,
        condition: 'equal_to',
      });

      // Executar imediatamente
      await executeMT5Orders(newOrder);

      setSuccessMessage('Ordens de spread executadas com sucesso!');
      
      // Limpar campos após executar
      setSymbol1('');
      setSymbol2('');
      setQuantity1(100);
      setQuantity2(100);
      setAction1('sell');
      setAction2('buy');
      setTargetSpread(0.20);
      setCondition('greater_than');
    } catch (error) {
      console.error('Erro ao executar ordens de spread:', error);
    } finally {
      setSending(false);
    }
  };

  const handleActivateAutomation = async () => {
    if (!symbol1 || !symbol2 || price1 === null || price2 === null) {
      return;
    }

    setSending(true);

    try {
      // Adicionar ordem pendente ao serviço
      spreadOrderService.addPendingOrder({
        symbol1,
        symbol2,
        quantity1,
        quantity2,
        price1,
        price2,
        action1,
        action2,
        targetSpread,
        condition,
      });

      setSuccessMessage('Automação ativada! Aguardando spread alvo...');
      
      // Limpar campos após ativar
      setSymbol1('');
      setSymbol2('');
      setQuantity1(100);
      setQuantity2(100);
      setAction1('sell');
      setAction2('buy');
      setTargetSpread(0.20);
      setCondition('greater_than');
    } catch (error) {
      console.error('Erro ao ativar automação:', error);
    } finally {
      setSending(false);
    }
  };

  const formatCurrency = (value: number) => {
    return `R$ ${value.toFixed(2)}`;
  };

  const ActionButton = ({ 
    action, 
    currentAction, 
    onClick 
  }: { 
    action: 'buy' | 'sell'; 
    currentAction: 'buy' | 'sell'; 
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className={`flex-1 py-2 px-4 rounded-lg font-orbitron font-bold transition-all ${
        currentAction === action
          ? action === 'buy'
            ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white neon-text-green'
            : 'bg-gradient-to-r from-red-500 to-rose-500 text-white neon-text-red'
          : 'bg-cyber-dark border border-cyber-border text-gray-400 hover:border-cyber-pink hover:text-white'
      }`}
    >
      {action === 'buy' ? (
        <>
          <TrendingUp className="w-4 h-4 inline mr-1" />
          COMPRAR
        </>
      ) : (
        <>
          <TrendingDown className="w-4 h-4 inline mr-1" />
          VENDER
        </>
      )}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Boleta Spread */}
      <div className="cyber-card p-4 hud-corner">
        <h2 className="font-orbitron text-lg font-bold text-white neon-text-cyan mb-4">
          Boleta Spread
        </h2>

        {/* Ação 1 */}
        <div className="bg-cyber-dark/50 border border-cyber-border rounded-lg p-3 mb-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex-1 mr-3">
              <label className="block text-xs font-space text-gray-400 mb-1">
                Ação 1
              </label>
              <input
                type="text"
                value={symbol1}
                onChange={(e) => setSymbol1(e.target.value.toUpperCase())}
                placeholder="Ex: PETR3"
                className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-3 py-1.5 text-sm text-white font-space focus:border-cyber-pink focus:outline-none transition-colors"
              />
            </div>
            <div className="text-right min-w-[100px]">
              <label className="block text-xs font-space text-gray-400 mb-1">
                Preço
              </label>
              <p className="text-lg font-bold font-orbitron text-cyan-400">
                {price1 !== null ? formatCurrency(price1) : '---'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs font-space text-gray-400 mb-1">
                Qtd
              </label>
              <input
                type="number"
                min="1"
                value={quantity1}
                onChange={(e) => setQuantity1(parseInt(e.target.value) || 100)}
                className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-3 py-1.5 text-sm text-white font-space focus:border-cyber-pink focus:outline-none transition-colors"
              />
            </div>
            <div className="flex gap-2 flex-1">
              <button
                onClick={() => setAction1('buy')}
                className={`flex-1 py-1.5 px-2 rounded-lg font-orbitron font-bold text-xs transition-all ${
                  action1 === 'buy'
                    ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white'
                    : 'bg-cyber-dark border border-cyber-border text-gray-400 hover:border-green-500 hover:text-white'
                }`}
              >
                <TrendingUp className="w-3 h-3 inline mr-1" />
                COMPRAR
              </button>
              <button
                onClick={() => setAction1('sell')}
                className={`flex-1 py-1.5 px-2 rounded-lg font-orbitron font-bold text-xs transition-all ${
                  action1 === 'sell'
                    ? 'bg-gradient-to-r from-red-500 to-rose-500 text-white'
                    : 'bg-cyber-dark border border-cyber-border text-gray-400 hover:border-red-500 hover:text-white'
                }`}
              >
                <TrendingDown className="w-3 h-3 inline mr-1" />
                VENDER
              </button>
            </div>
          </div>
        </div>

        {/* Ação 2 */}
        <div className="bg-cyber-dark/50 border border-cyber-border rounded-lg p-3 mb-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex-1 mr-3">
              <label className="block text-xs font-space text-gray-400 mb-1">
                Ação 2
              </label>
              <input
                type="text"
                value={symbol2}
                onChange={(e) => setSymbol2(e.target.value.toUpperCase())}
                placeholder="Ex: PETR4"
                className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-3 py-1.5 text-sm text-white font-space focus:border-cyber-pink focus:outline-none transition-colors"
              />
            </div>
            <div className="text-right min-w-[100px]">
              <label className="block text-xs font-space text-gray-400 mb-1">
                Preço
              </label>
              <p className="text-lg font-bold font-orbitron text-cyan-400">
                {price2 !== null ? formatCurrency(price2) : '---'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs font-space text-gray-400 mb-1">
                Qtd
              </label>
              <input
                type="number"
                min="1"
                value={quantity2}
                onChange={(e) => setQuantity2(parseInt(e.target.value) || 100)}
                className="w-full bg-cyber-dark border border-cyber-border rounded-lg px-3 py-1.5 text-sm text-white font-space focus:border-cyber-pink focus:outline-none transition-colors"
              />
            </div>
            <div className="flex gap-2 flex-1">
              <button
                onClick={() => setAction2('buy')}
                className={`flex-1 py-1.5 px-2 rounded-lg font-orbitron font-bold text-xs transition-all ${
                  action2 === 'buy'
                    ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white'
                    : 'bg-cyber-dark border border-cyber-border text-gray-400 hover:border-green-500 hover:text-white'
                }`}
              >
                <TrendingUp className="w-3 h-3 inline mr-1" />
                COMPRAR
              </button>
              <button
                onClick={() => setAction2('sell')}
                className={`flex-1 py-1.5 px-2 rounded-lg font-orbitron font-bold text-xs transition-all ${
                  action2 === 'sell'
                    ? 'bg-gradient-to-r from-red-500 to-rose-500 text-white'
                    : 'bg-cyber-dark border border-cyber-border text-gray-400 hover:border-red-500 hover:text-white'
                }`}
              >
                <TrendingDown className="w-3 h-3 inline mr-1" />
                VENDER
              </button>
            </div>
          </div>
        </div>

        {/* Spread Atual */}
        <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-lg p-3 mb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-purple-400" />
            <div>
              <p className="text-xs text-gray-400 font-space">Spread Atual</p>
              <p className={`text-xl font-bold font-orbitron ${
                currentSpread !== null && currentSpread < 0 ? 'text-red-400' : 'text-purple-400'
              }`}>
                {currentSpread !== null 
                  ? (currentSpread >= 0 ? '+ ' : '') + formatCurrency(currentSpread)
                  : '---'
                }
              </p>
            </div>
          </div>
        </div>

        {/* Botão Enviar Ordens */}
        <button
          onClick={handleSendOrders}
          disabled={sending || !symbol1 || !symbol2 || price1 === null || price2 === null}
          className="cyber-button cyber-button-primary w-full flex items-center justify-center gap-2 py-2 text-sm"
        >
          {sending ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Ativando...
            </>
          ) : (
            <>
              <TrendingUp className="w-4 h-4" />
              Ativar Ordem de Spread
            </>
          )}
        </button>

        {/* Mensagem de sucesso */}
        {successMessage && (
          <div className="mt-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
            <p className="text-sm font-orbitron font-bold text-green-400">
              {successMessage}
            </p>
          </div>
        )}
      </div>

      {/* Automação do Spread - Card Separado */}
      <div className="cyber-card p-4 hud-corner">
        <h2 className="font-orbitron text-lg font-bold text-white neon-text-pink mb-4">
          Automação por Spread
        </h2>

        <div className="space-y-3">
          {/* Valor Alvo */}
          <div>
            <label className="block text-xs font-space text-gray-400 mb-1">
              Valor Alvo
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                value={targetSpread}
                onChange={(e) => setTargetSpread(parseFloat(e.target.value) || 0)}
                className="flex-1 bg-cyber-dark border border-cyber-border rounded-lg px-3 py-1.5 text-sm text-white font-space focus:border-cyber-pink focus:outline-none transition-colors"
              />
              <div className="bg-cyber-dark border border-cyber-border rounded-lg px-3 py-1.5 text-gray-400 font-space text-xs">
                R$
              </div>
            </div>
          </div>

          {/* Condições */}
          <div>
            <label className="block text-xs font-space text-gray-400 mb-1">
              Condição
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setCondition('greater_than')}
                className={`flex-1 py-1.5 px-2 rounded-lg font-orbitron font-bold text-xs transition-all ${
                  condition === 'greater_than'
                    ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white'
                    : 'bg-cyber-dark border border-cyber-border text-gray-400 hover:border-green-500 hover:text-white'
                }`}
              >
                Maior que
              </button>
              <button
                onClick={() => setCondition('less_than')}
                className={`flex-1 py-1.5 px-2 rounded-lg font-orbitron font-bold text-xs transition-all ${
                  condition === 'less_than'
                    ? 'bg-gradient-to-r from-yellow-500 to-orange-500 text-white'
                    : 'bg-cyber-dark border border-cyber-border text-gray-400 hover:border-yellow-500 hover:text-white'
                }`}
              >
                Menor que
              </button>
              <button
                onClick={() => setCondition('equal_to')}
                className={`flex-1 py-1.5 px-2 rounded-lg font-orbitron font-bold text-xs transition-all ${
                  condition === 'equal_to'
                    ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                    : 'bg-cyber-dark border border-cyber-border text-gray-400 hover:border-blue-500 hover:text-white'
                }`}
              >
                Igual a
              </button>
            </div>
          </div>

          {/* Botão Ativar Automação */}
          <button
            onClick={handleActivateAutomation}
            disabled={sending || !symbol1 || !symbol2 || price1 === null || price2 === null}
            className="cyber-button cyber-button-pink w-full flex items-center justify-center gap-2 py-2 text-sm"
          >
            {sending ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Ativando...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Ativar Automação
              </>
            )}
          </button>

          {/* Explicação */}
          <div className="bg-cyber-dark/30 rounded-lg p-3">
            <p className="text-xs text-gray-400 font-space">
              A automação monitorará o spread entre {symbol1 || 'ação 1'} e {symbol2 || 'ação 2'} 
              e executará as ordens automaticamente quando o spread for {condition === 'greater_than' ? 'maior que' : condition === 'less_than' ? 'menor que' : 'igual a'} 
              R$ {targetSpread.toFixed(2)}.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}