"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { SortDirection } from '@/lib/table-sort';

interface TableSortButtonProps {
  label: string;
  direction: SortDirection;
  onClick: () => void;
  align?: 'left' | 'center' | 'right';
}

export default function TableSortButton({ label, direction, onClick, align = 'left' }: TableSortButtonProps) {
  const Icon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 hover:text-cyber-cyan transition-colors ${align === 'right' ? 'justify-end w-full' : align === 'center' ? 'justify-center w-full' : ''}`}
      aria-label={`Ordenar por ${label}${direction ? `, ordem ${direction === 'asc' ? 'crescente' : 'decrescente'}` : ''}`}
    >
      <span>{label}</span><Icon className="w-3 h-3" aria-hidden />
    </button>
  );
}
