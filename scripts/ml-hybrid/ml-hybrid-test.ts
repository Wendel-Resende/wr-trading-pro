import { PrismaClient } from '@prisma/client';
import { evaluateGate, type TrainingBlock } from '../../src/application/ml-hybrid/gate';
import {
  MlHybridService, createHttpMlApiPort, buildBarsAndSignals,
  type PaginatedRows, type SnapshotBarRow, type WalkforwardPredictionRow,
} from '../../src/application/ml-hybrid/service';
import { ReadModelError } from '../../src/application/read-models-v1/errors';
import { createBacktestCostProfileService } from '../../src/application/backtest-cost-profile';
import { emptyB3SessionCalendar } from '../../src/domain/v1/time/b3-session';

// G-003 item 5: 30 barras (não 20) para garantir que o sinal do teste de
// não-sobreposição em index 11 tenha barra de saída em t+10 (index 21) —
// senão seria descartado por `skippedMissingBar`, não por sobreposição.
const FAKE_BARS: SnapshotBarRow[] = Array.from({ length: 30 }, (_, i) => {
  const day = 5 + i; // 2026-01-05 .. 2026-02-03
  const month = day > 31 ? 2 : 1;
  const dom = day > 31 ? day - 31 : day;
  const time = `2026-${String(month).padStart(2, '0')}-${String(dom).padStart(2, '0')}T00:00:00.000Z`;
  const close = 100 + i;
  return { time, open: close - 0.5, high: close + 2, low: close - 2, close, volume: 1000 };
});

const FAKE_PREDICTIONS: WalkforwardPredictionRow[] = [
  { symbol: 'WEGE3', date: '2026-01-05T00:00:00.000Z', pModel: 0.9, foldId: 0,
    trainEnd: '2025-12-01T00:00:00.000Z', testStart: '2026-01-01T00:00:00.000Z', embargoCalDays: 30 },
];

function page<T>(rows: readonly T[]): PaginatedRows<T> {
  return { rows, total: rows.length, limit: rows.length || 1, offset: 0 };
}

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

function d9NonOverlapAndD8OffsetTests(): void {
  // Sinal em index 0 (2026-01-05) e outro em index 5 (2026-01-10, dentro do
  // horizonte de 10 barras do primeiro) — o segundo deve ser descartado por
  // sobreposição (D9); só o primeiro vira trade, fechando em t+10 (D8).
  const overlapping: WalkforwardPredictionRow[] = [
    { symbol: 'WEGE3', date: '2026-01-05T00:00:00.000Z', pModel: 0.9, foldId: 0,
      trainEnd: '2025-12-01T00:00:00.000Z', testStart: '2026-01-01T00:00:00.000Z', embargoCalDays: 30 },
    { symbol: 'WEGE3', date: '2026-01-10T00:00:00.000Z', pModel: 0.9, foldId: 0,
      trainEnd: '2025-12-01T00:00:00.000Z', testStart: '2026-01-01T00:00:00.000Z', embargoCalDays: 30 },
  ];
  const result = buildBarsAndSignals(FAKE_BARS, overlapping, emptyB3SessionCalendar());
  assert(result.signalCoverage.totalSignalsInWindow === 2, 'D9: dois sinais brutos no universo de entrada');
  assert(result.signalCoverage.acceptedSignals === 1, 'D9: só o primeiro sinal é aceito');
  assert(result.signalCoverage.skippedOverlapping === 1, 'D9: o segundo é descartado por sobreposição de holding');
  assert(result.signals.length === 1 && result.signals[0].barTime.startsWith('2026-01-05'),
    'D9: sinal sobrevivente é o primeiro (mais antigo), não o segundo');

  // Um sinal em index 11 (2026-01-16, FORA da janela de holding de 10 barras
  // do primeiro: 0+10=10) deve ser aceito — não é sobreposição de verdade.
  const nonOverlapping: WalkforwardPredictionRow[] = [
    overlapping[0],
    { symbol: 'WEGE3', date: '2026-01-16T00:00:00.000Z', pModel: 0.9, foldId: 1,
      trainEnd: '2025-12-15T00:00:00.000Z', testStart: '2026-01-11T00:00:00.000Z', embargoCalDays: 30 },
  ];
  const result2 = buildBarsAndSignals(FAKE_BARS, nonOverlapping, emptyB3SessionCalendar());
  assert(result2.signalCoverage.acceptedSignals === 2 && result2.signalCoverage.skippedOverlapping === 0,
    'D9: sinal exatamente no limite do horizonte (t+10) não é tratado como sobreposto');
  assert(result2.foldsCovered.length === 2, 'D3/D11: fold metadata de ambos os sinais aceitos preservado');

  console.log('D9 (não sobreposição por ticker, offset D8 usado corretamente): OK');
}

