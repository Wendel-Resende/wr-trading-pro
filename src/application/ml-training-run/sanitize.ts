/**
 * Item C: mesma regra conservadora de `src/app/api/v1/_shared/sanitize-text.ts`
 * (prefere redigir demais a vazar de menos), reimplementada aqui porque a
 * camada de aplicação não deve depender de `src/app/**` (rotas Next). Nunca
 * persiste/expõe mensagem de erro Python/upstream crua — pode conter path,
 * token, URL interna ou stack trace (spec §3).
 */
const PATH_LIKE_PATTERN = /(\\|\/|https?:\/\/|[A-Za-z]:\\)/;
const TOKEN_LIKE_PATTERN = /[A-Za-z0-9+/=]{24,}/;
const SAFE_CHARS_PATTERN = /[^A-Za-z0-9À-ÖØ-öø-ÿ .,\-_():]/g;

export function sanitizeErrorSummary(raw: string, maxLength = 160, fallback = 'falha não detalhável (formato restrito)'): string {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  if (PATH_LIKE_PATTERN.test(raw) || TOKEN_LIKE_PATTERN.test(raw)) return fallback;
  const cleaned = raw.replace(SAFE_CHARS_PATTERN, '').trim().replace(/\s+/g, ' ');
  if (cleaned.length === 0) return fallback;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  'INSUFFICIENT_DATA',
  'TRAINING_ERROR',
  'UPSTREAM_ERROR',
  'UPSTREAM_TIMEOUT',
  'COST_PROFILE_NOT_FOUND',
  'INVALID_COST_PROFILE',
  'INTERNAL_ERROR',
]);

export function toKnownErrorCode(raw: unknown): string {
  return typeof raw === 'string' && KNOWN_ERROR_CODES.has(raw) ? raw : 'INTERNAL_ERROR';
}
