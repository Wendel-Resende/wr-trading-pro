"use client";

import { useState } from 'react';
import { BarChart3, Landmark, Pin, PinOff, Search } from 'lucide-react';
import { useInstrumentContext } from '@/contexts/InstrumentContext';

interface InstrumentContextBarProps {
  onOpenDashboard: () => void;
  onOpenFundamentals: () => void;
}

export default function InstrumentContextBar({ onOpenDashboard, onOpenFundamentals }: InstrumentContextBarProps) {
  const { activeSymbol, favorites, hydrated, setActiveSymbol, toggleFavorite } = useInstrumentContext();
  const [symbolInput, setSymbolInput] = useState('');
  const isFavorite = favorites.includes(activeSymbol);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (setActiveSymbol(symbolInput)) setSymbolInput('');
  };

  return (
    <section className="border-b border-cyber-border bg-cyber-dark/40" aria-label="Contexto ativo do instrumento">
      <div className="px-4 py-2 flex flex-wrap items-center gap-2 font-space">
        <span className="text-[10px] uppercase tracking-widest text-gray-500">Ativo</span>
        <span className="rounded border border-cyber-cyan/40 bg-cyber-cyan/10 px-2 py-1 text-sm font-bold text-cyber-cyan">
          {activeSymbol}
        </span>
        <button
          type="button"
          onClick={() => toggleFavorite()}
          className="rounded p-1 text-gray-400 transition-colors hover:bg-cyber-cyan/10 hover:text-cyber-cyan"
          title={isFavorite ? `Remover ${activeSymbol} dos favoritos` : `Fixar ${activeSymbol} nos favoritos`}
          aria-label={isFavorite ? `Remover ${activeSymbol} dos favoritos` : `Fixar ${activeSymbol} nos favoritos`}
        >
          {isFavorite ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </button>

        {favorites.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 border-l border-cyber-border pl-2">
            {favorites.map((symbol) => (
              <button
                type="button"
                key={symbol}
                onClick={() => setActiveSymbol(symbol)}
                className={`rounded px-2 py-1 text-xs transition-colors ${symbol === activeSymbol ? 'bg-cyber-cyan text-black' : 'text-gray-400 hover:bg-cyber-cyan/10 hover:text-white'}`}
              >
                {symbol}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={submit} className="flex items-center gap-1">
          <label className="sr-only" htmlFor="workspace-symbol">Selecionar ticker B3</label>
          <input
            id="workspace-symbol"
            value={symbolInput}
            onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
            placeholder="Ticker B3"
            className="w-24 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-white placeholder:text-gray-600 focus:border-cyber-cyan focus:outline-none"
          />
          <button type="submit" className="rounded p-1 text-gray-400 transition-colors hover:text-cyber-cyan" title="Selecionar ativo">
            <Search className="h-4 w-4" />
          </button>
        </form>

        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onOpenDashboard} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-cyber-cyan/10 hover:text-cyber-cyan">
            <BarChart3 className="h-3.5 w-3.5" /> Gráfico
          </button>
          <button type="button" onClick={onOpenFundamentals} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-cyber-cyan/10 hover:text-cyber-cyan">
            <Landmark className="h-3.5 w-3.5" /> Fundamentos
          </button>
        </div>
        {!hydrated && <span className="text-[10px] text-gray-600">carregando workspace</span>}
      </div>
    </section>
  );
}
