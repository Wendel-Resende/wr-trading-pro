/**
 * Deterministic exact decimal-string builder for FeatureValue BIGINT
 * type. Conceptually mirrors read-models-v1/scaled-decimal.ts but
 * operates on the `{raw: string, scalePow: number}` pair as persisted
 * (valueRaw is a decimal-integer STRING column, not a Prisma BigInt
 * column). Never uses `Number()`/`parseFloat` on the raw magnitude —
 * only exact string manipulation on the BigInt-parsed mantissa.
 *
 * real value = BigInt(raw) * 10^scalePow.
 * Examples: ("12345", -2) -> "123.45"; ("12345", 2) -> "1234500";
 * ("0", -3) -> "0"; ("-5", -2) -> "-0.05".
 */
export function rawToDecimalString(raw: string, scalePow: number): string {
  const value = BigInt(raw);
  const zero = BigInt(0);
  if (value === zero) return '0';
  const negative = value < zero;
  const digits = (negative ? -value : value).toString();

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
