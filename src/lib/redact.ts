/**
 * Utilitário de redação de segredos para logs do frontend.
 * Mascara campos sensíveis antes de qualquer console.log ou serialização.
 */

const SENSITIVE_KEYS = new Set([
  'password', 'pass', 'pwd', 'token', 'api_key', 'apikey', 'secret',
  'accesskey', 'access_key', 'secretkey', 'secret_key', 'privatekey',
  'private_key', 'authorization', 'auth', 'credentials', 'credential',
  'key',
]);

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 10) return '...';

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const keyLower = k.toLowerCase().replace('-', '_');
      if (SENSITIVE_KEYS.has(keyLower)) {
        result[k] = '***';
      } else if (
        typeof v === 'string' &&
        /password|token|secret|api[_-]?key|authorization/i.test(v)
      ) {
        result[k] = '***';
      } else {
        result[k] = redact(v, depth + 1);
      }
    }
    return result;
  }

  return value;
}

export function redactedString(value: unknown): string {
  try {
    return JSON.stringify(redact(value));
  } catch {
    return '***';
  }
}
