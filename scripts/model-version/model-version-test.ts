import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';
import { insertModelVersionForTest, ModelVersionSubmissionSchema, PrismaModelVersionRepository } from '../../src/adapters/prisma/model-version';
import type { ModelVersionSubmission } from '../../src/domain/v1/models/model-version';

function mlSubmission(overrides: Partial<ModelVersionSubmission> = {}): ModelVersionSubmission {
  return {
    kind: 'ML',
    label: 'RandomForest v1',
    asOf: '2026-06-01T00:00:00.000Z',
    hyperparametersJson: JSON.stringify({ nEstimators: 200, maxDepth: 6 }),
    trainingEvidenceJson: JSON.stringify({ fitAccuracy: 0.61, validationAccuracy: 0.57, testSharpe: 0.8 }),
    ...overrides,
  };
}

async function strictSchemaRejectsExtraField(): Promise<void> {
  const raw = { ...mlSubmission(), extraField: 'nope' };
  assert.throws(() => ModelVersionSubmissionSchema.parse(raw), ZodError, 'campo extra deve ser rejeitado por .strict()');
  console.log('R-RM: ModelVersion Zod .strict() rejeita campo extra — OK');
}

async function mlWithoutEvidenceRejected(): Promise<void> {
  const raw = mlSubmission({ trainingEvidenceJson: null });
  assert.throws(() => ModelVersionSubmissionSchema.parse(raw), ZodError, "kind='ML' sem trainingEvidenceJson deve ser rejeitado (A20)");
  console.log("R-RM: ModelVersion kind='ML' sem trainingEvidenceJson rejeitado — OK (corrige A20)");
}

async function ruleWithoutEvidenceAccepted(): Promise<void> {
  const raw: ModelVersionSubmission = {
    kind: 'RULE',
    label: 'MA crossover',
    asOf: '2026-06-01T00:00:00.000Z',
    hyperparametersJson: JSON.stringify({ fastMa: 9, slowMa: 21 }),
  };
  const parsed = ModelVersionSubmissionSchema.parse(raw);
  assert.equal(parsed.kind, 'RULE');
  console.log("R-RM: ModelVersion kind='RULE' sem trainingEvidenceJson aceito — OK");
}

async function invalidationQueryable(prisma: PrismaClient): Promise<void> {
  const repo = new PrismaModelVersionRepository(prisma);
  const modelVersionId = await insertModelVersionForTest(prisma, mlSubmission());
  const before = await repo.findById(modelVersionId);
  assert.equal(before?.invalidatedAt, null);

  const invalidated = await repo.invalidate(modelVersionId, '2026-07-01T00:00:00.000Z', 'regime shift detectado');
  assert.equal(invalidated.invalidationReason, 'regime shift detectado');
  assert.equal(invalidated.invalidatedAt, '2026-07-01T00:00:00.000Z');

  const after = await repo.findById(modelVersionId);
  assert.equal(after?.invalidatedAt, '2026-07-01T00:00:00.000Z');
  console.log('R-RM: ModelVersion invalidação registrada e consultável — OK');
}

async function main(): Promise<void> {
  await strictSchemaRejectsExtraField();
  await mlWithoutEvidenceRejected();
  await ruleWithoutEvidenceAccepted();
  const prisma = new PrismaClient();
  try {
    await invalidationQueryable(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log('Fase 5 / ModelVersion (R-RM): TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
