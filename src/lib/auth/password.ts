/**
 * Verificação de senha com scrypt (node:crypto) — WR Trading Pro
 *
 * Somente para uso em route handlers Node (nunca no middleware Edge).
 * Formato do hash: scrypt$N$r$p$<salt hex>$<hash hex>
 * Gerar com: node scripts/auth/generate-password-hash.mjs
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keyLength: 64, saltBytes: 16 };

export function hashPassword(password: string): string {
  const { N, r, p, keyLength, saltBytes } = SCRYPT_PARAMS;
  const salt = randomBytes(saltBytes);
  const derived = scryptSync(password, salt, keyLength, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Compara a senha com o hash armazenado em tempo constante.
 * Qualquer hash malformado resulta em false (fail-closed).
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const parts = storedHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'hex');
    const expected = Buffer.from(parts[5], 'hex');
    if (
      !Number.isInteger(N) || N < 2 ||
      !Number.isInteger(r) || r < 1 ||
      !Number.isInteger(p) || p < 1 ||
      salt.length === 0 ||
      expected.length === 0
    ) {
      return false;
    }

    const derived = scryptSync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Igualdade de strings em tempo constante sem vazar comprimento
 * (compara digests SHA-256 de tamanho fixo). Usada para o username.
 */
export function safeEqualStrings(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}
