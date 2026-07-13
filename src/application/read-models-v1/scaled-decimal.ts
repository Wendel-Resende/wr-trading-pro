import type { ScaledDecimalDTO } from './dto';

/**
 * Deterministic bigint -> exact decimal string conversion. Never uses
 * Number/float/exponential notation. real value = raw * 10^scalePow.
 *
 * Examples: (12345n, -2) -> "123.45"; (12345n, 2) -> "1234500";
 * (0n, -3) -> "0"; (-5n, -2) -> "-0.05".
 */
export function rawToDecimalString(raw: bigint, scalePow: number): string {
  const zero = BigInt(0);
  if (raw === zero) return '0';
  const negative = raw < zero;
  const digits = (negative ? -raw : raw).toString();

  if (scalePow >= 0) {
    const decimal = digits + '0'.repeat(scalePow);
    return negative ? `-${decimal}` : decimal;
  }

  const fractionDigits = -scalePow;
  const padded = digits.padStart(fractionDigits + 1, '0');
  const integerPart = padded.slice(0, padded.length - fractionDigits);
  const fractionPart = padded.slice(padded.length - fractionDigits);
  const decimal = `${integerPart}.${fractionPart}`;
  return negative ? `-${decimal}` : decimal;
}

export function toScaledDecimal(raw: bigint, scalePow: number): ScaledDecimalDTO {

  return Object.freeze({
    raw: raw.toString(),
    scalePow,
    decimal: rawToDecimalString(raw, scalePow),
  });
}
