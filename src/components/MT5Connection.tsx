"use client";

import { useState, useEffect, useCallback } from 'react';
import { mt5Service } from '@/services/mt5Service';
import { MT5ConnectionStatus } from '@/types/mt5';
import { Wifi, WifiOff, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';

interface MT5ConnectionProps {
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export default function MT5Connection({ onConnected, onDisconnected }: MT5ConnectionProps) {
  const [connectionState, setConnectionState] = useState<MT5ConnectionStatus>({
    state: 'DISCONNECTED',
    isConnected: false,
  });
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    try {
      await mt5Service.connect();
    } finally {
      setIsConnecting(false);
    }
  }, []);

  // Verifica o status do MT5 MCP nativo assim que o componente monta —
  // não exige credenciais, é só uma consulta somente-leitura.
  useEffect(() => {
    void handleConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setConnectionState(mt5Service.getConnectionState());

    const handleStateChange = (state: MT5ConnectionStatus) => {
      setConnectionState(state);
      if (state.state === 'CONNECTED') {
        setIsConnecting(false);
        onConnected?.();
      } else if (state.state === 'DISCONNECTED') {
        setIsConnecting(false);
        onDisconnected?.();
      } else if (state.state === 'ERROR') {
        setIsConnecting(false);
      }
    };

    mt5Service.on('state', handleStateChange);
    return () => {
      mt5Service.off('state', handleStateChange);
    };
  }, [onConnected, onDisconnected]);

  const handleDisconnect = () => {
    mt5Service.disconnect();
    setIsConnecting(false);
  };

  const getStatusIcon = () => {
    switch (connectionState.state) {
      case 'CONNECTED':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'CONNECTING':
        return <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />;
      case 'ERROR':
        return <AlertCircle className="w-4 h-4 text-red-400" />;
      default:
        return <WifiOff className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusText = () => {
    switch (connectionState.state) {
      case 'CONNECTED':
        return 'Conectado';
      case 'CONNECTING':
        return 'Conectando...';
      case 'ERROR':
        return 'Erro';
      default:
        return 'Desconectado';
    }
  };

  const getStatusColor = () => {
    switch (connectionState.state) {
      case 'CONNECTED':
        return 'text-green-400';
      case 'CONNECTING':
        return 'text-yellow-400';
      case 'ERROR':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="cyber-card p-4 hud-corner">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {connectionState.state === 'CONNECTED' ? (
            <Wifi className="w-5 h-5 text-green-400" />
          ) : (
            <WifiOff className="w-5 h-5 text-gray-400" />
          )}
          <h3 className="font-orbitron text-lg font-bold text-white">
            MetaTrader 5
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <span className={`text-sm font-space ${getStatusColor()}`}>
            {getStatusText()}
          </span>
        </div>
      </div>

      {connectionState.state === 'CONNECTED' && connectionState.accountInfo && (
        <div className="space-y-2 mb-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400 font-space">Conta</span>
            <span className="font-jetbrains text-white">
              {connectionState.accountInfo.login || 'N/A'}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400 font-space">Servidor</span>
            <span className="font-jetbrains text-white">
              {connectionState.accountInfo.server || 'N/A'}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400 font-space">Saldo</span>
            <span className="font-jetbrains text-cyber-cyan">
              {typeof connectionState.accountInfo.balance === 'number'
                ? connectionState.accountInfo.balance.toFixed(2)
                : '0.00'} {connectionState.accountInfo.currency || 'USD'}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400 font-space">Equity</span>
            <span className="font-jetbrains text-cyber-cyan">
              {typeof connectionState.accountInfo.equity === 'number'
                ? connectionState.accountInfo.equity.toFixed(2)
                : '0.00'} {connectionState.accountInfo.currency || 'USD'}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400 font-space">Margem Livre</span>
            <span className="font-jetbrains text-cyber-cyan">
              {typeof connectionState.accountInfo.marginFree === 'number'
                ? connectionState.accountInfo.marginFree.toFixed(2)
                : '0.00'} {connectionState.accountInfo.currency || 'USD'}
            </span>
          </div>
        </div>
      )}

      {connectionState.state === 'CONNECTED' && !connectionState.accountInfo && (
        <div className="bg-yellow-500/10 p-3 rounded border border-yellow-500/30 mb-4">
          <p className="text-xs text-yellow-200 font-space">
            {connectionState.lastError || 'MCP nativo conectado, mas nenhuma conta está logada no terminal. Faça login pela própria interface do MetaTrader 5.'}
          </p>
        </div>
      )}

      {connectionState.state === 'ERROR' && connectionState.lastError && (
        <div className="bg-red-500/10 p-3 rounded border border-red-500/30 mb-4">
          <p className="text-xs text-red-200 font-space">
            {connectionState.lastError}
          </p>
        </div>
      )}

      <div className="flex gap-2">
        {connectionState.state === 'CONNECTED' ? (
          <button
            onClick={handleDisconnect}
            disabled={isConnecting}
            className="flex-1 cyber-button cyber-button-secondary"
          >
            Desconectar
          </button>
        ) : (
          <button
            onClick={() => void handleConnect()}
            disabled={isConnecting}
            className="flex-1 cyber-button cyber-button-primary"
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Conectando...
              </>
            ) : (
              'Conectar'
            )}
          </button>
        )}
      </div>
    </div>
  );
}
