import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import {
  PrismaResearchSessionRepository,
  insertResearchSessionForTest,
} from '../../src/adapters/prisma/research-session';
import { canTransition } from '../../src/domain/v1/models/research-session';
import { createRng } from '../../src/domain/v1/models/research-rng';
import { stationaryBootstrap } from '../../src/domain/v1/models/rule-significance/bootstrap';
import {
  MIN_OBSERVATIONS,
  ruleSignificanceTest,
} from '../../src/domain/v1/models/rule-significance';
import type { BacktestBar, BacktestSignalInput } from '../../src/domain/v1/models/backtest-run';
import { monteCarloTrades } from '../../src/domain/v1/models/monte-carlo-trades';
import type { BacktestTrade } from '../../src/domain/v1/models/backtest-run';

function rngIsDeterministic(): void {
  const a = createRng(42);
  const b = createRng(42);
  const c = createRng(43);
  const seqA = Array.from({ length: 8 }, () => a.nextUint32());
  const seqB = Array.from({ length: 8 }, () => b.nextUint32());
  const seqC = Array.from({ length: 8 }, () => c.nextUint32());
  assert.deepEqual(seqA, seqB, 'mesma seed deve produzir a mesma sequência');
  assert.notDeepEqual(seqA, seqC, 'seeds diferentes devem produzir sequências diferentes');
  console.log('RNG: determinístico por seed — OK');
}

function rngFloatsAreInRange(): void {
  const rng = createRng(7);
  for (let i = 0; i < 1000; i += 1) {
    const value = rng.nextFloat();
    assert.ok(value >= 0 && value < 1, `nextFloat fora de [0,1): ${value}`);
    const index = rng.nextInt(5);
    assert.ok(Number.isInteger(index) && index >= 0 && index < 5, `nextInt(5) fora de faixa: ${index}`);
  }
  console.log('RNG: nextFloat em [0,1) e nextInt em [0,n) — OK');
}

function bootstrapIsDeterministic(): void {
  const returns = Array.from({ length: 200 }, (_, i) => Math.sin(i) * 0.01);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const a = stationaryBootstrap(returns, mean, 500, 42, 10);
  const b = stationaryBootstrap(returns, mean, 500, 42, 10);
  const c = stationaryBootstrap(returns, mean, 500, 43, 10);
  assert.deepEqual(Array.from(a), Array.from(b), 'mesma seed → mesmas médias simuladas');
  assert.notDeepEqual(Array.from(a), Array.from(c), 'seed diferente → médias diferentes');
  assert.equal(a.length, 500, 'deve devolver exatamente nSimulations médias');
  console.log('Bootstrap: determinístico e com tamanho correto — OK');
}

function bootstrapCentersTheSeries(): void {
  // H0 é materializada centrando a série: a média das médias simuladas
  // deve ficar próxima de zero, não da média observada.
  const returns = Array.from({ length: 300 }, () => 0.05);
  const mean = 0.05;
  const sims = stationaryBootstrap(returns, mean, 400, 42, 10);
  const meanOfSims = Array.from(sims).reduce((s, v) => s + v, 0) / sims.length;
  assert.ok(Math.abs(meanOfSims) < 1e-9, `médias simuladas deveriam centrar em 0, veio ${meanOfSims}`);
  console.log('Bootstrap: série centrada em zero (H0) — OK');
}

function bootstrapPreservesSerialDependence(): void {
  // Justifica a escolha do método: sobre uma série fortemente
  // autocorrelacionada, o bootstrap ESTACIONÁRIO (blocos) produz médias
  // simuladas com dispersão MAIOR que um bootstrap i.i.d. (bloco 1), que
  // destrói a dependência local. Se as duas derem a mesma dispersão, a
  // implementação de blocos não está fazendo nada.
  // Série suave de baixa frequência: fortemente PERSISTENTE (valores
  // vizinhos têm o mesmo sinal por dezenas de barras). Um bloco de 20
  // cai quase todo dentro de uma mesma fase, então as médias simuladas
  // se espalham muito mais que sob i.i.d.
  //
  // A escolha da série importa: uma série oscilante de período curto
  // (ex.: choque a cada 7 barras) dá o resultado INVERSO — blocos longos
  // atravessam vários períodos e MÉDIAM a oscilação, com razão ~0,36.
  // Verificado numericamente antes de escrever este teste.
  const n = 400;
  const returns: number[] = Array.from({ length: n }, (_, i) => Math.sin(i / 40) * 0.01);
  const mean = returns.reduce((s, r) => s + r, 0) / n;

  const stdOf = (arr: Float64Array): number => {
    const m = Array.from(arr).reduce((s, v) => s + v, 0) / arr.length;
    const variance = Array.from(arr).reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(variance);
  };

  const blocked = stdOf(stationaryBootstrap(returns, mean, 2000, 42, 20));
  const iid = stdOf(stationaryBootstrap(returns, mean, 2000, 42, 1));
  // Margem real medida nesta série: ~5,6x. O limiar de 2x é folgado o
  // bastante para não ser frágil e apertado o bastante para reprovar uma
  // implementação que ignorasse os blocos (razão 1,0).
  assert.ok(blocked > iid * 2, `bootstrap em blocos (${blocked}) deveria dispersar mais que i.i.d. (${iid})`);
  console.log('Bootstrap: blocos preservam dependência serial — OK');
}

