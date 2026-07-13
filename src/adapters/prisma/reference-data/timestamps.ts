import type { Instant } from '../../../domain/v1/time';
import { parseInstant } from '../../../domain/v1/time';
import { InvalidReferenceDataInputError } from './errors';

const MAX_FRACTION_DIGITS = 3;
const FRACTION_PATTERN = /\.(\d+)/;

/**
 * The domain's `Instant`/`parseInstant` accept up to 6 fraction digits
 * (microseconds) for general use. This adapter persists timestamps via
 * Prisma `DateTime` on SQLite, which only carries millisecond precision.
 * Rather than silently truncating a sub-millisecond value on write (which
 * would make two distinct inputs collide undetected), every timestamp
 * crossing this adapter's boundary (startedAt, completedAt, validFrom,
 * knowledgeTime, asOf) is required to have at most 3 fraction digits.
 */
export const hasAtMostMillisecondPrecision = (value: string): boolean => {
  const match = FRACTION_PATTERN.exec(value);
  return !match || match[1].length <= MAX_FRACTION_DIGITS;
};

/** Validates and parses a timestamp at the adapter boundary; throws InvalidReferenceDataInputError otherwise (fail closed). */
export const requireAdapterInstant = (value: string, field: string): Instant => {
  const instant = parseInstant(value);
  if (!instant) {
    throw new InvalidReferenceDataInputError(`${field} inválido: timestamp ISO-8601 exigido`, [field]);
  }
  if (!hasAtMostMillisecondPrecision(value)) {
    throw new InvalidReferenceDataInputError(
      `${field} não pode ter mais de 3 dígitos de fração: precisão máxima persistida é milissegundo`,
      [field],
    );
  }
  return instant;
};
