import type { IdempotencyRegistry, IdempotencyReservation } from '../../src/domain/v1/ports/idempotency-registry';

/** Test-only process-local atomic fixture; no distributed atomicity claim. */
export class InMemoryIdempotencyRegistry implements IdempotencyRegistry {
  private readonly reservations = new Map<string, string>();

  constructor(private readonly now: () => string) {}

  async reserve(key: string, correlationId: string): Promise<IdempotencyReservation> {
    const existing = this.reservations.get(key);
    if (existing !== undefined) return { reserved: false, existingCorrelationId: existing };
    this.reservations.set(key, correlationId);
    return { reserved: true, reservedAt: this.now() };
  }
}