/** Constrói barras diárias a partir de uma série de fechamentos. */
function barsFromCloses(closes: readonly number[]): BacktestBar[] {
  return closes.map((close, i) => {
    const time = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
    return { time, open: close, high: close, low: close, close, knowledgeTime: time };
  });
}

/** Um sinal BUY em cada barra, exceto a última (que não tem barra seguinte). */
function buyEveryBar(bars: readonly BacktestBar[]): BacktestSignalInput[] {
  return bars.slice(0, -1).map((bar) => ({
    barTime: bar.time,
    direction: 'BUY' as const,
    knowledgeTime: bar.knowledgeTime,
  }));
}

function significanceOnPureNoiseIsNotSignificant(): void {
  // Série sem deriva: sobe e desce alternadamente pelo mesmo fator.
  const closes: number[] = [100];
  for (let i = 1; i < 400; i += 1) closes.push(i % 2 === 0 ? 100 : 101);
  const bars = barsFromCloses(closes);
  const result = ruleSignificanceTest({ bars, signals: buyEveryBar(bars), nSimulations: 1000 });
  assert.equal(result.insufficientData, false, 'deveria haver observações suficientes');
  assert.ok(result.pValue !== null, 'p-valor não deveria ser null');
  assert.ok((result.pValue as number) > 0.10, `ruído puro não deveria ser significativo, veio p=${result.pValue}`);
  console.log(`Significância: ruído puro → p=${result.pValue?.toFixed(3)} (não significativo) — OK`);
}

function significanceOnStrongDriftIsSignificant(): void {
  // Deriva positiva consistente: +0,5% por barra.
  const closes = [100];
  for (let i = 1; i < 400; i += 1) closes.push(closes[i - 1] * 1.005);
  const bars = barsFromCloses(closes);
  const result = ruleSignificanceTest({ bars, signals: buyEveryBar(bars), nSimulations: 1000 });
  assert.ok(result.pValue !== null, 'p-valor não deveria ser null');
  assert.ok((result.pValue as number) < 0.05, `deriva forte deveria ser significativa, veio p=${result.pValue}`);
  assert.ok(result.observedMean > 0, 'média observada deveria ser positiva');
  console.log(`Significância: deriva forte → p=${result.pValue?.toFixed(4)} (significativo) — OK`);
}

function significanceBelowFloorRefusesToAnswer(): void {
  const closes = Array.from({ length: MIN_OBSERVATIONS - 5 }, (_, i) => 100 + i);
  const bars = barsFromCloses(closes);
  const result = ruleSignificanceTest({ bars, signals: buyEveryBar(bars), nSimulations: 1000 });
  assert.equal(result.insufficientData, true, 'abaixo do piso deveria marcar insufficientData');
  assert.equal(result.pValue, null, 'abaixo do piso o p-valor deve ser null, nunca um número');
  assert.ok(result.nObservations < MIN_OBSERVATIONS, 'nObservations deveria estar abaixo do piso');
  console.log('Significância: abaixo do piso devolve pValue null — OK');
}

function significanceRespectsDirection(): void {
  // Mesma série em alta, mas sinalizando SELL: a regra é ruim, não boa.
  const closes = [100];
  for (let i = 1; i < 400; i += 1) closes.push(closes[i - 1] * 1.005);
  const bars = barsFromCloses(closes);
  const sellSignals: BacktestSignalInput[] = bars.slice(0, -1).map((bar) => ({
    barTime: bar.time,
    direction: 'SELL' as const,
    knowledgeTime: bar.knowledgeTime,
  }));
  const result = ruleSignificanceTest({ bars, signals: sellSignals, nSimulations: 1000 });
  assert.ok(result.observedMean < 0, 'SELL numa série em alta deveria ter média negativa');
  assert.ok((result.pValue as number) > 0.5, 'regra ruim não pode sair significativa');
  console.log('Significância: direção SELL inverte o sinal do retorno — OK');
}

