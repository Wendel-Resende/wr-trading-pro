"use client";

import { useState } from 'react';
import { Loader2, Trophy, TrendingUp, Target, Award, Activity } from 'lucide-react';
import { spreadService } from '@/services/spreadService';
import { SpreadRanking, SpreadPairAnalysis } from '@/types/spread';

interface SpreadPairsFinderProps {
  startDate: Date;
  endDate: Date;
  ganhoMinimo: number;
}

export default function SpreadPairsFinder({
  startDate,
  endDate,
  ganhoMinimo
}: SpreadPairsFinderProps) {
  const [loading, setLoading] = useState(false);
  const [ranking, setRanking] = useState<SpreadRanking | null>(null);
  const [allPairs, setAllPairs] = useState<SpreadPairAnalysis[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleFindBestPairs = async () => {
    setLoading(true);
    setRanking(null);
    setAllPairs([]);
    setError(null);

    try {
      // Busca todos os pares analisados (com e sem oportunidades)
      const todosPares = await spreadService.obterTodosPares(
        startDate,
        endDate,
        ganhoMinimo
      );

      if (!todosPares || todosPares.length === 0) {
        setError('Nenhum par encontrado. Verifique se o MetaTrader 5 está conectado na página principal do Dashboard.');
      } else {
        setAllPairs(todosPares);
        
        setRanking(spreadService.criarRankingDePares(todosPares));
      }
    } catch (error) {
      console.error('Erro ao buscar melhores pares:', error);
      setError('Erro ao buscar melhores pares. Verifique a conexão com o MetaTrader 5.');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return `R$ ${value.toFixed(2)}`;
  };

  const formatMetric = (value?: number | null, digits = 2) => {
    return typeof value === 'number' ? value.toFixed(digits) : '-';
  };

  const getOperationalStatus = (pair: SpreadPairAnalysis) => {
    if (pair.classificacaoOperacional) {
      return pair.classificacaoOperacional;
    }

    if (pair.ideal) {
      return 'Ideal Limite';
    }

    return pair.oportunidades > 0 ? 'Acompanhar' : 'Fraco';
  };

  const getStatusClasses = (status: string) => {
    if (status === 'Ideal Forte') {
      return {
        row: 'bg-green-500/10',
        pill: 'bg-green-500/20 text-green-400',
        dot: 'bg-green-500',
        score: 'text-green-400'
      };
    }

    if (status === 'Ideal Limite') {
      return {
        row: 'bg-cyan-500/5',
        pill: 'bg-cyan-500/20 text-cyan-300',
        dot: 'bg-cyan-400',
        score: 'text-cyan-300'
      };
    }

    if (status === 'Acompanhar') {
      return {
        row: 'bg-yellow-500/5',
        pill: 'bg-yellow-500/20 text-yellow-400',
        dot: 'bg-yellow-500',
        score: 'text-yellow-400'
      };
    }

    return {
      row: '',
      pill: 'bg-gray-500/20 text-gray-400',
      dot: 'bg-gray-500',
      score: 'text-gray-400'
    };
  };

  const RankingCard = ({
    title,
    icon: Icon,
    data,
    color
  }: {
    title: string;
    icon: any;
    data: SpreadPairAnalysis[];
    color: string;
  }) => (
    <div className={`cyber-card p-6 hud-corner border ${color}`}>
      <div className="flex items-center gap-2 mb-4">
        <Icon className={`w-6 h-6 ${color === 'border-green-500/30' ? 'text-green-400' : color === 'border-blue-500/30' ? 'text-blue-400' : 'text-purple-400'}`} />
        <h3 className="font-orbitron text-lg font-bold text-white">
          {title}
        </h3>
      </div>
      
      {data.length > 0 ? (
        <div className="space-y-3">
          {data.map((pair, index) => (
            <div
              key={pair.par}
              className="flex items-center justify-between bg-cyber-dark/50 rounded-lg p-3 border border-cyber-border"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyber-pink to-cyber-purple flex items-center justify-center">
                  <span className="text-sm font-bold font-orbitron text-white">
                    #{index + 1}
                  </span>
                </div>
                <div>
                  <p className="text-base font-bold font-space text-white">
                    {pair.par}
                  </p>
                  <p className="text-xs text-gray-400 font-space">
                    Score {formatMetric(pair.score, 1)} | Z {formatMetric(pair.zscore, 2)} | HL {formatMetric(pair.halfLife, 1)}
                  </p>
                </div>
              </div>
              
              <div className="text-right">
                <p className="text-lg font-bold font-orbitron text-green-400">
                  {title === 'Top 5 - Pares Ideais'
                    ? formatMetric(pair.score, 1)
                    : title === 'Top 5 - Maior Ganho'
                    ? formatCurrency(pair.maiorGanho)
                    : title === 'Top 5 - Melhor Retorno'
                    ? `${pair.melhorRetorno.toFixed(2)}%`
                    : pair.oportunidades}
                </p>
                <p className="text-xs text-gray-400 font-space">
                  Ganho hist.: {formatCurrency(pair.maiorGanho)}
                </p>
                <p className="text-xs text-gray-400 font-space">
                  {pair.direcaoEntrada ?? `Atual / medio: ${formatCurrency(pair.spreadAtual)} / ${formatMetric(pair.spreadMedio, 2)}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-gray-400 font-space">
            Nenhum par encontrado
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Mensagem de Erro */}
      {error && (
        <div className="cyber-card p-6 hud-corner border-l-4 border-l-red-500 bg-red-500/10">
          <div className="flex items-start gap-3">
            <div className="text-red-400 mt-1">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-orbitron text-lg font-bold text-red-400 mb-2">
                Erro na Busca
              </h4>
              <p className="text-gray-300 font-space text-sm leading-relaxed">
                {error}
              </p>
              <div className="mt-4 bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                <p className="text-gray-400 font-space text-sm mb-2">
                  Para usar a busca de melhores pares:
                </p>
                <ol className="text-gray-400 font-space text-sm list-decimal list-inside space-y-1">
                  <li>Abra a página principal do Dashboard</li>
                  <li>Conecte ao MetaTrader 5 (botão "Conectar" no topo)</li>
                  <li>Volte para esta página e clique em "Encontrar Melhores Pares"</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="cyber-card p-6 hud-corner">
        <div className="flex items-center gap-3 mb-4">
          <Trophy className="w-8 h-8 text-yellow-400" />
          <h2 className="font-orbitron text-2xl font-bold text-white neon-text-pink">
            Encontrar Melhores Pares
          </h2>
        </div>
        <p className="text-gray-300 font-space mb-6">
          Analisa automaticamente a lista de pares usando histórico do MT5, correlação, afastamento do spread,
          meia-vida de reversão e direção provável de entrada.
        </p>

        <button
          onClick={handleFindBestPairs}
          disabled={loading}
          className="cyber-button cyber-button-primary w-full flex items-center justify-center gap-2 py-4"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Analisando Pares...
            </>
          ) : (
            'Encontrar Melhores Pares'
          )}
        </button>
      </div>

      {ranking && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <RankingCard
              title="Top 5 - Pares Ideais"
              icon={TrendingUp}
              data={ranking.rankingScore}
              color="border-green-500/30"
            />

            <RankingCard
              title="Top 5 - Maior Ganho"
              icon={Target}
              data={ranking.rankingGanho}
              color="border-blue-500/30"
            />
            
            <RankingCard
              title="Top 5 - Melhor Retorno"
              icon={Award}
              data={ranking.rankingRetorno}
              color="border-purple-500/30"
            />
          </div>

          {/* Lista Completa de TODOS os Pares Analisados */}
          {allPairs.length > 0 && (
            <div className="cyber-card p-6 hud-corner overflow-x-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-orbitron text-lg font-bold text-white neon-text-cyan">
                  Todos os Pares Analisados: {allPairs.length}
                </h3>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                    <span className="text-xs text-gray-400 font-space">
                      Forte: {allPairs.filter(p => getOperationalStatus(p) === 'Ideal Forte').length}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-cyan-400"></div>
                    <span className="text-xs text-gray-400 font-space">
                      Limite: {allPairs.filter(p => getOperationalStatus(p) === 'Ideal Limite').length}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                    <span className="text-xs text-gray-400 font-space">
                      Acompanhar: {allPairs.filter(p => getOperationalStatus(p) === 'Acompanhar').length}
                    </span>
                  </div>
                </div>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-cyber-border">
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Par de Ativos
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Preço Atual 1
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Preço Atual 2
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Spread Atual / Médio
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Score
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Z / Corr
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Meia-vida
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Maior Ganho
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Direção
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-space text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allPairs.map((pair) => {
                    const status = getOperationalStatus(pair);
                    const statusClasses = getStatusClasses(status);
                    return (
                      <tr
                        key={pair.par}
                        className={`border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${statusClasses.row}`}
                      >
                        <td className="px-4 py-3 text-sm text-white font-space font-bold">
                          {pair.par}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300 font-space">
                          {pair.currentPrice1 ? formatCurrency(pair.currentPrice1) : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300 font-space">
                          {pair.currentPrice2 ? formatCurrency(pair.currentPrice2) : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300 font-space">
                          <div>{formatCurrency(pair.spreadAtual)}</div>
                          <div className="text-xs text-gray-500">
                            Médio: {formatMetric(pair.spreadMedio, 2)}
                          </div>
                          <div className="text-xs text-gray-500">
                            Assinado: {formatMetric(pair.spreadAtualAssinado, 2)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm font-space">
                          <span className={`font-bold ${statusClasses.score}`}>
                            {formatMetric(pair.score, 1)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300 font-space">
                          {formatMetric(pair.zscore, 2)} / {formatMetric(pair.correlacao, 2)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300 font-space">
                          {formatMetric(pair.halfLife, 1)} pregões
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300 font-space">
                          {pair.oportunidades > 0 ? formatCurrency(pair.maiorGanho) : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300 font-space max-w-xs">
                          {pair.direcaoEntrada ?? '-'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-space font-bold ${statusClasses.pill}`}>
                            {status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-4 p-4 bg-cyber-dark/50 rounded-lg border border-cyber-border">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm font-space">
                  <div>
                    <span className="text-gray-400">Total Analisado:</span>{' '}
                    <span className="text-white font-bold">{allPairs.length} pares</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Ideais Forte/Limite:</span>{' '}
                    <span className="text-green-400 font-bold">
                      {allPairs.filter(p => ['Ideal Forte', 'Ideal Limite'].includes(getOperationalStatus(p))).length} pares
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">Melhor Score:</span>{' '}
                    <span className="text-cyan-400 font-bold">{formatMetric(Math.max(...allPairs.map(p => p.score ?? 0)), 1)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
