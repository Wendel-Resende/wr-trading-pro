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

  const prisma = new PrismaClient();
  try {
    await persistenceOrchestrationTest(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log('Fase 5 / BacktestRun (R-BT-1..7): TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
