'use client';

import React from 'react';
import { pct, num, QUANTILE_STYLES, type RankingEntry } from './types';

/**
 * A lista do ranking. Componente puro: recebe tudo por props, não faz rede.
 *
 * Mostra POSIÇÃO (quintil + escore), nunca recomendação. A coluna "Sinal"
 * (COMPRA/VENDA/NEUTRO) do motor anterior foi removida no reposicionamento de
 * 2026-08-11: o escore ordena empresas dentro do trimestre e não estima
 * direção de preço, então rotular o topo como "COMPRA" afirmava mais do que o
 * modelo sabe.
 */

interface Props {
  readonly entries: readonly RankingEntry[];
  readonly loading: boolean;
  /** Mensagem de estado vazio, decidida pelo pai (que conhece o contexto). */
  readonly emptyMessage: string;
}

/** Largura da barra de escore, normalizada pelo maior |escore| visível. */
function barWidth(score: number | null | undefined, maxAbs: number): number {
  if (score === null || score === undefined || !Number.isFinite(score) || maxAbs <= 0) return 0;
  return Math.min(100, (Math.abs(score) / maxAbs) * 100);
}

export default function RankingTable({ entries, loading, emptyMessage }: Props): React.ReactElement {
  if (loading) return <p className="text-xs text-gray-500">Carregando ranking…</p>;
  if (entries.length === 0) return <p className="text-xs text-gray-500">{emptyMessage}</p>;

  const maxAbs = Math.max(
    ...entries.map((e) => (typeof e.score === 'number' && Number.isFinite(e.score) ? Math.abs(e.score) : 0)),
    0.0001,
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800">
            <th className="text-left py-2 px-2">Ticker</th>
            <th className="text-center py-2 px-2">Posição</th>
            <th className="text-right py-2 px-2">Escore</th>
            <th className="text-right py-2 px-2">Percentil</th>
            <th className="text-left py-2 px-2">Conhecido em</th>
            <th className="text-left py-2 px-2">Principais fatores</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const positivo = (e.score ?? 0) >= 0;
            return (
              <tr key={`${e.ticker}-${e.generatedAt}`} className="border-b border-gray-900 hover:bg-gray-900/40">
                <td className="py-2 px-2 font-mono text-gray-200">{e.ticker}</td>
                <td className="py-2 px-2 text-center">
                  <span
                    className={`px-2 py-0.5 rounded border text-[11px] font-semibold font-mono ${
                      QUANTILE_STYLES[e.quantile ?? 3] ?? QUANTILE_STYLES[3]
                    }`}
                  >
                    {e.quantile ? `Q${e.quantile}` : '—'}
                  </span>
                </td>
                <td className="py-2 px-2">
                  <div className="flex items-center justify-end gap-2">
                    <span className="font-mono text-gray-300 tabular-nums">{num(e.score, 3)}</span>
                    <span className="w-16 h-1.5 bg-gray-800 rounded overflow-hidden hidden sm:block">
                      <span
                        className={`block h-1.5 ${positivo ? 'bg-cyan-500/60' : 'bg-amber-500/60'}`}
                        style={{ width: `${barWidth(e.score, maxAbs)}%` }}
                      />
                    </span>
                  </div>
                </td>
                <td className="py-2 px-2 text-right font-mono text-gray-500">{pct(e.percentil, 0)}</td>
                <td className="py-2 px-2 font-mono text-gray-500">{e.knowledgeDate.slice(0, 10)}</td>
                <td
                  className="py-2 px-2 text-gray-400"
                  title={e.topFeatures.map((f) => `${f.feature}: ${f.importance.toFixed(3)}`).join(' · ')}
                >
                  {e.topFeatures.slice(0, 3).map((f) => f.feature).join(', ') || '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="text-[11px] text-gray-600 mt-3 border-t border-gray-800 pt-2">
        <span className="text-gray-400 font-semibold">Q5 = topo do ranking no trimestre.</span>{' '}
        Não é recomendação de compra. O escore ordena as empresas pela média dos percentis das features
        com sinal comprovado; ele não estima probabilidade de alta nem prevê preço. O percentil é a
        posição relativa na seção transversal do trimestre.
      </p>
    </div>
  );
}
