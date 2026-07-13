export type ReadModelErrorCode =
  | 'INVALID_QUERY'
  | 'INVALID_TIME_RANGE'
  | 'RESULT_LIMIT_EXCEEDED'
  | 'INSTRUMENT_NOT_FOUND'
  | 'FILING_NOT_FOUND'
  | 'AMBIGUOUS_INSTRUMENT_VERSION'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ReadModelErrorCode, number> = {
  INVALID_QUERY: 400,
  INVALID_TIME_RANGE: 400,
  RESULT_LIMIT_EXCEEDED: 400,
  INSTRUMENT_NOT_FOUND: 404,
  FILING_NOT_FOUND: 404,
  AMBIGUOUS_INSTRUMENT_VERSION: 409,
  INTERNAL_ERROR: 500,
};

/**
 * Stable, sanitized read-model error. `message` is always a fixed,
 * non-leaking string (never a raw Prisma/SQL/stack message). Route
 * handlers translate this directly into the wire error envelope.
 */
export class ReadModelError extends Error {
  readonly code: ReadModelErrorCode;
  readonly status: number;

  constructor(code: ReadModelErrorCode, message: string) {
    super(message);
    this.name = 'ReadModelError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}
