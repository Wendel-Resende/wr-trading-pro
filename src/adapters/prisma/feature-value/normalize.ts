/**
 * Pure normalization helpers for the feature-value adapter boundary.
 * These do not validate shape (regexes live in schemas.ts); they only
 * canonicalize so equal-meaning inputs compare equal.
 */

export const normalizeFeatureId = (value: string): string => value.trim();

export const normalizeSubjectId = (value: string): string => value.trim();

export const normalizeSourceKey = (value: string): string => value.trim().toLowerCase();
