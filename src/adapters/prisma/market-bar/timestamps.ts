import type { Instant } from '../../../domain/v1/time';
import { parseInstant } from '../../../domain/v1/time';
import { InvalidMarketBarInputError } from './errors';

const MAX_FRACTION_DIGITS = 3;
const FRACTION_PATTERN = /\.(\d+)/;

/**
 * The domain's `Instant`/`parseInstant` accept up to 6 fraction digits
 * (microseconds); this adapter persists via Prisma `DateTime` on SQLite,
 * which only carries millisecond precision. Every instant crossing this
 * adapter's boundary is required to have at most 3 fraction digits so a
 * sub-millisecond input never silently collides with another on write.
 */
export const hasAtMostMillisecondPrecision = (value: string): boolean => {
  const match = FRACTION_PATTERN.exec(value);
  return !match || match[1].length <= MAX_FRACTION_DIGITS;
};

/** Validates and parses an instant at the adapter boundary; throws InvalidMarketBarInputError otherwise (fail closed). */
export const requireAdapterInstant = (value: string, field: string): Instant => {
  const instant = parseInstant(value);
  if (!instant) {
    throw new InvalidMarketBarInputError(`${field} inválido: timestamp ISO-8601 exigido`, [field]);
  }
  if (!hasAtMostMillisecondPrecision(value)) {
    throw new InvalidMarketBarInputError(
      `${field} não pode ter mais de 3 dígitos de fração: precisão máxima persistida é milissegundo`,
      [field],
    );
  }
  return instant;
};
