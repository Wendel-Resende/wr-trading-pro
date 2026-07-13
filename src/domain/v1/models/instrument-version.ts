import type { IngestionRunId } from './ingestion';
import type { AssetClass } from './instrument';
import type { IssuerId } from './issuer';

/**
 * Versão SCD-2 de instrumento (Fase 2 / Item 1).
 *
 * Cada versão cobre o intervalo semiaberto [validFrom, validTo) no
 * tempo de negócio. Invariantes por (symbol, exchange), garantidos no
 * repositório (não por triggers):
 *  - intervalos nunca se sobrepõem;
 *  - existe no máximo um intervalo aberto (validTo === null);
 *  - fechar o intervalo anterior usa exatamente o validFrom da nova
 *    versão, preservando a semântica semiaberta na fronteira.
 *
 * Escalas: `priceScalePow` e `quantityScalePow` são EXPOENTES decimais,
 * não fatores. O quantum real é `10^scalePow` e o expoente pode ser
 * negativo (ex.: scalePow = -2 => quantum 0.01). `lotSize` é o lote
 * padrão em unidades inteiras de quantidade.
 */

export type InstrumentVersionId = string;

export type InstrumentLifecycleStatus = 'ACTIVE' | 'SUSPENDED' | 'DELISTED';

/**
 * Base do instante validFrom:
 *  - SOURCE_EFFECTIVE: a fonte declarou o instante de vigência real;
 *  - OBSERVED_AT: apenas o instante de observação é conhecido — pode,
 *    conservadoramente, usar o instante de conclusão da run. Nunca
 *    rotule um instante observado como se fosse vigência da fonte.
 */
export type ValidFromBasis = 'SOURCE_EFFECTIVE' | 'OBSERVED_AT';

export interface InstrumentVersion {
  readonly id: InstrumentVersionId;
  /** Símbolo normalizado (maiúsculas). Tradução para id canônico é escopo futuro. */
  readonly symbol: string;
  /** Praça/bolsa normalizada (maiúsculas). */
  readonly exchange: string;
  /** Moeda ISO-4217 normalizada (3 letras maiúsculas). */
  readonly currency: string;
  readonly displayName: string;
  readonly assetClass: AssetClass;
  readonly status: InstrumentLifecycleStatus;
  /** Expoente decimal do quantum de preço (quantum = 10^priceScalePow); null se desconhecido. */
  readonly priceScalePow: number | null;
  /** Expoente decimal do quantum de quantidade (quantum = 10^quantityScalePow); null se desconhecido. */
  readonly quantityScalePow: number | null;
  /** Lote padrão em unidades inteiras; null se desconhecido. */
  readonly lotSize: number | null;
  /** Início do intervalo de negócio (inclusivo), ISO-8601. */
  readonly validFrom: string;
  /**
   * Fim do intervalo de negócio (exclusivo), ISO-8601; null = aberto.
   * Em leituras as-known-at, fechamentos ainda não conhecidos no
   * knowledgeTime consultado são reportados como null.
   */
  readonly validTo: string | null;
  readonly validFromBasis: ValidFromBasis;
  readonly issuerId: IssuerId | null;
  readonly createdByRunId: IngestionRunId;
  /** Run que fechou o intervalo; null se aberto (ou fechamento não conhecido na visão consultada). */
  readonly closedByRunId: IngestionRunId | null;
}

interface InstrumentVersionInputBase {
  readonly symbol: string;
  readonly exchange: string;
  readonly currency: string;
  readonly displayName: string;
  readonly assetClass: AssetClass;
  readonly status: InstrumentLifecycleStatus;
  readonly priceScalePow?: number | null;
  readonly quantityScalePow?: number | null;
  readonly lotSize?: number | null;
  /** Código CVM do emissor (deve existir no lote ou já estar registrado); null/ausente = sem emissor. */
  readonly issuerCvmCode?: string | null;
}

/**
 * Pedido de nova versão de instrumento dentro de um lote de ingestão.
 *
 * União discriminada por `validFromBasis`: quando `SOURCE_EFFECTIVE`,
 * `validFrom` é obrigatório em tempo de compilação (a fonte precisa ter
 * declarado o instante). Quando `OBSERVED_AT`, `validFrom` é opcional;
 * se omitido, a unit of work o preenche, de forma conservadora, com o
 * `completedAt` da run — nunca com um relógio lido dentro do domínio.
 * O adaptador (limite Zod) impõe a mesma regra em runtime, já que a
 * união discriminada por si só não protege contra payloads externos
 * não tipados (JSON vindo de fora do TypeScript).
 */
export type InstrumentVersionInput =
  | (InstrumentVersionInputBase & { readonly validFromBasis: 'SOURCE_EFFECTIVE'; readonly validFrom: string })
  | (InstrumentVersionInputBase & { readonly validFromBasis: 'OBSERVED_AT'; readonly validFrom?: string });
