'use client';

import React from 'react';
import type { ExcludedCompany } from './types';

/**
 * Quem ficou de fora, e por quê. Existe para que a exclusão nunca seja uma
 * omissão silenciosa: cinco dos papéis excluídos por setor estão na watchlist
 * do usuário, e sumir com eles sem explicação seria mentir por ausência.
 */

interface Props {
  readonly excluidas: readonly ExcludedCompany[];
}

export default function ExclusoesPanel({ excluidas }: Props): React.ReactElement | null {
  if (excluidas.length === 0) return null;
  const setor = excluidas.filter((e) => e.motivo === 'SETOR_FINANCEIRO');
  const historia = excluidas.filter((e) => e.motivo === 'HISTORICO_INSUFICIENTE');

  return (
    <div className="cyber-card p-4 space-y-3">
      <h3 className="font-orbitron text-sm text-gray-300">Fora do ranking ({excluidas.length})</h3>

      {setor.length > 0 && (
        <div>
          <p className="text-xs text-gray-400">
            <strong className="text-gray-300">{setor.length} do setor financeiro.</strong>{' '}
            Num banco, o passivo circulante é o depósito do cliente e a alavancagem alta é o
            modelo de negócio — os critérios de liquidez e endividamento não têm o mesmo
            significado, e aplicá-los faria empresas sadias parecerem doentes.{' '}
            <strong className="text-gray-300">
              Os que têm dados no BCB são avaliados no bloco de bancos acima
            </strong>
            , com a régua prudencial do regulador; os demais permanecem sem avaliação.
          </p>
          <p className="mt-1 font-mono text-[11px] text-gray-500">
            {setor.map((e) => e.ticker).join(' · ')}
          </p>
        </div>
      )}

      {historia.length > 0 && (
        <div>
          <p className="text-xs text-gray-400">
            <strong className="text-gray-300">{historia.length} sem histórico suficiente.</strong>{' '}
            Consistência exige série comparável: 100% de trimestres saudáveis numa amostra curta
            é barato.
          </p>
          <ul className="mt-1 space-y-0.5">
            {historia.map((e) => (
              <li key={e.ticker} className="font-mono text-[11px] text-gray-500">
                {e.ticker} — {e.detalhe}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
