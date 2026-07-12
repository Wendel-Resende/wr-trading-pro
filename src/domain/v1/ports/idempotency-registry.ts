export type IdempotencyReservation =
  | Readonly<{ reserved: true; reservedAt: string }>
  | Readonly<{ reserved: false; existingCorrelationId: string }>;

/**
 * Atomic check-and-reserve within an implementation's own consistency scope.
 * On success, `reservedAt` is a strict ISO instant captured by the trusted
 * registry when the atomic reservation successfully completes, not when the
 * request was received or started.
 * This port makes no claim of distributed atomicity.
 */
export interface IdempotencyRegistry {
  reserve(key: string, correlationId: string): Promise<IdempotencyReservation>;
}
