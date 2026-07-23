'use client';

import React from 'react';
import HybridGovernedView from '@/components/ml/HybridGovernedView';

export default function MLPredictionsTab() {
  return (
    <div className="p-6 space-y-6 text-white">
      <h2 className="font-orbitron text-2xl font-bold neon-text-cyan">
        Previsões ML — Híbrido governado (D1 · 10 pregões)
      </h2>

      <HybridGovernedView />
    </div>
  );
}
