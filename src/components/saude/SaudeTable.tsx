'use client';

import React from 'react';
import { pct, emDeclinio, PILLAR_ORDER, PILLAR_LABELS, type HealthRow } from './types';

/**
 * Lista do ranking. Componente puro: recebe tudo por props, não faz rede.
 *
 * Os cinco pilares aparecem ABERTOS, com a taxa de cada um — é o que torna
 * cada linha auditável contra o balanço da empresa. A coluna "Recente" fica
 * SEMPRE separada do escore histórico: a divergência entre as duas é a
 * informação, e fundi-las num peso único a destruiria.
 */

interface Props {
  readonly rows: readonly HealthRow[];
  readonly loading: boolean;
  /** Mensagem de estado vazio, decidida pelo pai (que conhece o contexto). */
  readonly emptyMessage: string;
}

function barra(v: number | null): React.ReactElement {
  const w = v === null || !Number.isFinite(v) ? 0 : Math.max(0, Math.min(100, v * 100));
  return (
    <span className="w-16 h-1.5 bg-gray-800 rounded overflow-hidden hidden sm:block">
      <span className="block h-full bg-cyber-cyan" style={{ width: `${w}%` }} />
    </span>
  );
}

export default function SaudeTable({ rows, loading, emptyMessage }: Props): React.ReactElement {
  if (loading) return <p className="text-xs text-gray-500">Carregando ranking…</p>;
  if (rows.length === 0) return <p className="text-xs text-gray-500">{emptyMessage}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800">
            <th className="text-left py-2 px-2">#</th>
            <th className="text-left py-2 px-2">Ticker</th>
            <th className="text-right py-2 px-2">Escore histórico</th>
            <th className="text-right py-2 px-2">Recente</th>
            <th className="text-right py-2 px-2">Trimestres</th>
            {PILLAR_ORDER.map((k) => (
              <th key={k} className="text-right py-2 px-2">
                {PILLAR_LABELS[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.ticker} className="border-b border-gray-900 hover:bg-gray-900/40">
              <td className="py-2 px-2 text-gray-600 tabular-nums">{i + 1}</td>
              <td className="py-2 px-2">
                <span className="font-mono text-gray-200">{r.ticker}</span>
                <span className="block text-[10px] text-gray-600 truncate max-w-[16rem]">{r.nome}</span>
              </td>
              <td className="py-2 px-2">
                <div className="flex items-center justify-end gap-2">
                  <span className="font-mono text-gray-200 tabular-nums">{r.score.toFixed(2)}</span>
                  {barra(r.score)}
                </div>
              </td>
              <td className="py-2 px-2 text-right font-mono tabular-nums">
                <span className={emDeclinio(r) ? 'text-amber-400' : 'text-gray-400'}>
                  {r.recente.score === null ? '—' : r.recente.score.toFixed(2)}
                  {emDeclinio(r) ? ' ⚠' : ''}
                </span>
                <span className="block text-[10px] text-gray-600">{r.recente.trimestres} tri</span>
              </td>
              <td className="py-2 px-2 text-right font-mono text-gray-400 tabular-nums">{r.trimestres}</td>
              {PILLAR_ORDER.map((k) => (
                <td key={k} className="py-2 px-2 text-right font-mono text-gray-400 tabular-nums">
                  {pct(r.pilares[k].taxa)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
