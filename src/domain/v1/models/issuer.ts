import type { IngestionRunId } from './ingestion';

/**
 * Emissor (Fase 2 / Item 1): identidade estável e imutável, chaveada
 * por código CVM normalizado. Não há atualização destrutiva (SCD-1):
 * um registro cujos campos de identidade conflitam com um emissor já
 * existente para o mesmo cvmCode falha fechado e nada é gravado.
 * Perfis históricos de emissor são escopo futuro.
 */

export type IssuerId = string;

export interface Issuer {
  readonly id: IssuerId;
  /** Código CVM normalizado: apenas dígitos, sem zeros à esquerda. */
  readonly cvmCode: string;
  /** CNPJ normalizado com exatamente 14 dígitos, ou null quando desconhecido. */
  readonly cnpj: string | null;
  readonly name: string;
  /** Run que criou o emissor; `completedAt` dela é o knowledgeTime da linha. */
  readonly createdByRunId: IngestionRunId;
}

/** Pedido de registro de emissor dentro de um lote de ingestão. */
export interface IssuerRegistration {
  readonly cvmCode: string;
  readonly cnpj?: string | null;
  readonly name: string;
}
