/**
 * Pure normalization helpers for the market-bar adapter boundary. These
 * do not validate shape (regexes live in schemas.ts); they only
 * canonicalize so equal-meaning inputs compare equal.
 */

export const normalizeSourceKey = (value: string): string => value.trim().toLowerCase();

export const normalizeSourceRecordKey = (value: string): string => value.trim();

export const normalizeSha256 = (value: string): string => value.trim().toLowerCase();

export const normalizeSymbol = (value: string): string => value.trim().toUpperCase();
