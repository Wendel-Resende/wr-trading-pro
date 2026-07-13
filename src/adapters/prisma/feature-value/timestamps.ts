import type { Instant } from '../../../domain/v1/time';
import { parseInstant } from '../../../domain/v1/time';
import { InvalidFeatureValueInputError } from './errors';

const MAX_FRACTION_DIGITS = 3;
const FRACTION_PATTERN = /\.(\d+)/;

export const hasAtMostMillisecondPrecision = (value: string): boolean => {
  const match = FRACTION_PATTERN.exec(value);
  return !match || match[1].length <= MAX_FRACTION_DIGITS;
};

/** Validates and parses an instant at the adapter boundary; throws InvalidFeatureValueInputError otherwise (fail closed). */
export const requireAdapterInstant = (value: string, field: string): Instant => {
  const instant = parseInstant(value);
  if (!instant) {
    throw new InvalidFeatureValueInputError(`${field} inválido: timestamp ISO-8601 exigido`, [field]);
  }
  if (!hasAtMostMillisecondPrecision(value)) {
    throw new InvalidFeatureValueInputError(
      `${field} não pode ter mais de 3 dígitos de fração: precisão máxima persistida é milissegundo`,
      [field],
    );
  }
  return instant;
};
