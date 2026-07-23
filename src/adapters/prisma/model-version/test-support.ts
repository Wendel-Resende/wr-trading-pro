import type { PrismaClient } from '@prisma/client';
import type { ModelVersionSubmission } from '../../../domain/v1/models/model-version';
import { PrismaModelVersionRepository } from './repository';

/**
 * LOTE 2 (Item C): `create()` sempre grava `publishedAt: null` (DRAFT) em
 * produção — nunca elegível para previsão até um claim CAS explícito (ver
 * `worker.ts`). Este helper é usado só por outras suítes de teste
 * (signal/backtest-run/model-version/ml-unified-reads) que sempre
 * esperaram uma `ModelVersion` já "ativa" ao inseri-la diretamente; por
 * padrão publica imediatamente para não quebrar esses testes pré-existentes
 * — passe `publish: false` para inserir explicitamente como DRAFT.
 */
export async function insertModelVersionForTest(
  prisma: PrismaClient,
  submission: ModelVersionSubmission,
  options: { readonly publish?: boolean } = {},
): Promise<string> {
  const repo = new PrismaModelVersionRepository(prisma);
  const version = await repo.create(submission);
  if (options.publish !== false) {
    await repo.publish(version.modelVersion, new Date().toISOString());
  }
  return version.modelVersion;
}
