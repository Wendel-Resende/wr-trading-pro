"use client";

import AgentPanel from '@/components/AgentPanel';

export default function AgentTab() {
  return (
    <div className="p-6 space-y-6">
      <h2 className="font-orbitron text-2xl font-bold text-white neon-text-cyan">Agente de Trading</h2>
      <AgentPanel />
    </div>
  );
}