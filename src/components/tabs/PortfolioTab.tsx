"use client";

import Portfolio from "@/components/Portfolio";

export default function PortfolioTab() {
  return (
    <div className="cyber-card p-6 hud-corner">
      <h2 className="font-orbitron text-2xl font-bold text-white neon-text-purple mb-6">
        Gestão de Portfólio
      </h2>
      <Portfolio />
    </div>
  );
}
