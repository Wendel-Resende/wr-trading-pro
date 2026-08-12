'use client';

import React from 'react';
import SaudeFinanceiraView from '@/components/saude/SaudeFinanceiraView';

/**
 * Aba Saúde Financeira.
 *
 * Afirmação DESCRITIVA — "esta empresa manteve as contas em ordem ao longo do
 * tempo" —, distinta da aba Ranking Fundamentalista, que é preditiva. Não tem
 * gate nem modelo: é contagem sobre balanço publicado. Ver
 * docs/superpowers/specs/2026-08-12-ranking-saude-financeira-design.md.
 */
export default function SaudeFinanceiraTab(): React.ReactElement {
  return (
    <div className="p-6 space-y-6 text-white">
      <h2 className="font-orbitron text-2xl font-bold neon-text-cyan">
        Saúde Financeira — consistência histórica
      </h2>
      <p className="text-xs text-gray-500 -mt-4">
        Quantos trimestres, ao longo de até 15 anos de balanços CVM, a empresa manteve
        alavancagem, liquidez, cobertura de juros, lucro e geração de caixa em ordem.
      </p>

      <SaudeFinanceiraView />
    </div>
  );
}
