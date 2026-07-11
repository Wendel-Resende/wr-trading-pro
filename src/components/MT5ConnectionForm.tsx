"use client";

import { useState, useCallback } from 'react';
import { mt5Service } from '@/services/mt5Service';
import { Loader2, CheckCircle } from 'lucide-react';

interface MT5ConnectionFormProps {
  onClose: () => void;
  onConnected: () => void;
}

export default function MT5ConnectionForm({ onClose, onConnected }: MT5ConnectionFormProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [config, setConfig] = useState(() => {
    if (typeof window === 'undefined') {
      return { login: '', password: '', server: '' };
    }
    const savedConfig = localStorage.getItem('mt5-config');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        return {
          login: parsed.login || '',
          password: parsed.password || '',
          server: parsed.server || '',
        };
      } catch (error) {
        console.error('Failed to load MT5 config:', error);
      }
    }
    return { login: '', password: '', server: '' };
  });

  const handleConnect = useCallback(async () => {
    if (!config.login || !config.password || !config.server) {
      console.error('Credenciais incompletas');
      return;
    }
    
    const loginNumber = parseInt(config.login);
    if (isNaN(loginNumber)) {
      console.error('Login inválido:', config.login);
      return;
    }
    
    setIsConnecting(true);
    
    const timeoutId = setTimeout(() => {
      console.error('Timeout de conexão MT5');
      setIsConnecting(false);
    }, 30000);
    
    try {
      await mt5Service.connect({
        login: loginNumber,
        password: config.password,
        server: config.server,
      });

      clearTimeout(timeoutId);

      localStorage.setItem('mt5-config', JSON.stringify(config));
      setSuccess(true);
      
      setTimeout(() => {
        onConnected();
        onClose();
      }, 500);
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('Failed to connect to MT5:', error);
      setIsConnecting(false);
    }
  }, [config, onClose, onConnected]);

  const handleClear = () => {
    localStorage.removeItem('mt5-config');
    setConfig({ login: '', password: '', server: '' });
  };

  return (
    <div className="space-y-4">
      {success ? (
        <div className="text-center py-8">
          <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
          <p className="text-white font-orbitron text-lg">Conectado com Sucesso!</p>
        </div>
      ) : (
        <>
          <div>
            <label htmlFor="mt5-login" className="text-xs text-gray-400 font-space mb-2 block">
              Login
            </label>
            <input
              type="number"
              value={config.login}
              onChange={(e) => setConfig({ ...config, login: e.target.value })}
              className="cyber-input w-full text-white bg-cyber-dark"
              placeholder="Número da conta"
              autoComplete="off"
              disabled={isConnecting}
            />
          </div>
          
          <div>
            <label htmlFor="mt5-password" className="text-xs text-gray-400 font-space mb-2 block">
              Senha
            </label>
            <input
              type="password"
              value={config.password}
              onChange={(e) => setConfig({ ...config, password: e.target.value })}
              className="cyber-input w-full text-white bg-cyber-dark"
              placeholder="Senha da conta"
              autoComplete="new-password"
              disabled={isConnecting}
            />
          </div>
          
          <div>
            <label htmlFor="mt5-server" className="text-xs text-gray-400 font-space mb-2 block">
              Servidor
            </label>
            <input
              type="text"
              value={config.server}
              onChange={(e) => setConfig({ ...config, server: e.target.value })}
              className="cyber-input w-full text-white bg-cyber-dark"
              placeholder="Nome do servidor"
              autoComplete="off"
              disabled={isConnecting}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleClear}
              disabled={isConnecting}
              className="flex-1 cyber-button cyber-button-secondary"
            >
              Limpar
            </button>
            <button
              onClick={handleConnect}
              disabled={isConnecting || !config.login || !config.password || !config.server}
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
          </div>
        </>
      )}
    </div>
  );
}
