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
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState({
    login: '',
    password: '',
    server: '',
  });
  const [clearSuccess, setClearSuccess] = useState(false);
  const [autoConnect, setAutoConnect] = useState(false);

  const handleConnect = useCallback(async (login?: string, password?: string, server?: string) => {
    const loginValue = login || config.login;
    const passwordValue = password || config.password;
    const serverValue = server || config.server;
    
    // eslint-disable-next-line no-console
    console.log('Valores de conexão:', {
      login: loginValue,
      password: passwordValue ? '***' : '',
      server: serverValue,
    });
    
    if (!loginValue || !passwordValue || !serverValue) {
      // eslint-disable-next-line no-console
      console.error('Credenciais incompletas:', {
        hasLogin: !!loginValue,
        hasPassword: !!passwordValue,
        hasServer: !!serverValue,
      });
      setShowConfig(true);
      return;
    }
    
    // Validar login é um número válido
    const loginNumber = parseInt(loginValue);
    if (isNaN(loginNumber)) {
      // eslint-disable-next-line no-console
      console.error('Login inválido:', loginValue);
      setIsConnecting(false);
      return;
    }
    
    setIsConnecting(true);
    
    // Timeout para resetar o estado de conexão se demorar muito
    const timeoutId = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error('Timeout de conexão MT5');
      setIsConnecting(false);
      setConnectionState({
        state: 'ERROR',
        isConnected: false,
        lastError: 'Timeout de conexão. Verifique se o MT5 Bridge está rodando.',
      });
    }, 30000); // 30 segundos
    
    try {
      // eslint-disable-next-line no-console
      console.log('Tentando conectar ao MT5:', {
        login: loginNumber,
        server: serverValue,
      });
      
      await mt5Service.connect({
        login: loginNumber,
        password: passwordValue,
        server: serverValue,
      });

      // Limpar timeout se a conexão for bem-sucedida
      clearTimeout(timeoutId);

      // Salvar configuração
      localStorage.setItem('mt5-config', JSON.stringify({
        login: loginValue,
        password: passwordValue,
        server: serverValue,
      }));
    } catch (error) {
      // Limpar timeout se houver erro
      clearTimeout(timeoutId);
      // eslint-disable-next-line no-console
      console.error('Failed to connect to MT5:', error);
      setIsConnecting(false);
    }
  }, [config]);

  // Carregar configuração do localStorage
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    
    const savedConfig = localStorage.getItem('mt5-config');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        setConfig({
          login: parsed.login || '',
          password: parsed.password || '',
          server: parsed.server || '',
        });

        // Marcar para conectar automaticamente se houver configuração completa E não estiver conectado
        const currentState = mt5Service.getConnectionState();
        if (parsed.login && parsed.password && parsed.server && currentState.state !== 'CONNECTED') {
          setAutoConnect(true);
        }
      } catch (error) {
        console.error('Failed to load MT5 config:', error);
      }
    }
  }, []);

  // Conectar automaticamente quando a flag for alterada
  useEffect(() => {
    if (autoConnect && config.login && config.password && config.server) {
      // eslint-disable-next-line no-console
      console.log('Configuração salva encontrada, conectando automaticamente...');
      // Usar setTimeout para garantir que o componente está montado
      const timer = setTimeout(() => {
        handleConnect(config.login, config.password, config.server);
        setAutoConnect(false);
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [autoConnect, config]);

  // Escutar eventos de conexão e sincronizar estado inicial
  useEffect(() => {
    // Sincronizar com o estado atual do serviço
    const currentState = mt5Service.getConnectionState();
    const wsReadyState = mt5Service.getWebSocketReadyState();
    // eslint-disable-next-line no-console
    console.log('=== MT5Connection mounted ===');
    console.log('Estado atual do MT5 Service:', currentState);
    console.log('WebSocket readyState:', wsReadyState);
    
    // Se o WebSocket está conectado, atualizar estado para CONNECTED
    if (wsReadyState === WebSocket.OPEN && currentState.state !== 'CONNECTED') {
      console.log('WebSocket está aberto, atualizando estado para CONNECTED');
      setConnectionState({
        ...currentState,
        state: 'CONNECTED',
        isConnected: true,
      });
      onConnected?.();
    } else {
      setConnectionState(currentState);
      if (currentState.state === 'CONNECTED') {
        onConnected?.();
      }
    }
    
    setIsConnecting(false);

    const handleStateChange = (state: MT5ConnectionStatus) => {
      // eslint-disable-next-line no-console
      console.log('Estado MT5 alterado:', state.state);
      setConnectionState(state);
      if (state.state === 'CONNECTED') {
        setIsConnecting(false);
        onConnected?.();
      } else if (state.state === 'DISCONNECTED') {
        setIsConnecting(false);
        // Não chamar onDisconnected se é apenas uma mudança de aba
        // onDisconnected?.();
      }
    };

    mt5Service.on('state', handleStateChange);

    return () => {
      // eslint-disable-next-line no-console
      console.log('=== MT5Connection unmounted ===');
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
          <>
            <button
              onClick={() => handleConnect()}
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
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="cyber-button cyber-button-secondary"
            >
              Config
            </button>
          </>
        )}
      </div>

      {showConfig && (
        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="mt5-login" className="text-xs text-gray-400 font-space mb-2 block">Login</label>
            <input
              type="number"
              value={config.login}
              onChange={(e) => {
                console.log('Login alterado:', e.target.value);
                setConfig({ ...config, login: e.target.value });
              }}
              className="cyber-input w-full text-white bg-cyber-dark"
              placeholder="Número da conta"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              id="mt5-login"
              name="mt5-login"
              disabled={isConnecting}
            />
          </div>
          <div>
            <label htmlFor="mt5-password" className="text-xs text-gray-400 font-space mb-2 block">Senha</label>
            <input
              type="password"
              value={config.password}
              onChange={(e) => {
                console.log('Senha alterada');
                setConfig({ ...config, password: e.target.value });
              }}
              className="cyber-input w-full text-white bg-cyber-dark"
              placeholder="Senha da conta"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              id="mt5-password"
              name="mt5-password"
              disabled={isConnecting}
            />
          </div>
          <div>
            <label htmlFor="mt5-server" className="text-xs text-gray-400 font-space mb-2 block">Servidor</label>
            <input
              type="text"
              value={config.server}
              onChange={(e) => {
                console.log('Servidor alterado:', e.target.value);
                setConfig({ ...config, server: e.target.value });
              }}
              className="cyber-input w-full text-white bg-cyber-dark"
              placeholder="Nome do servidor"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              id="mt5-server"
              name="mt5-server"
              disabled={isConnecting}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={(e) => {
                e.preventDefault();
                console.log('Botão Limpar clicado');
                localStorage.removeItem('mt5-config');
                setConfig({ login: '', password: '', server: '' });
                setIsConnecting(false);
                setConnectionState({
                  state: 'DISCONNECTED',
                  isConnected: false,
                });
                setClearSuccess(true);
                console.log('Credenciais limpas');
                setTimeout(() => setClearSuccess(false), 2000);
              }}
              disabled={isConnecting}
              className="flex-1 cyber-button cyber-button-secondary hover:bg-cyber-cyan/80 transition-colors"
              type="button"
            >
              {clearSuccess ? '✓ Limpo!' : 'Limpar'}
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                console.log('Botão Salvar e Conectar clicado');
                handleConnect();
              }}
              disabled={isConnecting}
              className="flex-1 cyber-button cyber-button-primary hover:bg-cyber-pink/80 transition-colors"
              type="button"
            >
              Salvar e Conectar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
