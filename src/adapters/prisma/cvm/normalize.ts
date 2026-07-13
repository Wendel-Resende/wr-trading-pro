/**
 * Pure normalization helpers for the CVM adapter boundary. These do not
 * validate shape (regexes live in schemas.ts); they only canonicalize so
 * equal-meaning inputs compare equal.
 */

export const normalizeSourceKey = (value: string): string => value.trim().toLowerCase();

/** Strips non-digits and leading zeros (keeps a single "0" if the input is all zeros). */
export const normalizeCvmCode = (value: string): string => {
  const digits = value.trim().replace(/\D/g, '');
  const stripped = digits.replace(/^0+/, '');
  return stripped.length > 0 ? stripped : '0';
};

export const normalizeCvmProtocol = (value: string): string => value.trim();

export const normalizeShareClass = (value: string): string => value.trim().toUpperCase();

export const normalizeCurrency = (value: string): string => value.trim().toUpperCase();

export const normalizeAccountCode = (value: string): string => value.trim();

export const normalizeSha256 = (value: string): string => value.trim().toLowerCase();
