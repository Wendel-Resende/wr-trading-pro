"use client";

import { useState, useEffect } from 'react';
import { mt5Service } from '@/services/mt5Service';
import { MT5Position } from '@/types/mt5';
import { ArrowUp, ArrowDown, X, Activity } from 'lucide-react';

export default function OpenPositions() {
  const [positions, setPositions] = useState<MT5Position[]>([]);
  const [closingPositions, setClosingPositions] = useState<Set<number>>(new Set());

  const totalProfit = positions.reduce((sum: number, pos: MT5Position) => sum + (pos.profit ?? 0), 0);

  useEffect(() => {
    // Carregar posições iniciais do cache
    const cachedPositions = mt5Service.getPositionsCache();
    if (cachedPositions.length > 0) {
      setPositions(cachedPositions);
    }

    // Escutar eventos de posição do MT5
    const handlePosition = (position: MT5Position) => {
      console.log('Posição recebida:', position);
      
      setPositions(prev => {
        // Atualizar posição existente ou adicionar nova
        const index = prev.findIndex(p => p.ticket === position.ticket);
        if (index >= 0) {
          // Atualizar posição existente
          const updated = [...prev];
          updated[index] = position;
          console.log('Posição atualizada:', position);
          return updated;
        }
        
        // Adicionar nova posição
        console.log('Nova posição adicionada:', position);
        return [position, ...prev];
      });
    };

    const handleStateChange = (state: any) => {
      if (state.state === 'CONNECTED') {
        // Solicitar posições ao conectar
        mt5Service.getPositions();
      } else if (state.state === 'DISCONNECTED') {
        setPositions([]);
      }
    };

    const handleTrade = (trade: any) => {
      console.log('Trade recebido:', trade);
      // Se é um fechamento (entry === 1), remover a posição correspondente
      if (trade.entry === 1 && trade.position) {
        console.log('Fechamento de posição (trade):', trade.position);
        setPositions(prev => prev.filter(p => p.ticket !== trade.position));
      }
    };

    const handlePositionClosed = (ticket: number) => {
      console.log('=== POSIÇÃO FECHADA ===');
      console.log('Ticket:', ticket);
      setPositions(prev => prev.filter(p => p.ticket !== ticket));
    };

    mt5Service.on('position', handlePosition);
    mt5Service.on('state', handleStateChange);
    mt5Service.on('trade', handleTrade);
    mt5Service.on('positionClosed', handlePositionClosed);

    // Se já estiver conectado, solicitar posições
    const currentState = mt5Service.getConnectionState();
    if (currentState.state === 'CONNECTED') {
      mt5Service.getPositions();
    }

    return () => {
      mt5Service.off('position', handlePosition);
      mt5Service.off('state', handleStateChange);
      mt5Service.off('trade', handleTrade);
      mt5Service.off('positionClosed', handlePositionClosed);
    };
  }, []);

  const handleClosePosition = async (ticket: number) => {
    console.log('=== FECHAR POSIÇÃO ===');
    console.log('Ticket:', ticket);
    
    const position = positions.find(p => p.ticket === ticket);
    console.log('Posição encontrada:', position);
    
    if (!position) {
      console.error('Posição não encontrada!');
      return;
    }

    setClosingPositions(prev => new Set(prev).add(ticket));

    try {
      console.log('Enviando comando para fechar posição...');
      // Usar o método closePosition do mt5Service
      mt5Service.closePosition(ticket, position.volume ?? 0);
      console.log('Comando enviado com sucesso!');
      
      // Solicitar atualização das posições e da conta após tentar fechar
      setTimeout(() => {
        console.log('[OpenPositions] Solicitando atualização de posições e conta após fechamento');
        mt5Service.getPositions();
        mt5Service.getAccountInfo();
      }, 1000);
    } catch (error) {
      console.error('Erro ao fechar posição:', error);
    } finally {
      setClosingPositions(prev => {
        const newSet = new Set(prev);
        newSet.delete(ticket);
        return newSet;
      });
    }
  };

  const getOrderTypeIcon = (type: string) => {
    return type === 'BUY' ? (
      <ArrowUp className="w-4 h-4 text-green-400" />
    ) : (
      <ArrowDown className="w-4 h-4 text-red-400" />
    );
  };

  const getOrderTypeText = (type: string) => {
    return type === 'BUY' ? 'COMPRA' : 'VENDA';
  };

  return (
    <div className="cyber-card p-4 hud-corner h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-cyber-pink" />
          <h3 className="font-orbitron text-lg font-bold text-white neon-text-pink">
            Posições Abertas
          </h3>
        </div>
        <div className={`font-jetbrains text-sm ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {totalProfit >= 0 ? '+' : ''}R$ {totalProfit.toFixed(2)}
        </div>
      </div>

      {positions.length === 0 ? (
        <div className="text-center py-12">
          <Activity className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 font-space">Nenhuma posição aberta</p>
        </div>
      ) : (
        <div className="space-y-2">
          {positions.map((position) => (
            <div
              key={position.ticket}
              className="group relative flex items-center justify-between p-3 bg-cyber-dark/50 rounded border border-cyber-border hover:border-cyber-pink/50 transition-all"
            >
              <div className="flex items-center gap-3">
                {getOrderTypeIcon(position.type)}
                <div className="flex-1">
                  <p className="font-bold font-orbitron text-white">
                    {position.symbol}
                  </p>
                  <div className="flex items-center gap-3 text-xs mt-1">
                    <span className="text-gray-400 font-space">
                      {getOrderTypeText(position.type)}
                    </span>
                    <span className="text-gray-400 font-space">
                      {(position.volume ?? 0).toFixed(2)} lotes
                    </span>
                      <span className="text-gray-500 font-space">
                      @ R$ {(position.priceOpen ?? 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className={`text-sm font-bold ${(position.profit ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {(position.profit ?? 0) >= 0 ? '+' : ''}R$ {(position.profit ?? 0).toFixed(2)}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    console.log('BOTÃO CLICADO! Ticket:', position.ticket);
                    e.stopPropagation();
                    handleClosePosition(position.ticket);
                  }}
                  disabled={closingPositions.has(position.ticket)}
                  className="p-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer pointer-events-auto"
                  title={`Fechar posição #${position.ticket}`}
                  style={{ zIndex: 9999, position: 'relative' }}
                >
                  {closingPositions.has(position.ticket) ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <X className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
