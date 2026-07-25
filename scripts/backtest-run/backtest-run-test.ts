import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import {
  applyEmbargo,
  PointInTimeViolationError,
  runDeterministicBacktest,
  type BacktestBar,
  type BacktestSignalInput,
} from '../../src/domain/v1/models/backtest-run';
import { insertResearchRunForTest } from '../../src/adapters/prisma/research-run';
import { insertModelVersionForTest } from '../../src/adapters/prisma/model-version';
import { createBacktestRunService } from '../../src/application/backtest-run';
import type { GovernedBacktestRunRequestV1 } from '../../src/application/backtest-run';
import { insertBacktestRunForTest } from '../../src/adapters/prisma/backtest-run';
import { createBacktestCostProfileService } from '../../src/application/backtest-cost-profile';
import { ReadModelError } from '../../src/application/read-models-v1';

const NO_COSTS = { fixedBrokerage: 0, emolumentsPct: 0, spreadBps: 0, slippageBps: 0, lotSize: 10 };
const REAL_COSTS = { fixedBrokerage: 5, emolumentsPct: 0.00325, spreadBps: 2, slippageBps: 1, lotSize: 10 };

function bars(): BacktestBar[] {
  // Five daily bars; knowledgeTime === time (known exactly at the bar's own close), satisfying point-in-time trivially.
  const raw: Array<[string, number, number, number, number]> = [
    ['2026-01-05T00:00:00.000Z', 100, 105, 99, 104],
    ['2026-01-06T00:00:00.000Z', 104, 106, 95, 96], // low dips to 95: candidate stop trigger
    ['2026-01-07T00:00:00.000Z', 96, 110, 95, 108], // high spikes to 110: candidate take-profit trigger
    ['2026-01-08T00:00:00.000Z', 108, 112, 107, 111],
    ['2026-01-09T00:00:00.000Z', 111, 113, 109, 112],
  ];
  return raw.map(([time, open, high, low, close]) => ({ time, open, high, low, close, knowledgeTime: time }));
}

function buySignal(overrides: Partial<BacktestSignalInput> = {}): BacktestSignalInput {
  return { barTime: '2026-01-05T00:00:00.000Z', direction: 'BUY', knowledgeTime: '2026-01-05T00:00:00.000Z', ...overrides };
}

/** 15 barras diárias sem stop/TP, close crescendo 1/dia — o suficiente para
 *  cobrir sinal em t=0 (2026-01-05) até t+10 (2026-01-19) sem esbarrar no
 *  fim da janela, isolando o corte por horizonte (D8) de WINDOW_END. */
