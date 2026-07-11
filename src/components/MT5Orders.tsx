"use client";

import { useState, useEffect } from 'react';
import { mt5Service } from '@/services/mt5Service';
import { MT5Order, MT5Trade } from '@/types/mt5';
import { ArrowUp, ArrowDown, Clock, FileText } from 'lucide-react';

// Função para normalizar ordens (converter snake_case para camelCase e timestamps)
function normalizeOrder(order: any): MT5Order {
  // Função auxiliar para converter timestamp
  const convertTimestamp = (value: any): Date => {
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'number') {
      // Se já está em milissegundos (valor muito grande), usar diretamente
      if (value > 10000000000) {
        return new Date(value);
      }
      // Se está em segundos, multiplicar por 1000
      return new Date(value * 1000);
    }
    return new Date();
  };
  
  return {
    ticket: order.ticket,
    timeSetup: convertTimestamp(order.time_setup || order.timeSetup),
    timeSetupMsc: order.time_setup_msc || order.timeSetupMsc || 0,
    timeDone: convertTimestamp(order.time_done || order.timeDone),
    timeDoneMsc: order.time_done_msc || order.timeDoneMsc || 0,
    type: order.type,
    state: order.state,
    expiration: convertTimestamp(order.time_expiration || order.expiration),
    volume: order.volume ?? order.volume_initial, // Usar volume_initial se volume for None
    priceCurrent: order.price_current || order.priceCurrent || 0,
    priceStopLimit: order.price_stoplimit || order.priceStopLimit || 0,
    priceSl: order.sl || order.priceSl || 0,
    priceTp: order.tp || order.priceTp || 0,
    comment: order.comment,
    position: order.position_id || order.position || 0,
    positionBy: order.position_by_id || order.positionBy || 0,
    volumeInitial: order.volume_initial || order.volumeInitial || 0,
    volumeCurrent: order.volume_current || order.volumeCurrent || 0,
    priceOpen: order.price_open || order.price_current || order.priceCurrent || 0,
    magic: order.magic || 0,
    reason: order.reason || 0,
    symbol: order.symbol,
  };
}

// Função para normalizar trades (converter snake_case para camelCase e timestamps)
function normalizeTrade(trade: any): MT5Trade {
  // O mt5Service já converte o timestamp para Date, só precisamos manter como está
  // Se vier do servidor Python direto (snake_case), fazer conversão
  let tradeTime: Date;
  if (trade.time instanceof Date) {
    // Já está convertido, usar diretamente
    tradeTime = trade.time;
  } else if (typeof trade.time === 'number') {
    // Converter número (segundos ou milissegundos)
    if (trade.time > 10000000000) {
      // Já está em milissegundos
      tradeTime = new Date(trade.time);
    } else {
      // Está em segundos, converter para milissegundos
      tradeTime = new Date(trade.time * 1000);
    }
  } else {
    tradeTime = new Date();
  }
  
  return {
    ticket: trade.ticket,
    order: trade.order,
    time: tradeTime,
    timeMsc: trade.time_msc || trade.timeMsc || 0,
    type: trade.type,
    entry: trade.entry,
    magic: trade.magic,
    reason: trade.reason,
    position: trade.position || trade.position_id || 0,
    positionBy: trade.position_by || trade.position_by_id || 0,
    volume: trade.volume,
    price: trade.price,
    profit: trade.profit || 0,
    commission: trade.commission || 0,
    swap: trade.swap || 0,
    symbol: trade.symbol,
    comment: trade.comment,
  };
}

