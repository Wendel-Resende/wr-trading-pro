'use client';

import React from 'react';
import DirectionalSignalsView from '@/components/ml/DirectionalSignalsView';

export default function MLPredictionsTab() {
  return (
    <div className="p-6 space-y-6 text-white">
      <h2 className="font-orbitron text-2xl font-bold neon-text-cyan">
        Previsões ML — Classificador direcional (60 pregões)
      </h2>

      <DirectionalSignalsView />
    </div>
  );
}
