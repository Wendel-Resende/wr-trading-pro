'use client';

import React from 'react';
import RankingFundamentalistaView from '@/components/ranking/RankingFundamentalistaView';

/**
 * Aba Ranking Fundamentalista (era "Previsões ML" até 2026-08-11).
 *
 * O motor por trás é um escore composto de fator sobre fundamentos CVM: ele
 * ORDENA empresas na seção transversal do trimestre. Não prevê mercado. O
 * rótulo anterior prometia previsão e nunca entregou — ver
 * docs/superpowers/specs/2026-08-11-ranking-fundamentalista-design.md.
 */
export default function RankingFundamentalistaTab(): React.ReactElement {
  return (
    <div className="p-6 space-y-6 text-white">
      <h2 className="font-orbitron text-2xl font-bold neon-text-cyan">
        Ranking Fundamentalista — escore de fator (60 pregões)
      </h2>
      <p className="text-xs text-gray-500 -mt-4">
        Ordenação transversal das empresas do universo CVM por fundamentos, com horizonte de um trimestre.
        Não é previsão de mercado nem recomendação de operação.
      </p>

      <RankingFundamentalistaView />
    </div>
  );
}
