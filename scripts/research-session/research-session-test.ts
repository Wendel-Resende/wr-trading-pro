import assert from 'node:assert/strict';
import { createRng } from '../../src/domain/v1/models/research-rng';
import { stationaryBootstrap } from '../../src/domain/v1/models/rule-significance/bootstrap';

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

async function main(): Promise<void> {
  rngIsDeterministic();
  rngFloatsAreInRange();
  bootstrapIsDeterministic();
  bootstrapCentersTheSeries();
  bootstrapPreservesSerialDependence();
  console.log('\nTodos os testes de research-session passaram.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
