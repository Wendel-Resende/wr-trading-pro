/**
 * Pure normalization helpers for the dataset-snapshot adapter boundary.
 * These do not validate shape (regexes live in schemas.ts); they only
 * canonicalize so equal-meaning inputs compare equal.
 */

export const normalizeSnapshotId = (value: string): string => value.trim();
