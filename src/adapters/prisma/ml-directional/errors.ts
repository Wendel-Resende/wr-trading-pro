/** Item D — erros do adapter de persistência do classificador direcional. */

export class DirectionalModelVersionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DirectionalModelVersionNotFoundError';
  }
}

/**
 * Blob JSON persistido (metrics/topFeatures/gateFailures) fora do shape
 * esperado. Falhar explicitamente é obrigatório: uma métrica corrompida
 * lida como `undefined` viraria um gate visualmente aprovado sem evidência.
 */
export class DirectionalRecordCorruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DirectionalRecordCorruptedError';
  }
}
