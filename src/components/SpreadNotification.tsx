import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, X, Volume2, VolumeX } from 'lucide-react';
import { spreadOrderService } from '@/services/spreadOrderService';
import type { SpreadPendingOrder } from '@/types/spread';

export default function SpreadNotification() {
  const [notifications, setNotifications] = useState<Array<{
    id: string;
    order: SpreadPendingOrder;
    type: 'executed' | 'failed';
  }>>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Tocar som de dinheiro (cash register)
  const playCashSound = () => {
    if (!soundEnabled || typeof window === 'undefined') return;

    try {
      // Criar contexto de áudio
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Criar oscilador para simular som de caixa registradora
      const playTone = (freq: number, startTime: number, duration: number) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = freq;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        
        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
      };

      const now = audioContext.currentTime;
      
      // Som de "ca-ching" (duas notas)
      playTone(1200, now, 0.1);      // Nota alta
      playTone(1800, now + 0.1, 0.15); // Nota mais alta
      
    } catch (error) {
      console.error('Erro ao tocar som:', error);
    }
  };

  useEffect(() => {
    // Escutar eventos de ordem executada
    const handleOrderExecuted = (order: SpreadPendingOrder) => {
      const id = `notif_${Date.now()}_${Math.random()}`;
      setNotifications(prev => [...prev, { id, order, type: 'executed' }]);
      
      // Tocar som de dinheiro
      playCashSound();
      
      // Remover após 5 segundos
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }, 5000);
    };

    // Escutar eventos de ordem falha
    const handleOrderFailed = (order: SpreadPendingOrder) => {
      const id = `notif_${Date.now()}_${Math.random()}`;
      setNotifications(prev => [...prev, { id, order, type: 'failed' }]);
      
      // Remover após 5 segundos
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }, 5000);
    };

    spreadOrderService.on('orderExecuted', handleOrderExecuted);
    spreadOrderService.on('orderFailed', handleOrderFailed);

    return () => {
      spreadOrderService.off('orderExecuted', handleOrderExecuted);
      spreadOrderService.off('orderFailed', handleOrderFailed);
    };
  }, [soundEnabled]);

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const formatCurrency = (value: number) => {
    return `R$ ${value.toFixed(2)}`;
  };

  if (notifications.length === 0) return null;

  return (
    <>
      {/* Container de Notificações */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
        {notifications.map((notif) => (
          <div
            key={notif.id}
            className={`cyber-card border-l-4 p-4 shadow-lg animate-in slide-in-from-right duration-300 ${
              notif.type === 'executed'
                ? 'border-green-500 bg-green-500/10'
                : 'border-red-500 bg-red-500/10'
            }`}
          >
            <div className="flex items-start gap-3">
              {/* Ícone */}
              <div className={`flex-shrink-0 ${
                notif.type === 'executed' ? 'text-green-400' : 'text-red-400'
              }`}>
                {notif.type === 'executed' ? (
                  <CheckCircle className="w-6 h-6" />
                ) : (
                  <XCircle className="w-6 h-6" />
                )}
              </div>

              {/* Conteúdo */}
              <div className="flex-1 min-w-0">
                {notif.type === 'executed' ? (
                  <>
                    <p className="font-bold text-white font-orbitron text-sm">
                      Ordem Executada! 💰
                    </p>
                    <p className="text-xs text-gray-400 font-space mt-1">
                      {notif.order.symbol1} / {notif.order.symbol2}
                    </p>
                    <p className={`text-sm font-bold font-orbitron mt-1 ${
                      notif.order.profit && notif.order.profit >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      Lucro: {notif.order.profit && notif.order.profit >= 0 ? '+' : ''}
                      {formatCurrency(notif.order.profit || 0)}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-bold text-white font-orbitron text-sm">
                      Ordem Falhou ❌
                    </p>
                    <p className="text-xs text-gray-400 font-space mt-1">
                      {notif.order.symbol1} / {notif.order.symbol2}
                    </p>
                    {notif.order.error && (
                      <p className="text-xs text-red-400 font-space mt-1">
                        {notif.order.error}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Botão Fechar */}
              <button
                onClick={() => removeNotification(notif.id)}
                className="flex-shrink-0 p-1 hover:bg-white/10 rounded transition-colors"
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Toggle de Som */}
      <button
        onClick={() => setSoundEnabled(!soundEnabled)}
        className="fixed bottom-4 right-4 z-50 cyber-card p-3 rounded-lg hover:border-cyber-pink transition-colors"
        title={soundEnabled ? 'Desativar som' : 'Ativar som'}
      >
        {soundEnabled ? (
          <Volume2 className="w-5 h-5 text-green-400" />
        ) : (
          <VolumeX className="w-5 h-5 text-gray-400" />
        )}
      </button>
    </>
  );
}