function longBars(): BacktestBar[] {
  const out: BacktestBar[] = [];
  for (let i = 0; i < 15; i += 1) {
    const day = 5 + i; // 2026-01-05 .. 2026-01-19
    const time = `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;
    const close = 100 + i;
    out.push({ time, open: close - 0.5, high: close + 2, low: close - 2, close, knowledgeTime: time });
  }
  return out;
}

function rbt1NoLookahead(): void {
  const result = runDeterministicBacktest({ bars: bars(), signals: [buySignal()], costs: NO_COSTS, periodsPerYear: 252, entryRule: 'open_next_bar' });
  assert.equal(result.trades.length, 1);
  const trade = result.trades[0];
  assert.ok(trade.entryTime > trade.signalBarTime, 'entryTime deve ser estritamente posterior a signal.barTime');
  assert.equal(trade.entryTime, '2026-01-06T00:00:00.000Z', 'entrada deve ser a barra SEGUINTE ao sinal (t+1), nunca a própria');
  assert.equal(trade.entryPrice, 104, 'entryPrice deve ser o OPEN da barra t+1, não o close de t');
  console.log('R-BT-1 (sem lookahead, CR-9): entryBar.time > signal.barTime — OK');
}

function rbt2IntrabarStopTp(): void {
  // Stop below bar[1].low (95) so it must trigger intrabar on 2026-01-06, never only at close.
  const stopResult = runDeterministicBacktest({
    bars: bars(),
    signals: [buySignal({ stopPrice: 95.5 })],
    costs: NO_COSTS,
    periodsPerYear: 252,
    entryRule: 'open_next_bar',
  });
  const stopTrade = stopResult.trades[0];
  assert.equal(stopTrade.exitReason, 'STOP');
  assert.equal(stopTrade.exitTime, '2026-01-06T00:00:00.000Z', 'stop deve disparar intrabar na própria barra de entrada, não no close');
  assert.equal(stopTrade.exitPrice, 95.5, 'exitPrice deve ser o stopPrice, não o close da barra');

  // Take-profit above bar[2].high (110) triggers intrabar on 2026-01-07.
  const tpResult = runDeterministicBacktest({
    bars: bars(),
    signals: [buySignal({ takeProfitPrice: 109.5 })],
    costs: NO_COSTS,
    periodsPerYear: 252,
    entryRule: 'open_next_bar',
  });
  const tpTrade = tpResult.trades[0];
  assert.equal(tpTrade.exitReason, 'TAKE_PROFIT');
  assert.equal(tpTrade.exitTime, '2026-01-07T00:00:00.000Z');
  assert.equal(tpTrade.exitPrice, 109.5);
  console.log('R-BT-2 (intrabar stop/TP via high/low): OK');
}

function rbt3RealCosts(): void {
  const withoutCosts = runDeterministicBacktest({ bars: bars(), signals: [buySignal()], costs: NO_COSTS, periodsPerYear: 252, entryRule: 'open_next_bar' });
  const withCosts = runDeterministicBacktest({ bars: bars(), signals: [buySignal()], costs: REAL_COSTS, periodsPerYear: 252, entryRule: 'open_next_bar' });

  assert.equal(withoutCosts.trades[0].costs, 0);
  assert.ok(withCosts.trades[0].costs > 0, 'com custos reais, costs deve ser > 0 — nunca 0 silenciosamente');
  assert.ok(
    withCosts.trades[0].netPnl < withoutCosts.trades[0].netPnl,
    'netPnl com custos reais deve ser estritamente menor que sem custos (mesmo grossPnl)',
  );
  assert.equal(withCosts.trades[0].grossPnl, withoutCosts.trades[0].grossPnl, 'grossPnl não deve ser afetado por custos, só netPnl');
  console.log('R-BT-3 (custos reais, A19): custos subtraídos do resultado líquido — OK');
}

function rbt4SharpePeriodsPerYear(): void {
  // Two signals with distinct outcomes so the return series has non-zero variance (Sharpe requires stdDev > 0).
  const signals = [
    buySignal({ barTime: '2026-01-05T00:00:00.000Z', knowledgeTime: '2026-01-05T00:00:00.000Z' }),
    buySignal({ barTime: '2026-01-07T00:00:00.000Z', knowledgeTime: '2026-01-07T00:00:00.000Z' }),
  ];
  const asDailyPeriods = runDeterministicBacktest({ bars: bars(), signals, costs: NO_COSTS, periodsPerYear: 252, entryRule: 'open_next_bar' });
  const asHourlyPeriods = runDeterministicBacktest({ bars: bars(), signals, costs: NO_COSTS, periodsPerYear: 252 * 6.5, entryRule: 'open_next_bar' });

  assert.notEqual(asDailyPeriods.metrics.sharpe, asHourlyPeriods.metrics.sharpe, 'Sharpe deve variar com periodsPerYear do timeframe real');
  const expectedRatio = Math.sqrt(252 * 6.5) / Math.sqrt(252);
  const actualRatio = asHourlyPeriods.metrics.sharpe / asDailyPeriods.metrics.sharpe;
  assert.ok(Math.abs(actualRatio - expectedRatio) < 1e-9, 'Sharpe deve escalar exatamente por sqrt(periodsPerYear), nunca sqrt(252) fixo');
  console.log('R-BT-4 (Sharpe por período real, não sqrt(252) fixo): OK');
}

function rbt5EmbargoPurge(): void {
  const testBars = bars();
  const trainEnd = '2026-01-06T00:00:00.000Z';
  const embargoDays = 2;
  const purged = applyEmbargo(testBars, trainEnd, embargoDays);
  // Embargo window: [2026-01-06, 2026-01-08) must be discarded; 2026-01-08 and 2026-01-09 survive.
  for (const bar of purged) {
    assert.ok(bar.time >= '2026-01-08T00:00:00.000Z', `barra ${bar.time} deveria ter sido descartada pelo embargo`);
  }
  assert.equal(purged.length, 2, 'apenas as barras fora da janela de embargo devem sobreviver');
  console.log('R-BT-5 (embargo/purge): barra de teste dentro do embargo descartada — OK');
}

function rbt6Determinism(): void {
  const first = runDeterministicBacktest({ bars: bars(), signals: [buySignal({ stopPrice: 95.5 })], costs: REAL_COSTS, periodsPerYear: 252, entryRule: 'open_next_bar' });
  const second = runDeterministicBacktest({ bars: bars(), signals: [buySignal({ stopPrice: 95.5 })], costs: REAL_COSTS, periodsPerYear: 252, entryRule: 'open_next_bar' });
  assert.deepEqual(first.trades, second.trades, 'mesma entrada deve produzir os mesmos trades');
  assert.deepEqual(first.metrics, second.metrics, 'mesma entrada deve produzir as mesmas métricas');
  console.log('R-BT-6 (determinismo): mesma entrada -> mesma saída — OK');
}

function rbt7PointInTime(): void {
  const corruptedBars = bars().map((bar, index) => (index === 1 ? { ...bar, knowledgeTime: '2026-01-07T00:00:00.000Z' } : bar));
  assert.throws(
    () => runDeterministicBacktest({ bars: corruptedBars, signals: [buySignal()], costs: NO_COSTS, periodsPerYear: 252, entryRule: 'open_next_bar' }),
    PointInTimeViolationError,
    'engine deve rejeitar uma barra cujo knowledgeTime é posterior ao seu próprio time',
  );
  console.log('R-BT-7 (point-in-time): engine só enxerga dados com knowledgeTime <= entryBar.time — OK');
}

function rbt8HorizonOffsetCorrect(): void {
  // Sinal em t = 2026-01-05 (index 0), predictionHorizonBars = 10 -> a
  // posição deve fechar em t+10 = index 10 = 2026-01-15 (close[t+10]),
  // NUNCA em entry(t+1)+10 = index 11 = 2026-01-16 — esse era o off-by-one
  // real corrigido na revisão 3 da spec do Item A (D8).
  const result = runDeterministicBacktest({
    bars: longBars(), signals: [buySignal()], costs: NO_COSTS, periodsPerYear: 252,
    entryRule: 'open_next_bar', predictionHorizonBars: 10,
  });
  const trade = result.trades[0];
  assert.equal(trade.exitReason, 'HORIZON_END');
  assert.equal(trade.exitTime, '2026-01-15T00:00:00.000Z', 'saída deve ser exatamente t+10, não t+11');
  assert.equal(trade.exitPrice, 110, 'preço de saída por horizonte deve ser CLOSE da barra t+10, não open');

  // Regressão: predictionHorizonBars omitido preserva o comportamento atual do motor.
  const withoutHorizon = runDeterministicBacktest({
    bars: longBars(), signals: [buySignal()], costs: NO_COSTS, periodsPerYear: 252, entryRule: 'open_next_bar',
  });
  assert.equal(withoutHorizon.trades[0].exitReason, 'WINDOW_END');
  assert.equal(withoutHorizon.trades[0].exitTime, '2026-01-19T00:00:00.000Z');
  console.log('D8 (horizonte de previsão t..t+10, offset corrigido; regressão sem o campo): OK');
}

function rbt8HorizonStopTakesPriorityOnSameBar(): void {
  // Stop dispara na MESMA barra do horizonte (t+10 = index 10, low=108) ->
  // stop deve ganhar de HORIZON_END, mesmo ocorrendo no mesmo índice.
  const result = runDeterministicBacktest({
    bars: longBars(), signals: [buySignal({ stopPrice: 108.5 })], costs: NO_COSTS, periodsPerYear: 252,
    entryRule: 'open_next_bar', predictionHorizonBars: 10,
  });
  assert.equal(result.trades[0].exitReason, 'STOP');
  console.log('D8 (stop/TP têm prioridade sobre HORIZON_END mesmo na mesma barra): OK');
}

async function mlHybridIdempotencyAndEnvelopeTest(prisma: PrismaClient): Promise<void> {
  const researchRunId = await insertResearchRunForTest(prisma, 'guardiao', {
    name: 'ml hybrid backtest test',
    hypothesis: 'idempotencia e envelope versionado',
    datasetId: 'dataset:ml-hybrid-test',
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-02-01T00:00:00.000Z',
    paramsJson: '{}',
  });
  const modelVersionId = await insertModelVersionForTest(prisma, {
    kind: 'ML',
    label: 'ml-hybrid-swing-v1',
    asOf: '2026-01-01T00:00:00.000Z',
    hyperparametersJson: '{}',
    trainingEvidenceJson: '{"gate":{"approved":true}}',
  });

  const baseRequest: GovernedBacktestRunRequestV1 = {
    researchRunId,
    modelVersionId,
    instrumentId: 'WEGE3',
    entryRule: 'open_next_bar',
    costs: REAL_COSTS,
    windowStart: '2026-01-05T00:00:00.000Z',
    windowEnd: '2026-01-19T00:00:00.000Z',
    embargoDays: 0,
    bars: longBars(),
    signals: [buySignal()],
    costProfileId: 'cost-profile-test',
    costProfileVersion: 1,
    predictionHorizonBars: 10,
    artifactHash: 'a'.repeat(64),
    universeBarsDigest: 'b'.repeat(64),
    datasetDigest: 'c'.repeat(64),
    foldsCovered: [{ foldId: 0, trainEnd: '2025-12-01T00:00:00.000Z', testStart: '2026-01-01T00:00:00.000Z', embargoCalDays: 30 }],
    signalCoverage: { totalSignalsInWindow: 1, acceptedSignals: 1, skippedOverlapping: 0, skippedMissingBar: 0 },
  };

  const service = createBacktestRunService(prisma);

  const first = await service.runGoverned(baseRequest, '1d');
  assert.equal(first.status, 'CREATED');
  assert.equal(first.run.entryRule, 'open_next_bar');
  assert.deepEqual(first.run.signalCoverage, { totalSignalsInWindow: 1, acceptedSignals: 1, skippedOverlapping: 0, skippedMissingBar: 0 });
  assert.equal(first.run.provenance?.artifactHash, 'a'.repeat(64));
  assert.equal(first.run.provenance?.universeBarsDigest, 'b'.repeat(64));
  assert.equal(first.run.provenance?.datasetDigest, 'c'.repeat(64));
  assert.deepEqual(first.run.costProfileRef, { id: 'cost-profile-test', version: 1 });

  // D10: mesma chave (modelVersion/artifact/instrument/costProfile/exitRule) -> ALREADY_EXISTS, sem nova linha.
  const second = await service.runGoverned(baseRequest, '1d');
  assert.equal(second.status, 'ALREADY_EXISTS');
  assert.equal(second.run.backtestId, first.run.backtestId);

  const runsForModel = await service.listByModelVersion(modelVersionId);
  assert.equal(runsForModel.length, 1, 'idempotência não pode gerar uma segunda linha');

  // Mudar um componente da chave (costProfileVersion) -> nova linha legítima.
  const differentProfile = await service.runGoverned({ ...baseRequest, costProfileVersion: 2 }, '1d');
  assert.equal(differentProfile.status, 'CREATED');
  assert.notEqual(differentProfile.run.backtestId, first.run.backtestId);

  const runsAfter = await service.listByModelVersion(modelVersionId);
  assert.equal(runsAfter.length, 2);
  console.log('D10 (idempotência por chave + envelope versionado sobrevive ao round-trip): OK');

  // G-003 item 5 (D10): corrida real via Promise.all — N chamadas
  // concorrentes com a MESMA idempotencyKey (aqui, mesma costProfileVersion
  // nova) não podem gerar mais de uma linha nem propagar P2002 como erro
  // genérico; exatamente uma resolve CREATED, as demais ALREADY_EXISTS,
  // todas apontando para o mesmo backtestId.
  const concurrentProfileVersion = 99;
  const concurrentRequest: GovernedBacktestRunRequestV1 = { ...baseRequest, costProfileVersion: concurrentProfileVersion };
  const concurrentResults = await Promise.all(
    Array.from({ length: 8 }, () => service.runGoverned(concurrentRequest, '1d')),
  );
  const createdCount = concurrentResults.filter((r) => r.status === 'CREATED').length;
  const alreadyExistsCount = concurrentResults.filter((r) => r.status === 'ALREADY_EXISTS').length;
  assert.equal(createdCount, 1, 'corrida concorrente com a mesma idempotencyKey: exatamente 1 CREATED');
  assert.equal(alreadyExistsCount, 7, 'corrida concorrente com a mesma idempotencyKey: as demais ALREADY_EXISTS');
  const backtestIds = new Set(concurrentResults.map((r) => r.run.backtestId));
  assert.equal(backtestIds.size, 1, 'todas as respostas da corrida apontam para a mesma linha');

  const runsAfterRace = await service.listByModelVersion(modelVersionId);
  assert.equal(runsAfterRace.length, 3, 'a corrida concorrente nao pode ter criado mais de uma linha nova');
  console.log('D10 (P2002 sob corrida real via Promise.all vira ALREADY_EXISTS, nunca erro genérico): OK');
}

async function legacyBacktestRunIsReadableWithoutNewFields(prisma: PrismaClient): Promise<void> {
  // Simula um BacktestRun criado ANTES desta migration (seis campos novos
  // nunca preenchidos) — o assembler não pode quebrar, e os campos novos
  // do envelope devem ficar ausentes, não `undefined` explodindo em runtime.
  const researchRunId = await insertResearchRunForTest(prisma, 'guardiao', {
    name: 'legacy backtest test', hypothesis: 'compatibilidade', datasetId: 'dataset:legacy',
    windowStart: '2026-01-01T00:00:00.000Z', windowEnd: '2026-02-01T00:00:00.000Z', paramsJson: '{}',
  });
  const modelVersionId = await insertModelVersionForTest(prisma, {
    kind: 'RULE', label: 'legacy rule', asOf: '2026-01-01T00:00:00.000Z', hyperparametersJson: '{}',
  });
  const backtestId = await insertBacktestRunForTest(prisma, {
    researchRunId, modelVersionId, instrumentId: 'PETR4', entryRule: 'open_next_bar',
    costsJson: JSON.stringify(REAL_COSTS), windowStart: '2026-01-05T00:00:00.000Z',
    windowEnd: '2026-01-10T00:00:00.000Z',
    metricsJson: JSON.stringify({ metrics: { trades: 0 }, trades: [] }), embargoDays: 0,
    // seis campos novos DELIBERADAMENTE ausentes — nulls no banco.
  });

  const service = createBacktestRunService(prisma);
  const fetched = await service.get(backtestId);
  assert.equal(fetched.signalCoverage, undefined);
  assert.equal(fetched.provenance, undefined);
  assert.equal(fetched.costProfileRef, undefined);
  assert.deepEqual(fetched.metrics, { trades: 0 });
  console.log('D10 (migration nullable: BacktestRun legado permanece legível): OK');
}

async function unknownMetricsSchemaVersionFailsExplicitlyTest(prisma: PrismaClient): Promise<void> {
  // G-003 (robustez): metricsSchemaVersion === 2 (versão futura ainda sem
  // parser aqui) NUNCA pode ser lida silenciosamente como formato legado —
  // isso perderia signalCoverage/provenance/costProfileRef sem aviso. Só
  // `null` (BacktestRun genérico, nunca escreveu essa coluna) cai no
  // formato legado; qualquer outro valor numérico desconhecido deve falhar.
  const researchRunId = await insertResearchRunForTest(prisma, 'guardiao', {
    name: 'unknown schema version test', hypothesis: 'robustez', datasetId: 'dataset:v2-future',
    windowStart: '2026-01-01T00:00:00.000Z', windowEnd: '2026-02-01T00:00:00.000Z', paramsJson: '{}',
  });
  const modelVersionId = await insertModelVersionForTest(prisma, {
    kind: 'RULE', label: 'future schema rule', asOf: '2026-01-01T00:00:00.000Z', hyperparametersJson: '{}',
  });
  const backtestId = await insertBacktestRunForTest(prisma, {
    researchRunId, modelVersionId, instrumentId: 'PETR4', entryRule: 'open_next_bar',
    costsJson: JSON.stringify(REAL_COSTS), windowStart: '2026-01-05T00:00:00.000Z',
    windowEnd: '2026-01-10T00:00:00.000Z',
    metricsJson: JSON.stringify({ envelopeVersion: 2, metrics: {}, trades: [] }), embargoDays: 0,
    metricsSchemaVersion: 2,
  });

  const service = createBacktestRunService(prisma);
  await assert.rejects(
    () => service.get(backtestId),
    /metricsSchemaVersion desconhecido: 2/,
    'metricsSchemaVersion desconhecido deve falhar explicitamente, nunca cair no parser legado',
  );
  console.log('robustez (metricsSchemaVersion desconhecido falha explicitamente, nunca fallback legado silencioso): OK');
}

async function d5CostProfileAdminOnlyTest(prisma: PrismaClient): Promise<void> {
  const service = createBacktestCostProfileService(prisma);
  const submission = {
    version: 1, label: 'b3-equities-retail-v1', fixedBrokerage: 0, emolumentsPct: 0.0005,
    spreadBps: 5, slippageBps: 5, lotSize: 100, source: 'tarifario-corretora-xp-2026-07',
  };

  // não-admin -> FORBIDDEN (403), nunca cria a linha.
  await assert.rejects(
    () => service.create(submission, 'usuario-comum'),
    (err: unknown) => err instanceof ReadModelError && err.code === 'FORBIDDEN',
    'não-admin não pode criar BacktestCostProfile',
  );

  // admin (allowlist via WR_ADMIN_USER_IDS, setada no processo de teste) -> OK.
  const created = await service.create(submission, 'guardiao-admin');
  assert.equal(created.createdBy, 'guardiao-admin', 'createdBy vem da sessão, nunca do corpo');
  assert.equal(created.source, 'tarifario-corretora-xp-2026-07');
  assert.equal(created.archivedAt, null);

  // source "default" é rejeitado pela validação Zod, não pelo service.
  const { BacktestCostProfileSubmissionSchema } = await import('../../src/adapters/prisma/backtest-cost-profile');
  const parsed = BacktestCostProfileSubmissionSchema.safeParse({ ...submission, source: 'default' });
  assert.equal(parsed.success, false, "source: 'default' deve ser rejeitado pela validação");

  // arquivar: não-admin -> FORBIDDEN.
  await assert.rejects(
    () => service.archive(created.id, 'usuario-comum'),
    (err: unknown) => err instanceof ReadModelError && err.code === 'FORBIDDEN',
  );
  const archived = await service.archive(created.id, 'guardiao-admin');
  assert.ok(archived.archivedAt && archived.archivedBy === 'guardiao-admin');

  // treino não pode usar um profile arquivado silenciosamente.
  await assert.rejects(
    () => service.resolveActiveForTraining(created.id),
    (err: unknown) => err instanceof ReadModelError && err.code === 'INVALID_COST_PROFILE',
  );
  await assert.rejects(
    () => service.resolveActiveForTraining('nao-existe'),
    (err: unknown) => err instanceof ReadModelError && err.code === 'COST_PROFILE_NOT_FOUND',
  );
  console.log('D5 (BacktestCostProfile Admin-only, source obrigatório, sem default silencioso): OK');
}

async function persistenceOrchestrationTest(prisma: PrismaClient): Promise<void> {
  const researchRunId = await insertResearchRunForTest(prisma, 'guardiao', {
    name: 'backtest orchestration test',
    hypothesis: 'sanity check da orquestração ponta a ponta',
    datasetId: 'dataset:test',
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-02-01T00:00:00.000Z',
    paramsJson: '{}',
  });
  const modelVersionId = await insertModelVersionForTest(prisma, {
    kind: 'RULE',
    label: 'ma crossover',
    asOf: '2026-01-01T00:00:00.000Z',
    hyperparametersJson: '{}',
  });

  const service = createBacktestRunService(prisma);
  const result = await service.run(
    {
      researchRunId,
      modelVersionId,
      instrumentId: 'B3:PETR4',
      entryRule: 'open_next_bar',
      costs: REAL_COSTS,
      windowStart: '2026-01-05T00:00:00.000Z',
      windowEnd: '2026-01-10T00:00:00.000Z',
      embargoDays: 0,
      bars: bars(),
      signals: [buySignal()],
    },
    '1d',
  );

  assert.ok(result.backtestId);
  assert.equal((result.metrics as { trades: number }).trades, 1);

  const fetched = await service.get(result.backtestId);
  assert.equal(fetched.backtestId, result.backtestId);
  const byModelVersion = await service.listByModelVersion(modelVersionId);
  assert.equal(byModelVersion.length, 1);
  console.log('Persistência ponta a ponta (ResearchRun + ModelVersion + BacktestRun via service): OK');
}

async function main(): Promise<void> {
  rbt1NoLookahead();
  rbt2IntrabarStopTp();
  rbt3RealCosts();
  rbt4SharpePeriodsPerYear();
  rbt5EmbargoPurge();
  rbt6Determinism();
  rbt7PointInTime();
  rbt8HorizonOffsetCorrect();
  rbt8HorizonStopTakesPriorityOnSameBar();

  const prisma = new PrismaClient();
  try {
    await persistenceOrchestrationTest(prisma);
    await mlHybridIdempotencyAndEnvelopeTest(prisma);
    await legacyBacktestRunIsReadableWithoutNewFields(prisma);
    await unknownMetricsSchemaVersionFailsExplicitlyTest(prisma);
    await d5CostProfileAdminOnlyTest(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log('Fase 5 / BacktestRun (R-BT-1..7): TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
