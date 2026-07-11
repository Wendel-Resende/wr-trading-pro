"use client";

import { useState } from 'react';
import { Lock, User, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [credentials, setCredentials] = useState({
    username: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Validação básica
      if (!credentials.username.trim() || !credentials.password.trim()) {
        setError('Por favor, preencha todos os campos.');
        setLoading(false);
        return;
      }

      // Salvar credenciais no localStorage (para autenticação simples)
      // Em produção, isso deve ser substituído por um sistema de autenticação real
      const authData = {
        username: credentials.username,
        timestamp: Date.now(),
        isAuthenticated: true,
      };

      localStorage.setItem('wr_trading_auth', JSON.stringify(authData));

      // Redirecionar para o dashboard
      router.push('/');
    } catch (err) {
      setError('Erro ao fazer login. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cyber-darker flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo e Título */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-cyber-pink to-cyber-purple flex items-center justify-center shadow-lg shadow-cyber-pink/20">
            <Lock className="w-10 h-10 text-white" />
          </div>
          <h1 className="font-orbitron text-3xl font-bold text-white neon-text-pink mb-2">
            WR TRADING PRO
          </h1>
          <p className="text-gray-400 font-space">
            Acesso Restrito
          </p>
        </div>

        {/* Card de Login */}
        <div className="cyber-card bg-cyber-dark/80 border-2 border-cyber-border rounded-2xl p-8 hud-corner">
          {/* Aviso de Segurança */}
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6">
            <p className="text-yellow-400 text-sm font-space text-center">
              ⚠️ Área restrita. Use suas credenciais para acessar o sistema.
            </p>
          </div>

          {/* Formulário */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Username */}
            <div>
              <label className="block text-sm font-bold font-orbitron text-cyber-cyan uppercase tracking-wider mb-2">
                Usuário
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={credentials.username}
                  onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
                  placeholder="Digite seu usuário"
                  className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg pl-10 pr-4 py-3 text-white font-space focus:border-cyber-pink focus:ring-2 focus:ring-cyber-pink/20 transition-all outline-none"
                  disabled={loading}
                  autoFocus
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-bold font-orbitron text-cyber-cyan uppercase tracking-wider mb-2">
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={credentials.password}
                  onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                  placeholder="Digite sua senha"
                  className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg pl-10 pr-12 py-3 text-white font-space focus:border-cyber-pink focus:ring-2 focus:ring-cyber-pink/20 transition-all outline-none"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                  disabled={loading}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm font-space">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full cyber-button cyber-button-primary flex items-center justify-center gap-2 py-3"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Acessando...</span>
                </>
              ) : (
                <>
                  <span>Acessar Dashboard</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          {/* Informações de Segurança */}
          <div className="mt-6 pt-6 border-t border-cyber-border">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-cyber-cyan/20 border border-cyber-cyan/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-cyber-cyan text-xs font-bold">1</span>
                </div>
                <p className="text-sm text-gray-400 font-space">
                  Use suas credenciais do MetaTrader 5 para acessar
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-cyber-purple/20 border border-cyber-purple/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-cyber-purple text-xs font-bold">2</span>
                </div>
                <p className="text-sm text-gray-400 font-space">
                  Mantenha suas credenciais seguras e não as compartilhe
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-cyber-pink/20 border border-cyber-pink/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-cyber-pink text-xs font-bold">3</span>
                </div>
                <p className="text-sm text-gray-400 font-space">
                  Faça logout após o uso em ambientes compartilhados
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-500 font-space">
            © 2026 WR Trading Pro - Plataforma de Trading Avançada
          </p>
          <p className="text-xs text-gray-600 font-space mt-1">
            Todos os direitos reservados
          </p>
        </div>
      </div>
    </div>
  );
}