function d8MissingExitBarTests(): void {
  // Sinal no último índice do snapshot (index 29 de 30, 2026-02-03): não
  // existe barra em t+10 (index 39) dentro do universo congelado — o motor
  // não teria como fechar a posição. Deve ser descartado e contado em
  // `skippedMissingBar`, nunca aceito silenciosamente nem confundido com
  // `skippedOverlapping`.
  const lastBar = FAKE_BARS[FAKE_BARS.length - 1];
  const noExitBar: WalkforwardPredictionRow[] = [
    { symbol: 'WEGE3', date: lastBar.time, pModel: 0.9, foldId: 0,
      trainEnd: '2025-12-01T00:00:00.000Z', testStart: '2026-01-01T00:00:00.000Z', embargoCalDays: 30 },
  ];
  const result = buildBarsAndSignals(FAKE_BARS, noExitBar, emptyB3SessionCalendar());
  assert(result.signalCoverage.acceptedSignals === 0, 'D8: sinal sem barra t+horizon nunca é aceito');
  assert(result.signalCoverage.skippedMissingBar === 1, 'D8: descarte por barra de saída ausente é refletido em skippedMissingBar');
  assert(result.signalCoverage.skippedOverlapping === 0, 'D8: descarte por barra ausente não é confundido com sobreposição');
  assert(result.signals.length === 0, 'D8: nenhum sinal sem barra de saída entra no motor');

  // Sinal sem NENHUMA barra correspondente no snapshot (data fora do universo).
  const noEntryBar: WalkforwardPredictionRow[] = [
    { symbol: 'WEGE3', date: '2030-01-01T00:00:00.000Z', pModel: 0.9, foldId: 0,
      trainEnd: '2025-12-01T00:00:00.000Z', testStart: '2026-01-01T00:00:00.000Z', embargoCalDays: 30 },
  ];
  const result2 = buildBarsAndSignals(FAKE_BARS, noEntryBar, emptyB3SessionCalendar());
  assert(result2.signalCoverage.skippedMissingBar === 1, 'D8: sinal sem barra de entrada também conta em skippedMissingBar');

  console.log('D8 (sinal sem barra t+horizon nunca é aceito): OK');
}

