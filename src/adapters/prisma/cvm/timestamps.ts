import type { Instant } from '../../../domain/v1/time';
import { parseInstant } from '../../../domain/v1/time';
import { InvalidCvmInputError } from './errors';

const MAX_FRACTION_DIGITS = 3;
const FRACTION_PATTERN = /\.(\d+)/;
const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

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

/** Validates and parses an instant at the adapter boundary; throws InvalidCvmInputError otherwise (fail closed). */
export const requireAdapterInstant = (value: string, field: string): Instant => {
  const instant = parseInstant(value);
  if (!instant) {
    throw new InvalidCvmInputError(`${field} inválido: timestamp ISO-8601 exigido`, [field]);
  }
  if (!hasAtMostMillisecondPrecision(value)) {
    throw new InvalidCvmInputError(
      `${field} não pode ter mais de 3 dígitos de fração: precisão máxima persistida é milissegundo`,
      [field],
    );
  }
  return instant;
};

/**
 * Strict civil-date (YYYY-MM-DD) validation: correct calendar (including
 * leap years), no timezone/instant component. Used for referenceDate,
 * periodStart, periodEnd — accounting dates that never prove
 * availability by themselves.
 */
export const isValidCivilDate = (value: string): boolean => {
  const match = CIVIL_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
};

/** String comparison is safe for YYYY-MM-DD (already zero-padded, fixed width). */
export const compareCivilDates = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
