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

// Mesmo formato aceito por `python/ml_api.py`/`TICKER_RE` no lado Flask
// (4 letras + 1-2 dígitos) — usado aqui só para normalizar/validar o rótulo
// exibido publicamente, nunca para decidir o que foi de fato processado.
const TICKER_RE = /^[A-Z]{4}\d{1,2}$/;

export function normalizeTickerLabel(raw: string): string {
  const upper = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return TICKER_RE.test(upper) ? upper : 'DESCONHECIDO';
}
