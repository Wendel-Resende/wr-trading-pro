/**
 * Re-exporta o módulo temporal neutro para preservar imports públicos
 * anteriores. Código novo deve importar `../time` diretamente.
 */
export type { Instant } from '../time';
export { parseInstant, compareInstants, isStrictlyAfter } from '../time';