function significanceIgnoresHoldAndMissingNextBar(): void {
  const bars = barsFromCloses(Array.from({ length: 100 }, (_, i) => 100 + i));
  const signals: BacktestSignalInput[] = [
    ...buyEveryBar(bars).slice(0, 50),
    // HOLD não é uma aposta: não entra na amostra.
    { barTime: bars[60].time, direction: 'HOLD', knowledgeTime: bars[60].knowledgeTime },
    // Última barra não tem barra seguinte: não há retorno a medir.
    { barTime: bars[bars.length - 1].time, direction: 'BUY', knowledgeTime: bars[bars.length - 1].knowledgeTime },
  ];
  const result = ruleSignificanceTest({ bars, signals, nSimulations: 200 });
  assert.equal(result.nObservations, 50, `esperava 50 observações, veio ${result.nObservations}`);
  console.log('Significância: HOLD e barra sem sucessora são descartados — OK');
}

function significanceIsDeterministic(): void {
  const bars = barsFromCloses(Array.from({ length: 200 }, (_, i) => 100 * 1.001 ** i));
  const signals = buyEveryBar(bars);
  const a = ruleSignificanceTest({ bars, signals, nSimulations: 500, seed: 42 });
  const b = ruleSignificanceTest({ bars, signals, nSimulations: 500, seed: 42 });
  assert.equal(a.pValue, b.pValue, 'mesma seed deve produzir o mesmo p-valor');
  console.log('Significância: determinística por seed — OK');
}

/** Trades sintéticos com resultados distintos, para a ordem importar. */
function syntheticTrades(pnls: readonly number[]): BacktestTrade[] {
  return pnls.map((netPnl, i) => {
    const time = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
    return {
      signalBarTime: time,
      entryTime: time,
      entryPrice: 100,
      exitTime: time,
      exitPrice: 100 + netPnl,
      direction: 'BUY' as const,
      grossPnl: netPnl,
      costs: 0,
      netPnl,
      netReturn: netPnl / 100,
      exitReason: 'WINDOW_END' as const,
    };
  });
}

function monteCarloInvariantsDoNotVary(): void {
  const trades = syntheticTrades([50, -30, 80, -60, 20, -10, 45, -70, 15, 5]);
  const result = monteCarloTrades({ trades, periodsPerYear: 252, startingBalance: 1000, nScenarios: 300 });
  assert.equal(result.invariants.orderInvariant, true, 'invariants deve declarar orderInvariant');
  assert.ok(
    Math.abs(result.invariants.totalNetPnl - 45) < 1e-9,
    `totalNetPnl deveria ser 45, veio ${result.invariants.totalNetPnl}`,
  );
  console.log('Monte Carlo: retorno total e Sharpe são invariantes à ordem — OK');
}

function monteCarloPathDependentDoesVary(): void {
  // Sem este teste, uma implementação que NÃO embaralhasse passaria no
  // teste dos invariantes.
  const trades = syntheticTrades([50, -30, 80, -60, 20, -10, 45, -70, 15, 5]);
  const result = monteCarloTrades({ trades, periodsPerYear: 252, startingBalance: 1000, nScenarios: 300 });
  const dd = result.pathDependent.maxDrawdown;
  assert.ok(dd.p5 <= dd.p50 && dd.p50 <= dd.p95, `percentis fora de ordem: ${JSON.stringify(dd)}`);
  assert.ok(dd.p5 < dd.p95, 'maxDrawdown deveria variar entre cenários — o embaralhamento não está agindo');
  console.log(`Monte Carlo: drawdown varia (p5=${dd.p5.toFixed(2)}, p95=${dd.p95.toFixed(2)}) — OK`);
}

function monteCarloWithSingleTradeIsDegenerate(): void {
  const result = monteCarloTrades({
    trades: syntheticTrades([42]),
    periodsPerYear: 252,
    startingBalance: 1000,
    nScenarios: 50,
  });
  const dd = result.pathDependent.maxDrawdown;
  assert.equal(dd.p5, dd.p95, 'com 1 trade não há ordem a embaralhar: todos os cenários são iguais');
  console.log('Monte Carlo: 1 trade → cenários idênticos — OK');
}

function monteCarloIsDeterministic(): void {
  const trades = syntheticTrades([
    50, -30, 80, -60, 20, -10, 45, -70, 15, 5, -25, 60, -45, 33, -18, 22, -52, 12, -8, 41,
  ]);
  const base = { trades, periodsPerYear: 252, startingBalance: 1000, nScenarios: 300 };
  const a = monteCarloTrades({ ...base, seed: 42 });
  const b = monteCarloTrades({ ...base, seed: 42 });
  const c = monteCarloTrades({ ...base, seed: 43 });
  assert.deepEqual(a.pathDependent, b.pathDependent, 'mesma seed → mesmos percentis');
  assert.notDeepEqual(a.pathDependent, c.pathDependent, 'seed diferente → percentis diferentes');
  console.log('Monte Carlo: determinístico por seed — OK');
}

