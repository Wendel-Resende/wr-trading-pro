export type SortDirection = 'asc' | 'desc' | null;
type SortValue = string | number | null | undefined;

export function nextSortDirection(direction: SortDirection): SortDirection {
  if (direction === null) return 'asc';
  return direction === 'asc' ? 'desc' : null;
}

/** Ordenação estável e somente de apresentação; ausente nunca passa à frente de dado real. */
export function sortRows<T>(rows: readonly T[], valueOf: (row: T) => SortValue, direction: SortDirection): T[] {
  if (direction === null) return [...rows];
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row) }))
    .sort((a, b) => {
      const aMissing = a.value === null || a.value === undefined || (typeof a.value === 'number' && !Number.isFinite(a.value));
      const bMissing = b.value === null || b.value === undefined || (typeof b.value === 'number' && !Number.isFinite(b.value));
      if (aMissing || bMissing) {
        if (aMissing && bMissing) return a.index - b.index;
        return aMissing ? 1 : -1;
      }
      const comparison = typeof a.value === 'number' && typeof b.value === 'number'
        ? a.value - b.value
        : String(a.value).localeCompare(String(b.value), 'pt-BR');
      return comparison === 0 ? a.index - b.index : direction === 'asc' ? comparison : -comparison;
    })
    .map((entry) => entry.row);
}
