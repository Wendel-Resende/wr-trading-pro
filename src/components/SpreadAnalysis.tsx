"use client";

import { useState } from 'react';
import { Loader2, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { spreadService } from '@/services/spreadService';
import { SpreadResult, SpreadMetrics, SpreadOpportunity, ESTRATEGIA } from '@/types/spread';

interface SpreadAnalysisProps {
  symbol1: string;
  symbol2: string;
  startDate: Date;
  endDate: Date;
  ganhoMinimo: number;
  onAnalyze: (result: SpreadResult | null) => void;
}

export default function SpreadAnalysis({
  symbol1,
  symbol2,
  startDate,
  endDate,
  ganhoMinimo,
  onAnalyze
}: SpreadAnalysisProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SpreadResult | null>(null);
  const [metrics, setMetrics] = useState<SpreadMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    setLoading(true);
    setResult(null);
    setMetrics(null);
    setError(null);

    try {
      const spreadResult = await spreadService.calcularSpread({
        symbol1: symbol1.toUpperCase(),
        symbol2: symbol2.toUpperCase(),
        startDate,
        endDate,
        ganhoMinimo
      });

      if (!spreadResult) {
        setError('Não foi possível obter dados dos ativos. Verifique se o MetaTrader 5 está conectado na página principal do Dashboard.');
        onAnalyze(null);
      } else {
        setResult(spreadResult);
        setMetrics(spreadService.calcularMetrics(spreadResult));
        onAnalyze(spreadResult);
      }
    } catch (error) {
      console.error('Erro ao analisar spread:', error);
      setError('Erro ao analisar spread. Verifique a conexão com o MetaTrader 5.');
      onAnalyze(null);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('pt-BR');
  };

  const formatCurrency = (value: number) => {
    return `R$ ${value.toFixed(2)}`;
  };

  const OportunidadeRow = ({ op, index }: { op: SpreadOpportunity; index: number }) => (
    <tr className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
      <td className="px-4 py-3 text-sm text-gray-300 font-space">
        {formatDate(op.dataEntrada)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-300 font-space">
        {formatDate(op.dataSaida)}
      </td>
      <td className="px-4 py-3 text-sm text-white font-space font-medium">
        {formatCurrency(op.precoVendaA1)}
      </td>
      <td className="px-4 py-3 text-sm text-white font-space font-medium">
        {formatCurrency(op.precoCompraB1)}
      </td>
      <td className="px-4 py-3 text-sm text-white font-space font-medium">
        {formatCurrency(op.precoVendaB2)}
      </td>
      <td className="px-4 py-3 text-sm text-white font-space font-medium">
        {formatCurrency(op.precoCompraA2)}
      </td>
      <td className="px-4 py-3 text-sm text-green-400 font-space font-bold">
        {formatCurrency(op.ganho)}
      </td>
      <td className="px-4 py-3 text-sm text-cyan-400 font-space">
        {op.retornoPercentual.toFixed(2)}%
      </td>
      <td className="px-4 py-3 text-sm text-gray-400 font-space">
        {op.volumeMedioA.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
      </td>
      <td className="px-4 py-3 text-sm text-gray-400 font-space">
        {op.volumeMedioB.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
      </td>
    </tr>
  );

  return (
    <div className="space-y-6">
      {/* Estratégia */}
      <div className="cyber-card p-6 hud-corner">
        <h3 className="font-orbitron text-lg font-bold text-white neon-text-pink mb-4">
          Estratégia de Spread
        </h3>
        <pre className="text-sm text-gray-300 font-space whitespace-pre-wrap bg-cyber-dark/50 p-4 rounded-lg border border-cyber-border">
          {ESTRATEGIA}
        </pre>
      </div>

      {/* Mensagem de Erro */}
      {error && (
        <div className="cyber-card p-6 hud-corner border-l-4 border-l-red-500 bg-red-500/10">
          <div className="flex items-start gap-3">
            <div className="text-red-400 mt-1">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-orbitron text-lg font-bold text-red-400 mb-2">
                Erro na Análise
              </h4>
              <p className="text-gray-300 font-space text-sm leading-relaxed">
                {error}
              </p>
              <div className="mt-4 bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                <p className="text-gray-400 font-space text-sm mb-2">
                  Para usar a análise de spread:
                </p>
                <ol className="text-gray-400 font-space text-sm list-decimal list-inside space-y-1">
                  <li>Abra a página principal do Dashboard</li>
                  <li>Conecte ao MetaTrader 5 (botão "Conectar" no topo)</li>
                  <li>Volte para esta página e clique em "Analisar Oportunidades"</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Botão de Análise */}
      <button
        onClick={handleAnalyze}
        disabled={loading || !symbol1 || !symbol2}
        className="cyber-button cyber-button-primary w-full flex items-center justify-center gap-2 py-4"
      >
        {loading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Analisando...
          </>
        ) : (
          'Analisar Oportunidades'
        )}
      </button>

      {/* Resultados */}
      {result && metrics && (
        <div className="space-y-6">
          {/* Preços Atuais */}
          <div className="cyber-card p-6 hud-corner">
            <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan mb-4">
              Preços Atuais
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 border border-blue-500/30 rounded-lg p-4">
                <p className="text-sm text-gray-400 font-space mb-2">{symbol1.toUpperCase()}</p>
                <p className="text-3xl font-bold font-orbitron text-blue-400">
                  {formatCurrency(result.currentPrice1)}
                </p>
              </div>
              <div className="bg-gradient-to-br from-red-500/10 to-red-600/10 border border-red-500/30 rounded-lg p-4">
                <p className="text-sm text-gray-400 font-space mb-2">{symbol2.toUpperCase()}</p>
                <p className="text-3xl font-bold font-orbitron text-red-400">
                  {formatCurrency(result.currentPrice2)}
                </p>
              </div>
            </div>
          </div>

          {/* Métricas Estatísticas */}
          <div className="cyber-card p-6 hud-corner">
            <h3 className="font-orbitron text-lg font-bold text-white neon-text-purple mb-4">
              Métricas Estatísticas
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <MetricCard
                title="Ganho Médio"
                value={formatCurrency(metrics.ganhoMedio)}
                subtitle={`${metrics.retornoMedio.toFixed(2)}%`}
                icon={<TrendingUp className="w-5 h-5" />}
                positive={metrics.ganhoMedio > 0}
              />
              <MetricCard
                title="Spread Atual"
                value={formatCurrency(metrics.spreadAtual)}
                icon={<Activity className="w-5 h-5" />}
              />
              <MetricCard
                title="Oportunidades"
                value={metrics.totalOportunidades.toString()}
                icon={<TrendingUp className="w-5 h-5" />}
              />
              <MetricCard
                title="Maior Ganho"
                value={formatCurrency(metrics.maiorGanho)}
                icon={<TrendingUp className="w-5 h-5" />}
                positive={true}
              />
              <MetricCard
                title="Melhor Retorno"
                value={`${metrics.melhorRetorno.toFixed(2)}%`}
                icon={<TrendingUp className="w-5 h-5" />}
                positive={true}
              />
            </div>
          </div>

          {/* Tabela de Oportunidades */}
          {result.oportunidades.length > 0 ? (
            <div className="cyber-card p-6 hud-corner overflow-x-auto">
              <h3 className="font-orbitron text-lg font-bold text-white neon-text-pink mb-4">
                Oportunidades Encontradas: {result.oportunidades.length}
              </h3>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-cyber-border">
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Data Entrada
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Data Saída
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Venda {symbol1.toUpperCase()}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Compra {symbol2.toUpperCase()}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Venda {symbol2.toUpperCase()}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Recompra {symbol1.toUpperCase()}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Ganho
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Retorno
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Volume {symbol1.toUpperCase()}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Volume {symbol2.toUpperCase()}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.oportunidades.map((op, index) => (
                    <OportunidadeRow key={index} op={op} index={index} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="cyber-card p-8 hud-corner text-center">
              <p className="text-gray-400 font-space">
                Nenhuma oportunidade encontrada com ganho mínimo de {formatCurrency(ganhoMinimo)}
              </p>
            </div>
          )}

          {/* Oportunidades por Mês */}
          {result.oportunidadesPorMes && Object.keys(result.oportunidadesPorMes).length > 0 && (
            <div className="cyber-card p-6 hud-corner">
              <h3 className="font-orbitron text-lg font-bold text-white neon-text-green mb-4">
                Oportunidades por Mês
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-cyber-border">
                      <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                        Mês
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                        Quantidade
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                        Distribuição
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.oportunidadesPorMes)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([mes, quantidade]) => {
                        const maxQuantity = Math.max(...Object.values(result.oportunidadesPorMes!));
                        const percentage = (quantidade / maxQuantity) * 100;
                        
                        return (
                          <tr key={mes} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                            <td className="px-4 py-3 text-sm text-white font-space font-medium">
                              {mes}
                            </td>
                            <td className="px-4 py-3 text-sm text-cyan-400 font-space font-bold">
                              {quantidade}
                            </td>
                            <td className="px-4 py-3">
                              <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                                <div 
                                  className="bg-gradient-to-r from-green-500 to-cyan-500 h-full transition-all duration-500"
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 p-4 bg-cyber-dark/50 rounded-lg border border-cyber-border">
                <p className="text-sm text-gray-400 font-space">
                  <span className="text-white font-bold">Total:</span> {result.oportunidades.length} oportunidades encontradas em {Object.keys(result.oportunidadesPorMes).length} mês(es)
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetricCard({ title, value, subtitle, icon, positive }: any) {
  return (
    <div className="bg-cyber-dark/50 border border-cyber-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400 font-space">{title}</span>
        <div className={positive ? 'text-green-400' : 'text-cyber-cyan'}>
          {icon}
        </div>
      </div>
      <p className="text-xl font-bold font-orbitron text-white mb-1">{value}</p>
      {subtitle && (
        <p className={`text-sm font-space ${positive ? 'text-green-400' : 'text-gray-400'}`}>
          {subtitle}
        </p>
      )}
    </div>
  );
}