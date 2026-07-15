"use client";

import { useState } from 'react';
import AgentPanel from '@/components/AgentPanel';
import AgentRunsPanel from '@/components/AgentRunsPanel';

export default function AgentTab() {
  const [view, setView] = useState<'rapida' | 'runs'>('rapida');

  return (
    <div className="p-6 space-y-6">
      <h2 className="font-orbitron text-2xl font-bold text-white neon-text-cyan">Agente de Trading</h2>

      <div className="flex gap-2">
        {(
          [
            { id: 'rapida', label: 'Sugestão Rápida' },
            { id: 'runs', label: 'Runs Governados' },
          ] as const
        ).map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`px-4 py-2 rounded-lg font-orbitron text-xs uppercase tracking-wider transition-colors border ${
              view === v.id
                ? 'bg-cyber-pink/20 border-cyber-pink/60 text-white'
                : 'border-cyber-border text-gray-400 hover:text-white hover:bg-cyber-dark'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'rapida' && <AgentPanel />}
      {view === 'runs' && <AgentRunsPanel />}
    </div>
  );
}
