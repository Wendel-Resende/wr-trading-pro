"use client";

import { useState, useCallback } from 'react';
import { mt5Service } from '@/services/mt5Service';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface MT5ConnectionFormProps {
  onClose: () => void;
  onConnected: () => void;
}

export default function MT5ConnectionForm({ onClose, onConnected }: MT5ConnectionFormProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const ok = await mt5Service.connect();
      if (!ok) {
        const state = mt5Service.getConnectionState();
        setError(state.lastError || 'Não foi possível conectar ao MT5 MCP nativo');
        setIsConnecting(false);
        return;
      }
      setSuccess(true);
      setTimeout(() => {
        onConnected();
        onClose();
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível conectar ao MT5 MCP nativo');
      setIsConnecting(false);
    }
  }, [onClose, onConnected]);

  return (
    <div className="space-y-4">
      {success ? (
        <div className="text-center py-8">
          <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
          <p className="text-white font-orbitron text-lg">Conectado com Sucesso!</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-400 font-space">
            A conexão usa o MCP nativo do MetaTrader 5 (build 6060+) — sem login/senha pelo WR.
            Certifique-se de que o terminal MT5 está aberto, com uma conta logada e o servidor MCP
            interno ativado (Tools &gt; Options &gt; MCP).
          </p>

          {error && (
            <div className="bg-red-500/10 p-3 rounded border border-red-500/30 flex gap-2 items-start">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-200 font-space">{error}</p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              disabled={isConnecting}
              className="flex-1 cyber-button cyber-button-secondary"
              type="button"
            >
              Cancelar
            </button>
            <button
              onClick={() => void handleConnect()}
              disabled={isConnecting}
              className="flex-1 cyber-button cyber-button-primary"
              type="button"
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
          </div>
        </>
      )}
    </div>
  );
}