async function serviceTests(): Promise<void> {
  const prisma = new PrismaClient();
  const strongBlocks = Array.from({ length: 80 }, (_, i) => ({
    block: `T${i % 7}:2024-${(i % 12) + 1}`, n: 10, hitsModel: 8,
    hitsAlwaysUp: 5, hitsTimesfm: 5, hitsFundamental: 5, hitsPriceOnly: 5 }));
  const trainResult = {
    datasetHash: 'sha256:abc', datasetDigest: 'abc'.repeat(21) + 'a', universeBarsDigest: 'b'.repeat(64),
    universe: ['WEGE3'],
    windowStart: '2019-01-05', windowEnd: '2026-07-17',
    hyperparameters: { max_depth: 6 }, aggregate: { nSamples: 800, accuracy: 0.8 },
    baselines: { alwaysUp: { accuracy: 0.5 }, timesfmOnly: { accuracy: 0.5 },
      fundamentalOnly: { accuracy: 0.5 }, priceOnlyLgbm: { accuracy: 0.5 } },
    blocks: strongBlocks,
    backtest: { metrics: { totalReturn: 0.1, maxDrawdown: -0.05, nRebalances: 40 } },
    artifact: { hash: 'd'.repeat(64), path: 'data/ml/models/deadbeef/model.txt' },
  };
  const fakeApi = {
    backfill: async () => ({ ok: ['WEGE3'], failed: {} }),
    train: async () => trainResult,
    predict: async (symbol: string) => ({
      symbol, date: '2026-07-17', direction: 'BUY' as const, score: 0.62,
      topFeatures: [{ name: 'tfm_ret_10', importance: 10 }], sourceMeta: {} }),
    getWalkforwardPredictions: async () => page(FAKE_PREDICTIONS),
    getSnapshotBars: async () => page(FAKE_BARS),
  };

  const costProfileService = createBacktestCostProfileService(prisma);
  const costProfile = await costProfileService.create(
    { version: 1, label: 'b3-equities-retail-v1', fixedBrokerage: 0, emolumentsPct: 0.0005,
      spreadBps: 5, slippageBps: 5, lotSize: 100, source: 'tarifario-teste' },
    'guardiao-admin',
  );

  const service = new MlHybridService({ mlApi: fakeApi, prisma });

  const approved = await service.runTraining('test-user', costProfile.id);
  assert(approved.gate.approved && approved.modelVersionId !== null,
    'treino aprovado cria ModelVersion');
  const run = await prisma.researchRun.findUnique({ where: { runId: approved.researchRunId } });
  assert(run !== null && run.datasetId === 'sha256:abc', 'ResearchRun persistido com datasetHash');

  const modelVersion = await prisma.modelVersion.findUnique({ where: { modelVersion: approved.modelVersionId! } });
  assert(modelVersion !== null && modelVersion.trainingEvidenceJson !== null, 'ModelVersion persistida com trainingEvidenceJson');
  const evidence = JSON.parse(modelVersion!.trainingEvidenceJson!);
  assert(evidence.backtestProxy !== undefined && evidence.gate.approved === true,
    'trainingEvidenceJson contém backtestProxy e gate.approved === true');

  // Item A: treino aprovado dispara backtest econômico real por instrumento (D2/D8/D9/D10).
  assert(approved.backtests !== null, 'treino aprovado sempre tenta o backtest real');
  assert(approved.backtests!.coverage === 'COMPLETE', 'universo inteiro (WEGE3) coberto sem skip');
  assert(approved.backtests!.created.length === 1, 'um BacktestRun real criado para WEGE3');
  const backtestRun = await prisma.backtestRun.findUnique({ where: { backtestId: approved.backtests!.created[0] } });
  assert(backtestRun !== null && backtestRun.metricsSchemaVersion === 1, 'BacktestRun usa o envelope versionado (D10)');
  assert(backtestRun!.predictionHorizonBars === 10, 'horizonte de previsão gravado é 10 pregões (D8)');
  assert(backtestRun!.costProfileId === costProfile.id, 'BacktestRun referencia o BacktestCostProfile usado (D5)');
  const envelope = JSON.parse(backtestRun!.metricsJson);
  assert(envelope.provenance.artifactHash === 'd'.repeat(64), 'envelope grava artifactHash (D10 provenance)');
  assert(envelope.provenance.universeBarsDigest === 'b'.repeat(64) && envelope.provenance.datasetDigest === trainResult.datasetDigest,
    'envelope separa universeBarsDigest de datasetDigest (D-hash)');

  // Rodar `runTraining` de novo cria uma ModelVersion NOVA (cada treino é uma
  // submissão distinta) — a chave de idempotência do BacktestRun inclui
  // `modelVersionId` de propósito (D10), então este segundo treino gera um
  // BacktestRun novo e legítimo, não um duplicado do primeiro. A idempotência
  // de verdade (mesma chamada exata, mesmo modelVersionId) já é testada
  // diretamente em scripts/backtest-run/backtest-run-test.ts (D10).
  const approvedAgain = await service.runTraining('test-user', costProfile.id);
  assert(approvedAgain.modelVersionId !== approved.modelVersionId,
    'cada runTraining cria sua própria ModelVersion');
  assert(approvedAgain.backtests!.created.length === 1 && approvedAgain.backtests!.alreadyExists.length === 0,
    'BacktestRun do segundo treino é novo e legítimo (chave inclui o modelVersionId novo)');

  // Sem costProfileId -> falha explícita, nada é executado.
  await service.runTraining('test-user', '').then(
    () => assert(false, 'runTraining sem costProfileId deveria falhar'),
    (error: unknown) => assert(error instanceof ReadModelError && error.code === 'COST_PROFILE_REQUIRED',
      'runTraining sem costProfileId falha COST_PROFILE_REQUIRED (D5)'),
  );

  const live = await service.predictLive('WEGE3');
  const signal = await prisma.signal.findUnique({ where: { signalId: live.signalId } });
  assert(signal !== null && signal.direction === 'BUY' && signal.instrumentId === 'WEGE3',
    'predictLive persiste Signal');

  const weakBlocks = strongBlocks.map((b) => ({ ...b, hitsModel: 5 }));
  const rejApi = { ...fakeApi, train: async () => ({ ...trainResult, blocks: weakBlocks }) };
  const rejected = await new MlHybridService({ mlApi: rejApi, prisma }).runTraining('test-user', costProfile.id);
  assert(!rejected.gate.approved && rejected.modelVersionId === null,
    'treino reprovado registra ResearchRun sem ModelVersion');
  assert(rejected.backtests === null, 'treino reprovado NUNCA dispara backtest real (sem ModelVersion p/ provar)');
  await prisma.$disconnect();
}

