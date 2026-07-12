/**
 * Token de sessão assinado (HMAC-SHA256) — WR Trading Pro
 *
 * Formato: v1.<payload base64url>.<assinatura base64url>
 * Payload JSON: { sub, iat, exp } (segundos Unix).
 *
 * Implementado sobre Web Crypto (globalThis.crypto.subtle) para funcionar
 * tanto no Edge runtime do middleware quanto no Node dos route handlers.
 * A verificação usa crypto.subtle.verify, que compara em tempo constante.
 * O token só existe em cookie HttpOnly — nunca chega ao JavaScript do browser.
 */

const TOKEN_VERSION = 'v1';
const encoder = new TextEncoder();

export interface SessionPayload {
  sub: string;
  iat: number;
  exp: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Cria um token de sessão assinado. `nowSeconds` é injetável apenas para
 * testes determinísticos de expiração.
 */
export async function createSessionToken(
  secret: string,
  username: string,
  ttlSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const payload: SessionPayload = {
    sub: username,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  };
  const payloadB64 = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signedPart = `${TOKEN_VERSION}.${payloadB64}`;
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPart));
  return `${signedPart}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Verifica assinatura e expiração. Retorna o payload quando válido, ou null
 * para qualquer token malformado, adulterado ou expirado (fail-closed).
 */
export async function verifySessionToken(
  secret: string,
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<SessionPayload | null> {
  if (!secret || typeof token !== 'string' || token.length > 4096) return null;

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const [version, payloadB64, signatureB64] = parts;

  const signatureBytes = fromBase64Url(signatureB64);
  const payloadBytes = fromBase64Url(payloadB64);
  if (!signatureBytes || !payloadBytes) return null;

  const key = await importHmacKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes as BufferSource,
    encoder.encode(`${version}.${payloadB64}`)
  );
  if (!valid) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }

  if (
    typeof payload.sub !== 'string' ||
    payload.sub.length === 0 ||
    !Number.isFinite(payload.iat) ||
    !Number.isFinite(payload.exp)
  ) {
    return null;
  }
  if (payload.exp <= nowSeconds) return null;

  return payload;
}
