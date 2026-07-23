import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';
import { insertResearchRunForTest } from '../../src/adapters/prisma/research-run';
import { PrismaResearchRunRepository, ResearchRunSubmissionSchema } from '../../src/adapters/prisma/research-run';
import type { ResearchRunSubmission } from '../../src/domain/v1/models/research-run';

function baseSubmission(overrides: Partial<ResearchRunSubmission> = {}): ResearchRunSubmission {
  return {
    name: 'MA crossover WINFUT',
    hypothesis: 'Cruzamento de médias móveis captura tendência de curto prazo em WIN',
    datasetId: 'dataset:win-1d',
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-06-01T00:00:00.000Z',
    paramsJson: JSON.stringify({ fastMa: 9, slowMa: 21 }),
    ...overrides,
  };
}

async function strictSchemaRejectsExtraField(): Promise<void> {
  const raw = { ...baseSubmission(), extraField: 'should not be here' };
  assert.throws(() => ResearchRunSubmissionSchema.parse(raw), ZodError, 'campo extra deve ser rejeitado por .strict()');
  console.log('R-RM: ResearchRun Zod .strict() rejeita campo extra — OK');
}

async function invalidWindowRejected(): Promise<void> {
  const raw = baseSubmission({ windowStart: '2026-06-01T00:00:00.000Z', windowEnd: '2026-01-01T00:00:00.000Z' });
  assert.throws(() => ResearchRunSubmissionSchema.parse(raw), ZodError, 'windowStart >= windowEnd deve ser rejeitado');
  console.log('R-RM: ResearchRun janela inválida (windowStart >= windowEnd) rejeitada — OK');
}

async function createAndReadBack(prisma: PrismaClient): Promise<void> {
  const repo = new PrismaResearchRunRepository(prisma);
  const runId = await insertResearchRunForTest(prisma, 'guardiao', baseSubmission());
  const found = await repo.findById(runId);
  assert.ok(found);
  assert.equal(found?.createdBy, 'guardiao');
  const byDataset = await repo.findByDataset('dataset:win-1d');
  assert.ok(byDataset.length >= 1);
  console.log('R-RM: ResearchRun criação + leitura por id/dataset — OK');
}

async function linkModelVersionAndFindRecentByName(prisma: PrismaClient): Promise<void> {
  const repo = new PrismaResearchRunRepository(prisma);
  const runId = await insertResearchRunForTest(prisma, 'guardiao', baseSubmission({ name: 'ml-hybrid-swing-v1-test' }));

  const linked = await repo.linkModelVersion(runId, 'mv-fake-id');
  assert.equal(linked.modelVersionId, 'mv-fake-id');

  const found = await repo.findById(runId);
  assert.equal(found?.modelVersionId, 'mv-fake-id', 'linkModelVersion persiste modelVersionId (bloqueador 2)');

  // Segundo run mais recente, mesmo nome — findRecentByName deve ordenar createdAt desc.
  await new Promise((resolve) => setTimeout(resolve, 5));
  const runId2 = await insertResearchRunForTest(prisma, 'guardiao', baseSubmission({ name: 'ml-hybrid-swing-v1-test' }));

  const recent = await repo.findRecentByName('ml-hybrid-swing-v1-test', 10);
  assert.ok(recent.length >= 2, 'findRecentByName retorna ambos os runs do nome');
  assert.equal(recent[0].runId, runId2, 'findRecentByName ordena por createdAt desc (mais recente primeiro)');

  console.log('R-RM: ResearchRun linkModelVersion + findRecentByName — OK');
}

async function main(): Promise<void> {
  await strictSchemaRejectsExtraField();
  await invalidWindowRejected();
  const prisma = new PrismaClient();
  try {
    await createAndReadBack(prisma);
    await linkModelVersionAndFindRecentByName(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log('Fase 5 / ResearchRun (R-RM): TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