async function httpMlApiPortTests(): Promise<void> {
  const calledUrls: string[] = [];
  const okFetch = (async (input: RequestInfo | URL) => {
    calledUrls.push(String(input));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const port = createHttpMlApiPort('http://x:1', okFetch);
  await port.train();
  assert(calledUrls[calledUrls.length - 1] === 'http://x:1/ml/train', 'createHttpMlApiPort.train chama /ml/train');

  await port.backfill();
  assert(calledUrls[calledUrls.length - 1] === 'http://x:1/ml/backfill', 'createHttpMlApiPort.backfill chama /ml/backfill');

  await port.predict('WEGE3', 'deadbeef');
  assert(calledUrls[calledUrls.length - 1] === 'http://x:1/ml/predict', 'createHttpMlApiPort.predict chama /ml/predict');

  const errorFetch = (async () =>
    new Response(JSON.stringify({ error: 'MODEL_NOT_FOUND' }), { status: 404 })) as typeof fetch;
  const errorPort = createHttpMlApiPort('http://x:1', errorFetch);
  try {
    await errorPort.train();
    assert(false, 'não-2xx deve lançar ReadModelError');
  } catch (error) {
    assert(
      error instanceof ReadModelError && error.code === 'UPSTREAM_ERROR' && error.message === 'MODEL_NOT_FOUND',
      'não-2xx vira ReadModelError UPSTREAM_ERROR com body.error',
    );
  }

  const connRefusedFetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  const downPort = createHttpMlApiPort('http://x:1', connRefusedFetch);
  try {
    await downPort.train();
    assert(false, 'falha de conexão deve lançar ReadModelError');
  } catch (error) {
    assert(
      error instanceof ReadModelError && error.code === 'UPSTREAM_ERROR',
      'motor ML fora do ar vira ReadModelError UPSTREAM_ERROR (não escapa como exceção crua p/ INTERNAL_ERROR)',
    );
  }

  const timeoutFetch = (async () => {
    const err = new Error('The operation was aborted');
    err.name = 'TimeoutError';
    throw err;
  }) as typeof fetch;
  const timeoutPort = createHttpMlApiPort('http://x:1', timeoutFetch);
  try {
    await timeoutPort.train();
    assert(false, 'timeout deve lançar ReadModelError');
  } catch (error) {
    assert(
      error instanceof ReadModelError && error.code === 'UPSTREAM_TIMEOUT',
      'timeout de AbortSignal vira ReadModelError UPSTREAM_TIMEOUT',
    );
  }
}

(async () => {
  await gateTests();
  d9NonOverlapAndD8OffsetTests();
  d8MissingExitBarTests();
  await serviceTests();
  await httpMlApiPortTests();
})();
