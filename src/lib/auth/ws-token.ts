/**
 * Token efêmero de autenticação do WebSocket MT5 — WR Trading Pro (Fase 0, Item 10)
 *
 * Formato: wst1.<payload base64url>.<assinatura base64url>
 * Payload JSON: { sub, aud: 'mt5-ws', iat, exp, jti } (segundos Unix).
 * Assinatura: HMAC-SHA256(secret, "wst1.<payload base64url>").
 *
 * O formato é interoperável com python/ws_token.py — qualquer mudança aqui
 * precisa ser espelhada lá (e nos fixtures cross-language dos testes).
 *
 * Propriedades de segurança:
 * - Secret separado da sessão (WR_WS_TOKEN_SECRET, server-only, >= 32 chars).
 * - TTL curto (padrão 30s, teto 60s) — o token só serve para o handshake.
 * - jti aleatório criptográfico: o bridge consome cada jti uma única vez
 *   (replay cache), então o token é de uso único.
 * - O token nunca vai para localStorage, URL, logs ou payload de LOGIN.
 *
 * Implementado sobre Web Crypto para funcionar em Node e Edge runtime.
 */

export const WS_TOKEN_VERSION = 'wst1';
export const WS_TOKEN_AUDIENCE = 'mt5-ws';
export const WS_TOKEN_DEFAULT_TTL_SECONDS = 30;
export const WS_TOKEN_MAX_TTL_SECONDS = 60;
export const WS_TOKEN_CLOCK_SKEW_SECONDS = 10;

const MIN_SECRET_LENGTH = 32;
const encoder = new TextEncoder();

export interface WsTokenPayload {
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

/**
 * Secret de assinatura do token WS, ou null se ausente/curto demais
 * (fail-closed: sem secret nenhum token é emitido nem aceito).
 */
export function getWsTokenSecret(): string | null {
  const secret = process.env.WR_WS_TOKEN_SECRET?.trim() ?? '';
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

/** TTL configurável via env, sempre limitado ao teto de 60s. */
export function getWsTokenTtlSeconds(): number {
  const raw = Number(process.env.WR_WS_TOKEN_TTL_SECONDS ?? WS_TOKEN_DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(raw) || raw < 5) return WS_TOKEN_DEFAULT_TTL_SECONDS;
  return Math.min(Math.floor(raw), WS_TOKEN_MAX_TTL_SECONDS);
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

function randomJti(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * Cria um token WS assinado. `nowSeconds` e `jti` são injetáveis apenas para
 * testes determinísticos — em produção usar sempre os padrões.
 */
export async function createWsToken(
  secret: string,
  username: string,
  ttlSeconds: number = WS_TOKEN_DEFAULT_TTL_SECONDS,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  jti: string = randomJti()
): Promise<string> {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error('WS token secret muito curto');
  }
  const ttl = Math.min(Math.max(1, Math.floor(ttlSeconds)), WS_TOKEN_MAX_TTL_SECONDS);
  const payload: WsTokenPayload = {
    sub: username,
    aud: WS_TOKEN_AUDIENCE,
    iat: nowSeconds,
    exp: nowSeconds + ttl,
    jti,
  };
  const payloadB64 = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signedPart = `${WS_TOKEN_VERSION}.${payloadB64}`;
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPart));
  return `${signedPart}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Verifica assinatura, formato, audience, expiração e TTL máximo. Retorna o
 * payload quando válido, ou null para qualquer falha (fail-closed).
 *
 * A verificação de uso único (jti) é responsabilidade do consumidor
 * (replay cache no bridge Python); aqui só se valida o token em si.
 */
export async function verifyWsToken(
  secret: string,
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<WsTokenPayload | null> {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  if (typeof token !== 'string' || token.length > 2048) return null;

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== WS_TOKEN_VERSION) return null;
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

  let payload: WsTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }

  if (
    typeof payload.sub !== 'string' ||
    payload.sub.length === 0 ||
    payload.aud !== WS_TOKEN_AUDIENCE ||
    !Number.isFinite(payload.iat) ||
    !Number.isFinite(payload.exp) ||
    typeof payload.jti !== 'string' ||
    payload.jti.length < 8
  ) {
    return null;
  }

  const ttl = payload.exp - payload.iat;
  if (ttl <= 0 || ttl > WS_TOKEN_MAX_TTL_SECONDS) return null;
  // iat no futuro além do skew tolerado = relógio inconsistente ou forjado
  if (payload.iat > nowSeconds + WS_TOKEN_CLOCK_SKEW_SECONDS) return null;
  if (nowSeconds >= payload.exp + WS_TOKEN_CLOCK_SKEW_SECONDS) return null;

  return payload;
}