export default function MT5Orders() {
  const [orders, setOrders] = useState<MT5Order[]>([]);
  const [trades, setTrades] = useState<MT5Trade[]>([]);
  const [activeTab, setActiveTab] = useState<'orders' | 'trades'>('orders');

  useEffect(() => {
    // Carregar dados do cache inicialmente
    const cachedOrders = mt5Service.getOrdersCache();
    const cachedTrades = mt5Service.getTradesCache();
    if (cachedOrders.length > 0) {
      setOrders(cachedOrders);
    }
    if (cachedTrades.length > 0) {
      setTrades(cachedTrades);
    }

    // Escutar eventos de ordem e trade do MT5
    const handleOrder = (order: any) => {
      // Converter timestamps para Date se necessário
      const normalizedOrder = normalizeOrder(order);
      setOrders(prev => {
        const index = prev.findIndex(o => o.ticket === normalizedOrder.ticket);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = normalizedOrder;
          return updated;
        }
        return [normalizedOrder, ...prev];
      });
    };

    const handleTrade = (trade: any) => {
      // Converter timestamps para Date se necessário
      const normalizedTrade = normalizeTrade(trade);
      setTrades(prev => {
        const index = prev.findIndex(t => t.ticket === normalizedTrade.ticket);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = normalizedTrade;
          return updated;
        }
        return [normalizedTrade, ...prev];
      });
    };

    const handleStateChange = (state: any) => {
      if (state.state === 'CONNECTED') {
        // Solicitar ordens e histórico ao conectar
        mt5Service.getOrders();
        mt5Service.getHistory();
      } else if (state.state === 'DISCONNECTED') {
        setOrders([]);
        setTrades([]);
      }
    };

    mt5Service.on('order', handleOrder);
    mt5Service.on('trade', handleTrade);
    mt5Service.on('state', handleStateChange);

    // Se já estiver conectado, solicitar dados
    const currentState = mt5Service.getConnectionState();
    if (currentState.state === 'CONNECTED') {
      mt5Service.getOrders();
      mt5Service.getHistory();
    }

    return () => {
      mt5Service.off('order', handleOrder);
      mt5Service.off('trade', handleTrade);
      mt5Service.off('state', handleStateChange);
    };
  }, []);

  // Mapeamento de tipos de ordem (números do MT5)
  const getOrderTypeIcon = (type: number) => {
    // 0 = ORDER_TYPE_BUY, 1 = ORDER_TYPE_SELL, 2 = ORDER_TYPE_BUY_LIMIT, 3 = ORDER_TYPE_SELL_LIMIT
    // 4 = ORDER_TYPE_BUY_STOP, 5 = ORDER_TYPE_SELL_STOP, 6 = ORDER_TYPE_BUY_STOP_LIMIT, 7 = ORDER_TYPE_SELL_STOP_LIMIT
    if (type === 0 || type === 2 || type === 4 || type === 6) {
      return <ArrowUp className="w-4 h-4 text-green-400" />;
    }
    return <ArrowDown className="w-4 h-4 text-red-400" />;
  };

  const getOrderTypeText = (type: number) => {
    const typeMap: { [key: number]: string } = {
      0: 'Compra',
      1: 'Venda',
      2: 'Compra Limite',
      3: 'Venda Limite',
      4: 'Compra Stop',
      5: 'Venda Stop',
      6: 'Compra Stop Limite',
      7: 'Venda Stop Limite',
    };
    return typeMap[type] || `Tipo ${type}`;
  };

  // Mapeamento de estados de ordem (números do MT5)
  const getOrderStateColor = (state: number) => {
    const stateMap: { [key: number]: string } = {
      0: 'text-yellow-400',  // ORDER_STATE_STARTED
      1: 'text-yellow-400',  // ORDER_STATE_PLACED
      2: 'text-gray-400',    // ORDER_STATE_CANCELED
      3: 'text-blue-400',    // ORDER_STATE_PARTIAL
      4: 'text-green-400',   // ORDER_STATE_FILLED
      5: 'text-red-400',     // ORDER_STATE_REJECTED
      6: 'text-orange-400',  // ORDER_STATE_EXPIRED
    };
    return stateMap[state] || 'text-gray-400';
  };

  const getOrderStateText = (state: number) => {
    const stateMap: { [key: number]: string } = {
      0: 'Iniciada',
      1: 'Colocada',
      2: 'Cancelada',
      3: 'Parcial',
      4: 'Preenchida',
      5: 'Rejeitada',
      6: 'Expirada',
    };
    return stateMap[state] || `Estado ${state}`;
  };

  return (
    <div className="cyber-card p-6 hud-corner">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-orbitron text-2xl font-bold text-white neon-text-cyan">
          Histórico de Ordens
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('orders')}
            className={`cyber-badge text-sm ${
              activeTab === 'orders'
                ? 'bg-cyber-cyan/20 text-cyber-cyan border-cyber-cyan'
                : 'bg-cyber-dark text-gray-400 border-cyber-border'
            }`}
          >
            <FileText className="w-4 h-4 inline mr-1" />
            Ordens
          </button>
          <button
            onClick={() => setActiveTab('trades')}
            className={`cyber-badge text-sm ${
              activeTab === 'trades'
                ? 'bg-cyber-cyan/20 text-cyber-cyan border-cyber-cyan'
                : 'bg-cyber-dark text-gray-400 border-cyber-border'
            }`}
          >
            <Clock className="w-4 h-4 inline mr-1" />
            Trades
          </button>
        </div>
      </div>

      {activeTab === 'orders' && (
        <div className="space-y-2">
          {orders.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400 font-space">Nenhuma ordem encontrada</p>
            </div>
          ) : (
            orders.map((order) => (
              <div
                key={order.ticket}
                className="flex items-center justify-between p-4 bg-cyber-dark/50 rounded border border-cyber-border hover:border-cyber-cyan/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  {getOrderTypeIcon(order.type)}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-bold font-orbitron text-white">
                        {order.symbol}
                      </p>
                      <span className="text-xs text-gray-400 font-space">
                        #{order.ticket}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-gray-400 font-space">
                        {getOrderTypeText(order.type)}
                      </span>
                      <span className="text-gray-400 font-space">
                        {order.volumeCurrent || order.volume} lotes
                      </span>
                      <span className="text-cyber-cyan font-space">
                        R$ {((order.priceOpen || order.priceCurrent || 0) as number).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${getOrderStateColor(order.state)}`}>
                    {getOrderStateText(order.state)}
                  </p>
                  <p className="text-xs text-gray-400 font-space">
                    {order.timeSetup ? new Date(order.timeSetup).toLocaleString('pt-BR') : '---'}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'trades' && (
        <div className="space-y-2">
          {trades.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400 font-space">Nenhum trade encontrado</p>
            </div>
          ) : (
            trades.map((trade) => (
              <div
                key={trade.ticket}
                className="flex items-center justify-between p-4 bg-cyber-dark/50 rounded border border-cyber-border hover:border-cyber-cyan/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  {getOrderTypeIcon(trade.type)}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-bold font-orbitron text-white">
                        {trade.symbol}
                      </p>
                      <span className="text-xs text-gray-400 font-space">
                        #{trade.ticket}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-gray-400 font-space">
                        {trade.type === 0 ? 'Compra' : 'Venda'}
                      </span>
                      <span className="text-gray-400 font-space">
                        {trade.volume} lotes
                      </span>
                      <span className="text-cyber-cyan font-space">
                        R$ {(trade.price || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${trade.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {trade.profit >= 0 ? '+' : ''}R$ {trade.profit.toFixed(2)}
                  </p>
                  <p className="text-xs text-gray-400 font-space">
                    {new Date(trade.time).toLocaleString('pt-BR')}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
