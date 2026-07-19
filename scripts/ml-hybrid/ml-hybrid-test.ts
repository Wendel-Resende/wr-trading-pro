import { PrismaClient } from '@prisma/client';
import { evaluateGate, type TrainingBlock } from '../../src/application/ml-hybrid/gate';
import { MlHybridService } from '../../src/application/ml-hybrid/service';

function block(i: number, nHits: { model: number; base: number }, n = 10): TrainingBlock {
  return { block: `T${i % 7}:2024-${(i % 12) + 1}`, n, hitsModel: nHits.model,
    hitsAlwaysUp: nHits.base, hitsTimesfm: nHits.base,
    hitsFundamental: nHits.base, hitsPriceOnly: nHits.base };
}
function assert(cond: unknown, msg: string): void {
  if (!cond) { console.error(`FALHOU: ${msg}`); process.exit(1); }
  console.log(`ok: ${msg}`);
}

async function gateTests(): Promise<void> {
  // modelo claramente melhor (8/10 vs 5/10 em 80 blocos) → aprovado
  const strong = Array.from({ length: 80 }, (_, i) => block(i, { model: 8, base: 5 }));
  const g1 = evaluateGate(strong);
  assert(g1.approved, 'gate aprova modelo consistentemente superior');
  assert(g1.comparisons.length === 4 && g1.comparisons.every((c) => c.passed), '4 comparações, todas passam');

  // diferença nula → reprovado
  const flat = Array.from({ length: 80 }, (_, i) => block(i, { model: 6, base: 6 }));
  assert(!evaluateGate(flat).approved, 'gate reprova diferença nula');

  // determinismo: mesma seed → mesmo resultado
  const a = evaluateGate(strong, { seed: 42 });
  const b = evaluateGate(strong, { seed: 42 });
  assert(JSON.stringify(a) === JSON.stringify(b), 'bootstrap determinístico com seed fixa');

  console.log('ml-hybrid gate: TODOS OS TESTES PASSARAM');
}

async function serviceTests(): Promise<void> {
  const prisma = new PrismaClient();
  const strongBlocks = Array.from({ length: 80 }, (_, i) => ({
    block: `T${i % 7}:2024-${(i % 12) + 1}`, n: 10, hitsModel: 8,
    hitsAlwaysUp: 5, hitsTimesfm: 5, hitsFundamental: 5, hitsPriceOnly: 5 }));
  const trainResult = {
    datasetHash: 'sha256:abc', windowStart: '2019-01-05', windowEnd: '2026-07-17',
    hyperparameters: { max_depth: 6 }, aggregate: { nSamples: 800, accuracy: 0.8 },
    baselines: { alwaysUp: { accuracy: 0.5 }, timesfmOnly: { accuracy: 0.5 },
      fundamentalOnly: { accuracy: 0.5 }, priceOnlyLgbm: { accuracy: 0.5 } },
    blocks: strongBlocks,
    backtest: { metrics: { totalReturn: 0.1, maxDrawdown: -0.05, nRebalances: 40 } },
    artifact: { hash: 'deadbeef', path: 'data/ml/models/deadbeef/model.txt' },
  };
  const fakeApi = {
    backfill: async () => ({ ok: ['WEGE3'], failed: {} }),
    train: async () => trainResult,
    predict: async (symbol: string) => ({
      symbol, date: '2026-07-17', direction: 'BUY' as const, score: 0.62,
      topFeatures: [{ name: 'tfm_ret_10', importance: 10 }], sourceMeta: {} }),
  };
  const service = new MlHybridService({ mlApi: fakeApi, prisma });

  const approved = await service.runTraining('test-user');
  assert(approved.gate.approved && approved.modelVersionId !== null,
    'treino aprovado cria ModelVersion');
  const run = await prisma.researchRun.findUnique({ where: { runId: approved.researchRunId } });
  assert(run !== null && run.datasetId === 'sha256:abc', 'ResearchRun persistido com datasetHash');

  const modelVersion = await prisma.modelVersion.findUnique({ where: { modelVersion: approved.modelVersionId! } });
  assert(modelVersion !== null && modelVersion.trainingEvidenceJson !== null, 'ModelVersion persistida com trainingEvidenceJson');
  const evidence = JSON.parse(modelVersion!.trainingEvidenceJson!);
  assert(evidence.backtestProxy !== undefined && evidence.gate.approved === true,
    'trainingEvidenceJson contém backtestProxy e gate.approved === true');

  const live = await service.predictLive('WEGE3');
  const signal = await prisma.signal.findUnique({ where: { signalId: live.signalId } });
  assert(signal !== null && signal.direction === 'BUY' && signal.instrumentId === 'WEGE3',
    'predictLive persiste Signal');

  const weakBlocks = strongBlocks.map((b) => ({ ...b, hitsModel: 5 }));
  const rejApi = { ...fakeApi, train: async () => ({ ...trainResult, blocks: weakBlocks }) };
  const rejected = await new MlHybridService({ mlApi: rejApi, prisma }).runTraining('test-user');
  assert(!rejected.gate.approved && rejected.modelVersionId === null,
    'treino reprovado registra ResearchRun sem ModelVersion');
  await prisma.$disconnect();
}

(async () => {
  await gateTests();
  await serviceTests();
})();
