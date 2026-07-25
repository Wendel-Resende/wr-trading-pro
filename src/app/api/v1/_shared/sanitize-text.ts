import { canonicalizeB3Ticker } from '../../../../lib/b3-ticker';

/**
 * Item B (auditoria final do Guardião, 2026-07-22, bloqueador crítico 2):
 * mensagens de erro/proveniência de origem externa (Python/upstream, texto
 * livre de cadastro) nunca podem ser expostas cruas — podem conter path
 * local, token, URL interna ou stack trace. `redactUnsafeText` é a mesma
 * regra conservadora já usada em `CostProfilePublicDTO.sourceSummary`
 * (prefere redigir demais a vazar de menos), extraída aqui para reuso.
 */
const PATH_LIKE_PATTERN = /(\\|\/|https?:\/\/|[A-Za-z]:\\)/;
const TOKEN_LIKE_PATTERN = /[A-Za-z0-9+/=]{24,}/;
const SAFE_CHARS_PATTERN = /[^A-Za-z0-9À-ÖØ-öø-ÿ .,\-_():]/g;

export function redactUnsafeText(raw: string, maxLength: number, fallback: string): string {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  if (PATH_LIKE_PATTERN.test(raw) || TOKEN_LIKE_PATTERN.test(raw)) return fallback;

  const cleaned = raw.replace(SAFE_CHARS_PATTERN, '').trim().replace(/\s+/g, ' ');
  if (cleaned.length === 0) return fallback;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}

export function normalizeTickerLabel(raw: string): string {
  return canonicalizeB3Ticker(raw);
}
