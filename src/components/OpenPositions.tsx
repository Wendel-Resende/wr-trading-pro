"use client";

import { useState, useEffect } from 'react';
import { mt5Service } from '@/services/mt5Service';
import { MT5Position } from '@/types/mt5';
import { ArrowUp, ArrowDown, Activity, X, Loader2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

export default function OpenPositions() {
  const toast = useToast();
  const [positions, setPositions] = useState<MT5Position[]>([]);
  const [closingTicket, setClosingTicket] = useState<number | null>(null);

  const handleClose = async (position: MT5Position) => {
    if (closingTicket !== null) return;
    setClosingTicket(position.ticket);
    try {
      await mt5Service.closePosition(position.ticket, position.symbol);
      setPositions((prev) => prev.filter((p) => p.ticket !== position.ticket));
      toast.success(`Posição ${position.symbol} fechada.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao fechar posição.');
    } finally {
      setClosingTicket(null);
    }
  };

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
                  type="button"
                  onClick={() => void handleClose(position)}
                  disabled={closingTicket !== null}
                  className="p-2 rounded-lg bg-red-600/80 hover:bg-red-600 text-white text-xs font-space flex items-center gap-1 disabled:opacity-50"
                  title="Fechar posição"
                >
                  {closingTicket === position.ticket ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <X className="w-3 h-3" />
                  )}
                  FECHAR
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
