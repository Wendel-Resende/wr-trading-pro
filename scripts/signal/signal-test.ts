import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';
import { insertModelVersionForTest } from '../../src/adapters/prisma/model-version';
import { insertSignalForTest, PrismaSignalRepository, SignalSubmissionSchema } from '../../src/adapters/prisma/signal';
import { createSignalService } from '../../src/application/signal';
import { PrismaModelVersionRepository } from '../../src/adapters/prisma/model-version';
import type { SignalSubmission } from '../../src/domain/v1/models/signal';

function baseSubmission(modelVersionId: string, overrides: Partial<SignalSubmission> = {}): SignalSubmission {
  return {
    modelVersionId,
    instrumentId: 'B3:PETR4',
    barTime: '2026-06-10T18:00:00.000Z',
    direction: 'BUY',
    score: 0.73,
    knowledgeTime: '2026-06-10T18:00:00.000Z',
    ...overrides,
  };
}

async function strictSchemaRejectsExtraField(): Promise<void> {
  const raw = { ...baseSubmission('mv-1'), extraField: 'nope' };
  assert.throws(() => SignalSubmissionSchema.parse(raw), ZodError, 'campo extra deve ser rejeitado por .strict()');
  console.log('R-RM: Signal Zod .strict() rejeita campo extra — OK');
}

async function knowledgeTimeAfterBarTimeRejected(): Promise<void> {
  const raw = baseSubmission('mv-1', { barTime: '2026-06-10T18:00:00.000Z', knowledgeTime: '2026-06-10T18:00:00.001Z' });
  assert.throws(() => SignalSubmissionSchema.parse(raw), ZodError, 'knowledgeTime > barTime deve ser rejeitado (point-in-time)');
  console.log('R-RM: Signal knowledgeTime > barTime rejeitado — OK (point-in-time)');
}

async function knowledgeTimeEqualBarTimeAccepted(): Promise<void> {
  const raw = baseSubmission('mv-1', { barTime: '2026-06-10T18:00:00.000Z', knowledgeTime: '2026-06-10T18:00:00.000Z' });
  const parsed = SignalSubmissionSchema.parse(raw);
  assert.equal(parsed.knowledgeTime, raw.knowledgeTime);
  console.log('R-RM: Signal knowledgeTime === barTime aceito — OK (limite inclusivo)');
}

async function generateRequiresExistingUninvalidatedModelVersion(prisma: PrismaClient): Promise<void> {
  const service = createSignalService(prisma);
  await assert.rejects(
    async () => service.generate(baseSubmission('does-not-exist')),
    (error: unknown) => (error as { code?: string })?.code === 'MODEL_VERSION_NOT_FOUND',
    'signal referenciando ModelVersion inexistente deve falhar',
  );

  const modelVersionId = await insertModelVersionForTest(prisma, {
    kind: 'ML',
    label: 'test model',
    asOf: '2026-06-01T00:00:00.000Z',
    hyperparametersJson: '{}',
    trainingEvidenceJson: JSON.stringify({ fitAccuracy: 0.6 }),
  });
  const created = await service.generate(baseSubmission(modelVersionId));
  assert.equal(created.modelVersionId, modelVersionId);

  const versionRepo = new PrismaModelVersionRepository(prisma);
  await versionRepo.invalidate(modelVersionId, '2026-06-05T00:00:00.000Z', 'test invalidation');
  await assert.rejects(
    async () => service.generate(baseSubmission(modelVersionId)),
    (error: unknown) => (error as { code?: string })?.code === 'INVALID_MODEL_VERSION',
    'signal referenciando ModelVersion invalidado deve falhar',
  );
  console.log('R-RM: Signal.generate exige ModelVersion existente e não invalidado — OK');
}

async function createAndReadBack(prisma: PrismaClient): Promise<void> {
  const modelVersionId = await insertModelVersionForTest(prisma, {
    kind: 'RULE',
    label: 'ma crossover',
    asOf: '2026-06-01T00:00:00.000Z',
    hyperparametersJson: '{}',
  });
  const repo = new PrismaSignalRepository(prisma);
  const signalId = await insertSignalForTest(prisma, baseSubmission(modelVersionId));
  const found = await repo.findById(signalId);
  assert.ok(found);
  assert.equal(found?.instrumentId, 'B3:PETR4');
  const byInstrument = await repo.findByInstrument('B3:PETR4');
  assert.ok(byInstrument.length >= 1);
  console.log('R-RM: Signal criação + leitura por id/instrumento — OK');
}

async function main(): Promise<void> {
  await strictSchemaRejectsExtraField();
  await knowledgeTimeAfterBarTimeRejected();
  await knowledgeTimeEqualBarTimeAccepted();
  const prisma = new PrismaClient();
  try {
    await generateRequiresExistingUninvalidatedModelVersion(prisma);
    await createAndReadBack(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log('Fase 5 / Signal (R-RM): TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