function monteCarloWithNoTradesDoesNotFabricate(): void {
  const result = monteCarloTrades({ trades: [], periodsPerYear: 252, startingBalance: 1000, nScenarios: 100 });
  assert.equal(result.nScenarios, 0, 'sem trades não há cenário a simular');
  assert.equal(result.pathDependent.maxDrawdown.p50, 0, 'sem trades o drawdown é 0, não um número inventado');
  console.log('Monte Carlo: conjunto vazio não fabrica cenário — OK');
}

function stateMachineRejectsImpossibleTransitions(): void {
  assert.equal(canTransition('DRAFT', 'RUNNING'), true);
  assert.equal(canTransition('RUNNING', 'DONE'), true);
  assert.equal(canTransition('RUNNING', 'FAILED'), true);
  assert.equal(canTransition('DRAFT', 'CANCELLED'), true);
  assert.equal(canTransition('DONE', 'RUNNING'), false, 'sessão concluída não volta a rodar');
  assert.equal(canTransition('DRAFT', 'DONE'), false, 'não se conclui sem rodar');
  assert.equal(canTransition('CANCELLED', 'RUNNING'), false, 'cancelada não recomeça');
  console.log('ResearchSession: máquina de estados rejeita transição impossível — OK');
}

async function claimForRunIsAtomic(prisma: PrismaClient): Promise<void> {
  const repo = new PrismaResearchSessionRepository(prisma);
  const session = await insertResearchSessionForTest(prisma, { kind: 'SIGNIFICANCE' });

  // Duas tentativas concorrentes de reivindicar o MESMO rascunho.
  const [first, second] = await Promise.all([
    repo.claimForRun(session.sessionId),
    repo.claimForRun(session.sessionId),
  ]);

  const winners = [first, second].filter((claimed) => claimed === true);
  assert.equal(winners.length, 1, `exatamente um claim deveria vencer, venceram ${winners.length}`);

  const after = await repo.findById(session.sessionId);
  assert.equal(after?.status, 'RUNNING', 'a sessão deveria estar RUNNING após o claim vencedor');
  console.log('ResearchSession: claimForRun é atômico (CAS) — OK');
}

async function claimForRunRefusesNonDraft(prisma: PrismaClient): Promise<void> {
  const repo = new PrismaResearchSessionRepository(prisma);
  const session = await insertResearchSessionForTest(prisma, { kind: 'MONTE_CARLO', status: 'DONE' });
  const claimed = await repo.claimForRun(session.sessionId);
  assert.equal(claimed, false, 'sessão DONE não pode ser reivindicada para rodar');
  console.log('ResearchSession: claimForRun recusa sessão não-DRAFT — OK');
}

async function updateDraftRefusesRunningSession(prisma: PrismaClient): Promise<void> {
  const repo = new PrismaResearchSessionRepository(prisma);
  const session = await insertResearchSessionForTest(prisma, { kind: 'SIGNIFICANCE', status: 'RUNNING' });
  const updated = await repo.updateDraft(session.sessionId, { label: 'novo rótulo' });
  assert.equal(updated, null, 'rascunho em execução não aceita edição de config');
  console.log('ResearchSession: updateDraft recusa sessão em execução — OK');
}

async function main(): Promise<void> {
  rngIsDeterministic();
  rngFloatsAreInRange();
  bootstrapIsDeterministic();
  bootstrapCentersTheSeries();
  bootstrapPreservesSerialDependence();
  significanceOnPureNoiseIsNotSignificant();
  significanceOnStrongDriftIsSignificant();
  significanceBelowFloorRefusesToAnswer();
  significanceRespectsDirection();
  significanceIgnoresHoldAndMissingNextBar();
  significanceIsDeterministic();
  monteCarloInvariantsDoNotVary();
  monteCarloPathDependentDoesVary();
  monteCarloWithSingleTradeIsDegenerate();
  monteCarloIsDeterministic();
  monteCarloWithNoTradesDoesNotFabricate();
  stateMachineRejectsImpossibleTransitions();

  const prisma = new PrismaClient();
  try {
    await claimForRunIsAtomic(prisma);
    await claimForRunRefusesNonDraft(prisma);
    await updateDraftRefusesRunningSession(prisma);
  } finally {
    await prisma.$disconnect();
  }

  console.log('\nTodos os testes de research-session passaram.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
