/**
 * Configuração de autenticação local — WR Trading Pro
 *
 * Credenciais vêm SOMENTE de variáveis de ambiente server-side (sem
 * NEXT_PUBLIC_). Nunca usar credenciais do MT5 aqui.
 *
 * Fail-closed: se qualquer variável obrigatória estiver ausente ou inválida,
 * getAuthConfig() retorna null e o login é recusado (503); o middleware trata
 * qualquer sessão como inválida sem um secret utilizável.
 *
 * Módulo Edge-safe (sem imports de node:*) — é usado pelo middleware.
 */

export const SESSION_COOKIE_NAME = 'wr_session';

const MIN_SECRET_LENGTH = 32;
const DEFAULT_TTL_HOURS = 12;
const MAX_TTL_HOURS = 24 * 30;

export interface AuthConfig {
  username: string;
  passwordHash: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
  cookieSecure: boolean;
}

/**
 * Secret de assinatura da sessão, ou null se ausente/curto demais.
 * Exposto separadamente porque o middleware só precisa disto.
 */
export function getSessionSecret(): string | null {
  const secret = process.env.WR_AUTH_SESSION_SECRET?.trim() ?? '';
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

export function getAuthConfig(): AuthConfig | null {
  const username = process.env.WR_AUTH_USERNAME?.trim() ?? '';
  const passwordHash = process.env.WR_AUTH_PASSWORD_HASH?.trim() ?? '';
  const sessionSecret = getSessionSecret();

  if (!username || !sessionSecret) return null;
  // Só aceitamos o formato gerado por scripts/auth/generate-password-hash.mjs
  if (!passwordHash.startsWith('scrypt$')) return null;

  const ttlRaw = Number(process.env.WR_AUTH_SESSION_TTL_HOURS ?? DEFAULT_TTL_HOURS);
  const ttlHours =
    Number.isFinite(ttlRaw) && ttlRaw > 0 && ttlRaw <= MAX_TTL_HOURS
      ? ttlRaw
      : DEFAULT_TTL_HOURS;

  return {
    username,
    passwordHash,
    sessionSecret,
    sessionTtlSeconds: Math.floor(ttlHours * 3600),
    // App local roda sobre http://127.0.0.1 (Electron); Secure só quando o
    // deploy for servido via HTTPS — ver docs/AUTH_SETUP.md.
    cookieSecure: process.env.WR_AUTH_COOKIE_SECURE === 'true',
  };
}
