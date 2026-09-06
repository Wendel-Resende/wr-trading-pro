# Ferramentas de pesquisa do Jesse — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à WR um teste de significância estatística para regras de entrada e um Monte Carlo de ordem de trades, expostos ao agente Hermes pelo padrão draft→run→session.

**Architecture:** Dois módulos de domínio PUROS (zero I/O) sobre os contratos que `runDeterministicBacktest` já produz, persistidos num modelo Prisma genérico `ResearchSession`, orquestrados por um serviço de aplicação com transição de estado por update condicional (CAS), expostos por rotas `/api/v1/research-sessions` e 12 tools MCP `privilege: 'free'`.

**Tech Stack:** TypeScript strict, Zod na fronteira, Prisma/SQLite, Next.js 15 (App Router), MCP SDK, `node:assert/strict` + runner `.cjs` compilado por `tsc`.

**Spec:** `docs/superpowers/specs/2026-09-06-ferramentas-pesquisa-jesse-design.md`

## Global Constraints

- **Nenhuma dependência npm nova.** Todo o cálculo é aritmética de `number` e `Float64Array`. Se um passo parecer pedir uma biblioteca de estatística, o passo está errado.
- **Determinismo obrigatório.** Nenhum uso de `Math.random()`, `Date.now()` ou `new Date()` sem argumento dentro de `src/domain/**`. Toda aleatoriedade vem do PRNG semeado da Task 1.
- **Módulos de domínio são puros:** sem `import` de Prisma, `fetch`, `node:fs` ou qualquer I/O. Quem lê banco é a camada de aplicação.
- **Zod `.strict()`** em todo schema de fronteira — campo extra é rejeitado, nunca ignorado. É o padrão já usado em `src/adapters/prisma/signal/schemas.ts`.
- **Next.js 15:** `params` é `Promise<{ id: string }>` — sempre `await params`.
- **Migration aditiva:** nenhum modelo existente do `prisma/schema.prisma` é alterado. Só uma tabela nova.
- **Nenhuma tool `gated`:** as 12 tools novas são `privilege: 'free'`. Nada aqui envia ordem.
- **`createdBy` nunca vem de argumento de tool** — é fixado no servidor como `'mcp:hermes'`.
- **Nenhuma UI.** Nenhum arquivo em `src/components/**` ou `src/app/(tabs)/**` é criado ou modificado.
- **Constantes fiéis ao Jesse:** `MIN_OBSERVATIONS = 30`, `DEFAULT_MEAN_BLOCK_LENGTH = 10`, `DEFAULT_SEED = 42`, percentis de confiança 5/50/95 com ICs de 90% e 95%.
- **Comentários e mensagens de erro em português**, seguindo o código existente do domínio v1.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/domain/v1/models/research-rng/index.ts` | PRNG determinístico semeado (xoshiro128\*\*). Só isso. |
| `src/domain/v1/models/rule-significance/index.ts` | Retornos da barra seguinte, bootstrap estacionário, p-valor. |
| `src/domain/v1/models/monte-carlo-trades/index.ts` | Embaralhamento de trades, curva de capital, percentis. |
| `src/domain/v1/models/backtest-run/metrics.ts` | Métricas extraídas de `backtest-run/index.ts` para reuso. |
| `src/domain/v1/models/research-session/index.ts` | Tipos e máquina de estados da sessão (puro). |
| `src/domain/v1/ports/research-session-repository.ts` | Porta do repositório. |
| `src/adapters/prisma/research-session/*` | Schemas Zod, mapping, repository, errors, test-support. |
| `src/application/research-session/{dto,config-schemas,service,index}.ts` | Orquestração: valida config por `kind`, CAS, chama o núcleo puro. |
| `src/app/api/v1/research-sessions/**` | Rotas HTTP. |
| `src/mcp/pilot/tools/research.ts` | As 12 tools, tradução Zod fina. |
| `scripts/research-session/*` | Runner de teste + tsconfig + o teste. |

---

### Task 1: PRNG determinístico e bootstrap estacionário

**Files:**
- Create: `src/domain/v1/models/research-rng/index.ts`
- Create: `src/domain/v1/models/rule-significance/bootstrap.ts`
- Create: `scripts/research-session/research-session-test.ts`
- Create: `scripts/research-session/tsconfig.json`
- Create: `scripts/research-session/run-research-session-tests.cjs`
- Modify: `package.json` (adicionar script `test:research-session`)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `createRng(seed: number): Rng` onde `Rng = { nextUint32(): number; nextFloat(): number; nextInt(maxExclusive: number): number }`
  - `stationaryBootstrap(returns: readonly number[], observedMean: number, nSimulations: number, seed: number, meanBlockLength: number): Float64Array`
  - `DEFAULT_MEAN_BLOCK_LENGTH: 10`, `DEFAULT_SEED: 42`

- [ ] **Step 1: Criar o tsconfig do runner**

`scripts/research-session/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "rootDir": "../..",
    "outDir": ".dist",
    "lib": ["ES2022", "DOM"]
  },
  "include": [
    "research-session-test.ts",
    "../../src/adapters/prisma/**/*.ts",
    "../../src/domain/v1/**/*.ts",
    "../../src/application/**/*.ts"
  ]
}
```

- [ ] **Step 2: Criar o runner**

`scripts/research-session/run-research-session-tests.cjs` — cópia exata do padrão de `scripts/signal/run-signal-tests.cjs`, trocando os nomes:

```js
const { rmSync, mkdtempSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const os = require('node:os');

const root = join(__dirname, '..', '..');
const dist = join(__dirname, '.dist');

const run = (command, args, env) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false, env: env ?? process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? 'unknown status'}`);
};

let tempDir = null;
try {
  rmSync(dist, { recursive: true, force: true });
  run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'scripts/research-session/tsconfig.json']);

  tempDir = mkdtempSync(join(os.tmpdir(), 'wr-research-session-test-'));
  const databaseUrl = `file:${join(tempDir, 'test.db').replace(/\\/g, '/')}`;
  const testEnv = { ...process.env, DATABASE_URL: databaseUrl };

  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], testEnv);
  run(process.execPath, ['scripts/research-session/.dist/scripts/research-session/research-session-test.js'], testEnv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(dist, { recursive: true, force: true });
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
}
```

- [ ] **Step 3: Adicionar o script ao `package.json`**

Na seção `"scripts"`, depois de `"test:signal"`, inserir:

```json
"test:research-session": "node scripts/research-session/run-research-session-tests.cjs",
```

- [ ] **Step 4: Escrever os testes que falham**

`scripts/research-session/research-session-test.ts`:

```ts
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
```

- [ ] **Step 5: Rodar e confirmar que falha**

Run: `npm run test:research-session`
Expected: FALHA na compilação do `tsc` — `Cannot find module '../../src/domain/v1/models/research-rng'`.

- [ ] **Step 6: Implementar o PRNG**

`src/domain/v1/models/research-rng/index.ts`:

```ts
/**
 * PRNG determinístico semeado para os módulos de pesquisa estatística.
 *
 * Por que não `Math.random()`: um teste estatístico cujo resultado muda a
 * cada execução não trava regressão nenhuma, e um p-valor que não pode ser
 * reproduzido não é evidência de nada. O Jesse usa `np.random.default_rng`
 * com seed explícita pelo mesmo motivo; JS não tem equivalente na
 * biblioteca padrão, então trazemos um.
 *
 * Algoritmo: xoshiro128** (Blackman/Vigna), 32 bits, semeado por
 * splitmix32. Escolhido por ser curto, sem dependência, e ter período
 * suficiente (2^128-1) para as dezenas de milhões de sorteios que uma
 * corrida de 2000 simulações sobre alguns milhares de barras consome.
 */

export interface Rng {
  /** Próximo inteiro sem sinal de 32 bits. */
  nextUint32(): number;
  /** Próximo float em [0, 1). */
  nextFloat(): number;
  /** Próximo inteiro em [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
}

/** Seed default — mesmo valor do Jesse, para tornar comparações diretas possíveis. */
export const DEFAULT_SEED = 42;

function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function createRng(seed: number): Rng {
  if (!Number.isFinite(seed)) throw new Error('seed do RNG deve ser um número finito');

  const seeder = splitmix32(Math.trunc(seed));
  let s0 = seeder();
  let s1 = seeder();
  let s2 = seeder();
  let s3 = seeder();
  // xoshiro exige que o estado não seja todo zero.
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;

  const nextUint32 = (): number => {
    const result = (Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0);
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result;
  };

  const nextFloat = (): number => nextUint32() / 4_294_967_296;

  const nextInt = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error('maxExclusive deve ser inteiro positivo');
    }
    return Math.floor(nextFloat() * maxExclusive);
  };

  return { nextUint32, nextFloat, nextInt };
}
```

- [ ] **Step 7: Implementar o bootstrap estacionário**

`src/domain/v1/models/rule-significance/bootstrap.ts`:

```ts
/**
 * Bootstrap estacionário (Politis & Romano) — porte de
 * `jesse/research/rule_significance_testing/bootstrap.py`.
 *
 * A série é centrada em zero ANTES de reamostrar: é isso que materializa a
 * hipótese nula "o retorno esperado da regra não é positivo". Reamostrar a
 * série crua testaria outra coisa.
 *
 * Os blocos têm comprimento geométrico (a cada posição, probabilidade
 * `1/meanBlockLength` de iniciar um bloco novo em um índice sorteado
 * uniformemente; entre reinícios o índice avança, com wrap circular). Isso
 * preserva a dependência serial local — um bootstrap i.i.d. a destruiria e
 * subestimaria a variância do nulo, produzindo p-valores otimistas demais.
 */
import { createRng } from '../research-rng';

/** Comprimento médio de bloco, em barras. Mesmo default do Jesse. */
export const DEFAULT_MEAN_BLOCK_LENGTH = 10;

export function stationaryBootstrap(
  returns: readonly number[],
  observedMean: number,
  nSimulations: number,
  seed: number,
  meanBlockLength: number,
): Float64Array {
  if (meanBlockLength < 1) throw new Error('meanBlockLength deve ser no mínimo 1');
  if (nSimulations < 0) throw new Error('nSimulations não pode ser negativo');

  const n = returns.length;
  if (n === 0) return new Float64Array(0);

  const centered = new Float64Array(n);
  for (let i = 0; i < n; i += 1) centered[i] = returns[i] - observedMean;

  const rng = createRng(seed);
  const restartProbability = 1 / meanBlockLength;
  const simulated = new Float64Array(nSimulations);

  for (let sim = 0; sim < nSimulations; sim += 1) {
    let sum = 0;
    // A primeira posição é sempre um reinício de bloco.
    let sourceIndex = rng.nextInt(n);
    for (let position = 0; position < n; position += 1) {
      if (position > 0) {
        if (rng.nextFloat() < restartProbability) {
          sourceIndex = rng.nextInt(n);
        } else {
          sourceIndex = (sourceIndex + 1) % n;
        }
      }
      sum += centered[sourceIndex];
    }
    simulated[sim] = sum / n;
  }

  return simulated;
}
```

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `npm run test:research-session`
Expected: PASSA, com as 5 linhas `— OK` impressas.

- [ ] **Step 9: Commit**

```bash
git add src/domain/v1/models/research-rng src/domain/v1/models/rule-significance scripts/research-session package.json
git commit -m "feat(pesquisa): PRNG semeado e bootstrap estacionário"
```

---

### Task 2: Teste de significância de regra

**Files:**
- Create: `src/domain/v1/models/rule-significance/index.ts`
- Modify: `scripts/research-session/research-session-test.ts` (acrescentar casos)

**Interfaces:**
- Consumes: `stationaryBootstrap`, `DEFAULT_MEAN_BLOCK_LENGTH` da Task 1; `BacktestBar` e `BacktestSignalInput` de `src/domain/v1/models/backtest-run`.
- Produces:
  - `MIN_OBSERVATIONS: 30`
  - `nextBarLogReturns(bars, signals): { returns: number[]; firstTimeMs: number; lastTimeMs: number }`
  - `ruleSignificanceTest(input: RuleSignificanceInput): RuleSignificanceResult`
  - `RuleSignificanceInput = { bars, signals, nSimulations?, seed?, meanBlockLength? }`
  - `RuleSignificanceResult = { observedMean, annualizedReturn, pValue, nObservations, nSimulations, meanBlockLength, insufficientData }`

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar em `scripts/research-session/research-session-test.ts`, antes de `main()`:

```ts
import {
  MIN_OBSERVATIONS,
  ruleSignificanceTest,
} from '../../src/domain/v1/models/rule-significance';
import type { BacktestBar, BacktestSignalInput } from '../../src/domain/v1/models/backtest-run';

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
```

E registrar as chamadas em `main()`, depois de `bootstrapPreservesSerialDependence()`:

```ts
  significanceOnPureNoiseIsNotSignificant();
  significanceOnStrongDriftIsSignificant();
  significanceBelowFloorRefusesToAnswer();
  significanceRespectsDirection();
  significanceIgnoresHoldAndMissingNextBar();
  significanceIsDeterministic();
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test:research-session`
Expected: FALHA na compilação — `Cannot find module '../../src/domain/v1/models/rule-significance'` (o diretório existe mas não tem `index.ts`).

- [ ] **Step 3: Implementar**

`src/domain/v1/models/rule-significance/index.ts`:

```ts
/**
 * Teste de significância de regra — porte de
 * `jesse/research/rule_significance_testing/`.
 *
 * H0: o retorno esperado da barra seguinte ao sinal NÃO é positivo.
 *
 * O Jesse precisa rodar um backtest só-de-sinal para coletar as entradas
 * porque lá o sinal só existe dentro do ciclo de vida da estratégia. Na WR
 * os sinais já são dado de primeira classe (`BacktestSignalInput`), então
 * a Fase 1 do Jesse não é portada: começamos direto na Fase 2.
 *
 * O que o teste responde: se o retorno médio da barra seguinte a este
 * conjunto de sinais poderia plausivelmente vir do acaso. Um p-valor alto
 * NÃO prova que a regra é inútil — prova que esta amostra não sustenta a
 * afirmação de que ela funciona.
 */
import type { BacktestBar, BacktestSignalInput } from '../backtest-run';
import { DEFAULT_SEED } from '../research-rng';
import { DEFAULT_MEAN_BLOCK_LENGTH, stationaryBootstrap } from './bootstrap';

export { DEFAULT_MEAN_BLOCK_LENGTH, stationaryBootstrap } from './bootstrap';

/**
 * Piso de observações — mesmo valor do Jesse (`MIN_OBSERVATIONS = 30`).
 * Abaixo disso não devolvemos p-valor: um número calculado sobre uma dúzia
 * de sinais tem a aparência de evidência sem a substância. Mesma regra do
 * "pilar sem dado não aprova e não reprova" da Saúde Financeira.
 */
export const MIN_OBSERVATIONS = 30;

export const DEFAULT_N_SIMULATIONS = 2000;

export interface RuleSignificanceInput {
  readonly bars: readonly BacktestBar[];
  readonly signals: readonly BacktestSignalInput[];
  readonly nSimulations?: number;
  readonly seed?: number;
  readonly meanBlockLength?: number;
}

export interface RuleSignificanceResult {
  /** Média do log-retorno da barra seguinte, com o sinal da direção aplicado. */
  readonly observedMean: number;
  /** `observedMean` anualizado pelo tempo de calendário efetivamente decorrido. */
  readonly annualizedReturn: number;
  /** `null` quando `insufficientData` — nunca um número calculado sobre amostra pequena demais. */
  readonly pValue: number | null;
  readonly nObservations: number;
  readonly nSimulations: number;
  /** O valor usado, não o default — um p-valor não significa nada sem ele. */
  readonly meanBlockLength: number;
  readonly insufficientData: boolean;
}

export interface NextBarReturns {
  readonly returns: number[];
  readonly firstTimeMs: number;
  readonly lastTimeMs: number;
}

/**
 * Log-retorno da barra seguinte a cada sinal, com o sinal da direção
 * aplicado (SELL inverte). Descarta o que não é mensurável em vez de
 * fabricar zero:
 *  - `HOLD` não é aposta;
 *  - sinal cuja barra não existe no conjunto;
 *  - sinal na última barra (não há sucessora);
 *  - preços não positivos (log indefinido).
 */
export function nextBarLogReturns(
  bars: readonly BacktestBar[],
  signals: readonly BacktestSignalInput[],
): NextBarReturns {
  const sorted = [...bars].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const indexByTime = new Map<string, number>();
  sorted.forEach((bar, i) => indexByTime.set(bar.time, i));

  const returns: number[] = [];
  let firstTimeMs = Number.POSITIVE_INFINITY;
  let lastTimeMs = Number.NEGATIVE_INFINITY;

  for (const signal of signals) {
    if (signal.direction === 'HOLD') continue;
    const index = indexByTime.get(signal.barTime);
    if (index === undefined) continue;
    const current = sorted[index];
    const next = sorted[index + 1];
    if (next === undefined) continue;
    if (current.close <= 0 || next.close <= 0) continue;

    const logReturn = Math.log(next.close / current.close);
    if (!Number.isFinite(logReturn)) continue;

    returns.push(signal.direction === 'BUY' ? logReturn : -logReturn);
    const currentMs = Date.parse(current.time);
    const nextMs = Date.parse(next.time);
    if (currentMs < firstTimeMs) firstTimeMs = currentMs;
    if (nextMs > lastTimeMs) lastTimeMs = nextMs;
  }

  return {
    returns,
    firstTimeMs: Number.isFinite(firstTimeMs) ? firstTimeMs : 0,
    lastTimeMs: Number.isFinite(lastTimeMs) ? lastTimeMs : 0,
  };
}

/**
 * Anualiza sobre o tempo de calendário REALMENTE decorrido, sem inferir
 * sessões nem assumir um número de barras por ano — porte de
 * `_elapsed_annualization_factor`. Assumir 252 pregões aqui inventaria
 * dado sobre a frequência das barras que não temos.
 */
function elapsedAnnualizationFactor(observationCount: number, startMs: number, endMs: number): number {
  const elapsedMs = endMs - startMs;
  if (elapsedMs <= 0) return 0;
  return (observationCount * 365 * 86_400_000) / elapsedMs;
}

export function ruleSignificanceTest(input: RuleSignificanceInput): RuleSignificanceResult {
  const nSimulations = input.nSimulations ?? DEFAULT_N_SIMULATIONS;
  const seed = input.seed ?? DEFAULT_SEED;
  const meanBlockLength = input.meanBlockLength ?? DEFAULT_MEAN_BLOCK_LENGTH;

  if (nSimulations < 1) throw new Error('nSimulations deve ser no mínimo 1');
  if (meanBlockLength < 1) throw new Error('meanBlockLength deve ser no mínimo 1');

  const { returns, firstTimeMs, lastTimeMs } = nextBarLogReturns(input.bars, input.signals);
  const nObservations = returns.length;
  const observedMean = nObservations > 0 ? returns.reduce((sum, r) => sum + r, 0) / nObservations : 0;
  const annualizedReturn = observedMean * elapsedAnnualizationFactor(nObservations, firstTimeMs, lastTimeMs);

  if (nObservations < MIN_OBSERVATIONS) {
    return Object.freeze({
      observedMean,
      annualizedReturn,
      pValue: null,
      nObservations,
      nSimulations: 0,
      meanBlockLength,
      insufficientData: true,
    });
  }

  const simulated = stationaryBootstrap(returns, observedMean, nSimulations, seed, meanBlockLength);
  let atLeastAsExtreme = 0;
  for (let i = 0; i < simulated.length; i += 1) {
    if (simulated[i] >= observedMean) atLeastAsExtreme += 1;
  }

  return Object.freeze({
    observedMean,
    annualizedReturn,
    pValue: atLeastAsExtreme / simulated.length,
    nObservations,
    nSimulations: simulated.length,
    meanBlockLength,
    insufficientData: false,
  });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test:research-session`
Expected: PASSA, com as 6 linhas novas `— OK`.

- [ ] **Step 5: Commit**

```bash
git add src/domain/v1/models/rule-significance scripts/research-session
git commit -m "feat(pesquisa): teste de significância de regra com piso de observações"
```

---

### Task 3: Monte Carlo de ordem de trades

**Files:**
- Create: `src/domain/v1/models/backtest-run/metrics.ts`
- Modify: `src/domain/v1/models/backtest-run/index.ts` (remover `computeMetrics` local, importar de `./metrics`)
- Create: `src/domain/v1/models/monte-carlo-trades/index.ts`
- Modify: `scripts/research-session/research-session-test.ts`

**Interfaces:**
- Consumes: `createRng` (Task 1); `BacktestTrade`, `BacktestMetrics` de `backtest-run`.
- Produces:
  - `computeMetrics(trades: readonly BacktestTrade[], periodsPerYear: number): BacktestMetrics` (exportado de `backtest-run/metrics`)
  - `monteCarloTrades(input: MonteCarloInput): MonteCarloResult`
  - `MonteCarloInput = { trades, periodsPerYear, startingBalance, nScenarios?, seed? }`
  - `MonteCarloResult = { nScenarios, seed, original, invariants, pathDependent }`

- [ ] **Step 1: Extrair `computeMetrics` (refatoração mecânica, sem mudança de comportamento)**

Criar `src/domain/v1/models/backtest-run/metrics.ts` movendo **sem alterar** a função `computeMetrics` de `index.ts` (linhas ~228-262), acrescentando `export` e os imports de tipo:

```ts
/**
 * Métricas do backtest, extraídas de `index.ts` para poderem ser
 * recomputadas sobre conjuntos de trades reordenados (Monte Carlo) sem
 * duplicar a fórmula. Movimento mecânico: nenhum número muda.
 */
import type { BacktestMetrics, BacktestTrade } from './index';

export function computeMetrics(trades: readonly BacktestTrade[], periodsPerYear: number): BacktestMetrics {
  const n = trades.length;
  const totalNetPnl = trades.reduce((sum, t) => sum + t.netPnl, 0);
  const returns = trades.map((t) => t.netReturn);
  const totalNetReturn = returns.reduce((sum, r) => sum + r, 0);
  const meanReturn = n > 0 ? totalNetReturn / n : 0;
  const variance = n > 1 ? returns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / (n - 1) : 0;
  const stdDevReturn = Math.sqrt(variance);

  // R-BT-4: Sharpe uses sqrt(periodsPerYear) of the REAL timeframe, never a fixed sqrt(252).
  const sharpe = stdDevReturn > 0 ? (meanReturn / stdDevReturn) * Math.sqrt(periodsPerYear) : 0;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of trades) {
    equity += trade.netPnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }

  const wins = trades.filter((t) => t.netPnl > 0).length;
  const winRate = n > 0 ? wins / n : 0;

  return Object.freeze({
    trades: n,
    totalNetPnl,
    totalNetReturn,
    meanReturn,
    stdDevReturn,
    sharpe,
    periodsPerYear,
    maxDrawdown,
    winRate,
  });
}
```

Em `src/domain/v1/models/backtest-run/index.ts`: apagar a definição local de `computeMetrics` e acrescentar, junto aos outros imports do topo:

```ts
import { computeMetrics } from './metrics';
```

e junto aos re-exports públicos do módulo:

```ts
export { computeMetrics } from './metrics';
```

- [ ] **Step 2: Confirmar que nada quebrou**

Run: `npm run test:backtest-run`
Expected: PASSA. A extração é mecânica — se qualquer número mudar, a função foi alterada e não apenas movida.

- [ ] **Step 3: Escrever os testes que falham**

Acrescentar em `scripts/research-session/research-session-test.ts`:

```ts
import { monteCarloTrades } from '../../src/domain/v1/models/monte-carlo-trades';
import type { BacktestTrade } from '../../src/domain/v1/models/backtest-run';

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
  // Conjunto GRANDE de propósito. Com poucos trades o drawdown máximo
  // assume pouquíssimos valores distintos entre as permutações, e as
  // bandas de percentil colapsam no mesmo trio para qualquer seed — o que
  // faria a asserção "seeds diferentes → percentis diferentes" reprovar
  // uma implementação correta. Medido: 5 trades dão bandas idênticas entre
  // as seeds 42 e 43; 20 trades separam p5 e p50 com folga.
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
```

E registrar em `main()`:

```ts
  monteCarloInvariantsDoNotVary();
  monteCarloPathDependentDoesVary();
  monteCarloWithSingleTradeIsDegenerate();
  monteCarloIsDeterministic();
  monteCarloWithNoTradesDoesNotFabricate();
```

- [ ] **Step 4: Rodar e confirmar que falha**

Run: `npm run test:research-session`
Expected: FALHA — `Cannot find module '../../src/domain/v1/models/monte-carlo-trades'`.

- [ ] **Step 5: Implementar**

`src/domain/v1/models/monte-carlo-trades/index.ts`:

```ts
/**
 * Monte Carlo por embaralhamento da ORDEM dos trades — porte de
 * `jesse/research/monte_carlo/monte_carlo_trades.py`, adaptado ao que o
 * motor da WR de fato permite afirmar.
 *
 * O motor da WR é ADITIVO: `netPnl` é valor absoluto por trade, com
 * `lotSize` fixo. Logo retorno total, Sharpe, win rate e desvio-padrão são
 * INVARIANTES à ordem — embaralhar não muda nenhum deles. O que varia é o
 * caminho: `maxDrawdown` e, por consequência, o Calmar.
 *
 * O Jesse consegue variar o retorno também porque compõe (o tamanho da
 * posição sai do saldo corrente). Replicar isso exigiria mudar o motor
 * para sizing proporcional ao saldo — decisão de modelagem, fora deste
 * escopo.
 *
 * Por isso o resultado separa `invariants` de `pathDependent` em vez de
 * publicar percentis idênticos em três casas: um percentil degenerado
 * pareceria informação sem ser.
 *
 * O que isto responde: quanto do drawdown observado é sorte de sequência.
 * Duas estratégias com o mesmo lucro e o mesmo Sharpe podem ter drawdowns
 * muito diferentes dependendo de em que ordem os perdedores apareceram —
 * e é o drawdown que estoura conta pequena.
 */
import type { BacktestTrade } from '../backtest-run';
import { computeMetrics } from '../backtest-run/metrics';
import { createRng, DEFAULT_SEED } from '../research-rng';

export const DEFAULT_N_SCENARIOS = 1000;

export interface MonteCarloInput {
  readonly trades: readonly BacktestTrade[];
  readonly periodsPerYear: number;
  /** Saldo inicial, usado para expressar o drawdown como fração da conta. */
  readonly startingBalance: number;
  readonly nScenarios?: number;
  readonly seed?: number;
}

export interface PercentileBand {
  readonly p5: number;
  readonly p50: number;
  readonly p95: number;
  /** IC de 90% = [p5, p95]; IC de 95% = [p2_5, p97_5]. Mesmos cortes do Jesse. */
  readonly ci90: readonly [number, number];
  readonly ci95: readonly [number, number];
}

export interface MonteCarloInvariants {
  /** Sempre `true`: existe para a leitura não confundir ausência de percentil com omissão. */
  readonly orderInvariant: true;
  readonly totalNetPnl: number;
  readonly totalNetReturn: number;
  readonly meanReturn: number;
  readonly sharpe: number;
  readonly winRate: number;
}

export interface MonteCarloPathDependent {
  /** Drawdown máximo em unidades monetárias (negativo ou zero). */
  readonly maxDrawdown: PercentileBand;
  /** Drawdown máximo como fração de `startingBalance`. */
  readonly maxDrawdownPct: PercentileBand;
  /** Retorno total sobre |drawdown máximo|. Zero quando não houve drawdown. */
  readonly calmar: PercentileBand;
}

export interface MonteCarloResult {
  readonly nScenarios: number;
  readonly seed: number;
  readonly nTrades: number;
  /** Métricas do conjunto NÃO embaralhado, para comparação. */
  readonly original: { readonly maxDrawdown: number; readonly maxDrawdownPct: number; readonly calmar: number };
  readonly invariants: MonteCarloInvariants;
  readonly pathDependent: MonteCarloPathDependent;
}

/** Percentil por interpolação linear sobre a amostra ordenada. */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function band(values: number[]): PercentileBand {
  const sorted = [...values].sort((a, b) => a - b);
  return Object.freeze({
    p5: percentile(sorted, 0.05),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    ci90: Object.freeze([percentile(sorted, 0.05), percentile(sorted, 0.95)]) as readonly [number, number],
    ci95: Object.freeze([percentile(sorted, 0.025), percentile(sorted, 0.975)]) as readonly [number, number],
  });
}

/** Fisher-Yates com o PRNG semeado — nunca `Math.random()`. */
function shuffled(trades: readonly BacktestTrade[], rng: ReturnType<typeof createRng>): BacktestTrade[] {
  const copy = [...trades];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rng.nextInt(i + 1);
    const swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  return copy;
}

function pathMetricsOf(
  trades: readonly BacktestTrade[],
  periodsPerYear: number,
  startingBalance: number,
): { maxDrawdown: number; maxDrawdownPct: number; calmar: number } {
  const metrics = computeMetrics(trades, periodsPerYear);
  const maxDrawdown = metrics.maxDrawdown;
  const maxDrawdownPct = startingBalance > 0 ? maxDrawdown / startingBalance : 0;
  const absDrawdown = Math.abs(maxDrawdown);
  const calmar = absDrawdown > 0 ? metrics.totalNetPnl / absDrawdown : 0;
  return { maxDrawdown, maxDrawdownPct, calmar };
}

export function monteCarloTrades(input: MonteCarloInput): MonteCarloResult {
  const nScenariosRequested = input.nScenarios ?? DEFAULT_N_SCENARIOS;
  const seed = input.seed ?? DEFAULT_SEED;
  if (nScenariosRequested < 1) throw new Error('nScenarios deve ser no mínimo 1');
  if (input.startingBalance <= 0) throw new Error('startingBalance deve ser positivo');

  const baseMetrics = computeMetrics(input.trades, input.periodsPerYear);
  const original = pathMetricsOf(input.trades, input.periodsPerYear, input.startingBalance);

  const invariants: MonteCarloInvariants = Object.freeze({
    orderInvariant: true as const,
    totalNetPnl: baseMetrics.totalNetPnl,
    totalNetReturn: baseMetrics.totalNetReturn,
    meanReturn: baseMetrics.meanReturn,
    sharpe: baseMetrics.sharpe,
    winRate: baseMetrics.winRate,
  });

  // Sem trades não há sequência a embaralhar: devolver bandas zeradas em
  // vez de simular cenários vazios, que dariam a impressão de resultado.
  if (input.trades.length === 0) {
    const zero = band([0]);
    return Object.freeze({
      nScenarios: 0,
      seed,
      nTrades: 0,
      original,
      invariants,
      pathDependent: Object.freeze({ maxDrawdown: zero, maxDrawdownPct: zero, calmar: zero }),
    });
  }

  const rng = createRng(seed);
  const drawdowns: number[] = [];
  const drawdownPcts: number[] = [];
  const calmars: number[] = [];

  for (let scenario = 0; scenario < nScenariosRequested; scenario += 1) {
    const path = pathMetricsOf(shuffled(input.trades, rng), input.periodsPerYear, input.startingBalance);
    drawdowns.push(path.maxDrawdown);
    drawdownPcts.push(path.maxDrawdownPct);
    calmars.push(path.calmar);
  }

  return Object.freeze({
    nScenarios: nScenariosRequested,
    seed,
    nTrades: input.trades.length,
    original,
    invariants,
    pathDependent: Object.freeze({
      maxDrawdown: band(drawdowns),
      maxDrawdownPct: band(drawdownPcts),
      calmar: band(calmars),
    }),
  });
}
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npm run test:research-session`
Expected: PASSA, com as 5 linhas novas `— OK`.

- [ ] **Step 7: Commit**

```bash
git add src/domain/v1/models/backtest-run src/domain/v1/models/monte-carlo-trades scripts/research-session
git commit -m "feat(pesquisa): Monte Carlo de ordem de trades separando invariantes de caminho"
```

---

### Task 4: Modelo Prisma `ResearchSession` e repositório

**Files:**
- Modify: `prisma/schema.prisma` (acrescentar modelo ao final; nenhum modelo existente é tocado)
- Create: `prisma/migrations/<timestamp>_add_research_session/migration.sql` (gerada pelo CLI)
- Create: `src/domain/v1/models/research-session/index.ts`
- Create: `src/domain/v1/ports/research-session-repository.ts`
- Create: `src/adapters/prisma/research-session/{errors,schemas,mapping,repository,test-support,index}.ts`
- Modify: `scripts/research-session/research-session-test.ts`

**Interfaces:**
- Consumes: nada dos módulos anteriores.
- Produces:
  - `ResearchSessionKind = 'SIGNIFICANCE' | 'MONTE_CARLO'`
  - `ResearchSessionStatus = 'DRAFT' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED'`
  - `canTransition(from: ResearchSessionStatus, to: ResearchSessionStatus): boolean`
  - `ResearchSessionPersistedShape` (datas como strings ISO)
  - `PrismaResearchSessionRepository` implementando `ResearchSessionRepository` com `create`, `findById`, `list`, `updateDraft`, `claimForRun`, `finish`, `cancel`, `delete`
  - `insertResearchSessionForTest(prisma, overrides)`

- [ ] **Step 1: Acrescentar o modelo ao schema**

No final de `prisma/schema.prisma`:

```prisma
// ---------------------------------------------------------------------------
// Ferramentas de pesquisa portadas do Jesse (spec 2026-09-06). Sessão
// GENÉRICA por `kind` — é o que o Jesse faz (backtest, monte carlo,
// significância e otimização compartilham a mesma forma de sessão), e evita
// que a próxima ferramenta peça uma tabela nova.
//
// `errorSummary` guarda apenas texto já sanitizado, nunca stack trace nem
// path bruto — mesmo cuidado já documentado em `BackfillRun`.
//
// A transição DRAFT -> RUNNING é feita por update CONDICIONAL no repositório
// (claimForRun), nunca por read-then-write: duas chamadas concorrentes de
// run() no mesmo rascunho não podem ambas disparar processamento.
// ---------------------------------------------------------------------------
model ResearchSession {
  sessionId    String   @id @default(cuid())
  kind         String // SIGNIFICANCE | MONTE_CARLO
  status       String // DRAFT | RUNNING | DONE | FAILED | CANCELLED
  label        String
  notes        String?
  configJson   String
  resultJson   String?
  errorSummary String?
  createdBy    String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([kind, status, createdAt])
}
```

- [ ] **Step 2: Gerar a migration e o client**

Run:
```bash
npx prisma migrate dev --name add_research_session
npx prisma generate
```

Expected: migration criada em `prisma/migrations/`, client regenerado. Se `migrate dev` pedir reset do banco de desenvolvimento, **cancele** e use `npx prisma migrate dev --create-only --name add_research_session` seguido de `npx prisma migrate deploy` — a migration é puramente aditiva (um `CREATE TABLE`) e nunca deve exigir reset.

- [ ] **Step 3: Escrever os testes que falham**

Acrescentar no topo de `scripts/research-session/research-session-test.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import {
  PrismaResearchSessionRepository,
  insertResearchSessionForTest,
} from '../../src/adapters/prisma/research-session';
import { canTransition } from '../../src/domain/v1/models/research-session';
```

E os casos, antes de `main()`:

```ts
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
```

E reescrever `main()` para abrir o Prisma:

```ts
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
```

- [ ] **Step 4: Rodar e confirmar que falha**

Run: `npm run test:research-session`
Expected: FALHA na compilação — `Cannot find module '../../src/adapters/prisma/research-session'`.

- [ ] **Step 5: Implementar o modelo de domínio**

`src/domain/v1/models/research-session/index.ts`:

```ts
/**
 * Sessão de pesquisa — o padrão draft→run→session portado do Jesse.
 *
 * O ganho de persistir o rascunho, e o motivo de não ser uma tool única com
 * 20 parâmetros: o agente monta a configuração incrementalmente, o `run` é
 * um passo separado e cancelável, e o rascunho sobrevive ao reinício do MCP
 * Pilot — que é processo filho do Electron e reinicia com frequência.
 */

export const RESEARCH_SESSION_KINDS = ['SIGNIFICANCE', 'MONTE_CARLO'] as const;
export type ResearchSessionKind = (typeof RESEARCH_SESSION_KINDS)[number];

export const RESEARCH_SESSION_STATUSES = ['DRAFT', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED'] as const;
export type ResearchSessionStatus = (typeof RESEARCH_SESSION_STATUSES)[number];

/**
 * Transições permitidas. Estados terminais (DONE, FAILED, CANCELLED) não
 * voltam: uma sessão concluída que pudesse rodar de novo tornaria o
 * `resultJson` ambíguo sobre qual configuração o produziu.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<ResearchSessionStatus, readonly ResearchSessionStatus[]>> = Object.freeze({
  DRAFT: ['RUNNING', 'CANCELLED'],
  RUNNING: ['DONE', 'FAILED', 'CANCELLED'],
  DONE: [],
  FAILED: [],
  CANCELLED: [],
});

export function canTransition(from: ResearchSessionStatus, to: ResearchSessionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface ResearchSessionPersistedShape {
  readonly sessionId: string;
  readonly kind: string;
  readonly status: string;
  readonly label: string;
  readonly notes: string | null;
  readonly configJson: string;
  readonly resultJson: string | null;
  readonly errorSummary: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

- [ ] **Step 6: Implementar a porta**

`src/domain/v1/ports/research-session-repository.ts`:

```ts
import type {
  ResearchSessionKind,
  ResearchSessionPersistedShape,
  ResearchSessionStatus,
} from '../models/research-session';

export interface ResearchSessionSubmission {
  readonly kind: ResearchSessionKind;
  readonly label: string;
  readonly notes: string | null;
  readonly configJson: string;
  readonly createdBy: string;
}

export interface ResearchSessionDraftPatch {
  readonly label?: string;
  readonly notes?: string | null;
  readonly configJson?: string;
}

export interface ResearchSessionListQuery {
  readonly kind?: ResearchSessionKind;
  readonly status?: ResearchSessionStatus;
  readonly limit: number;
  readonly cursor?: string;
}

export type ResearchSessionOutcome =
  | { readonly status: 'DONE'; readonly resultJson: string }
  | { readonly status: 'FAILED'; readonly errorSummary: string };

export interface ResearchSessionRepository {
  create(submission: ResearchSessionSubmission): Promise<ResearchSessionPersistedShape>;
  findById(sessionId: string): Promise<ResearchSessionPersistedShape | null>;
  list(query: ResearchSessionListQuery): Promise<readonly ResearchSessionPersistedShape[]>;
  /** `null` quando a sessão não existe ou não está em DRAFT. */
  updateDraft(sessionId: string, patch: ResearchSessionDraftPatch): Promise<ResearchSessionPersistedShape | null>;
  /** Update CONDICIONAL DRAFT->RUNNING. `true` só para quem venceu a corrida. */
  claimForRun(sessionId: string): Promise<boolean>;
  /** Fecha uma sessão RUNNING em DONE (com resultado) ou FAILED (com resumo sanitizado). */
  finish(sessionId: string, outcome: ResearchSessionOutcome): Promise<ResearchSessionPersistedShape | null>;
  /** Cancela DRAFT ou RUNNING. Idempotente sobre sessão terminal: devolve a linha sem alterar. */
  cancel(sessionId: string): Promise<ResearchSessionPersistedShape | null>;
  delete(sessionId: string): Promise<boolean>;
}
```

- [ ] **Step 7: Implementar o adapter Prisma**

`src/adapters/prisma/research-session/errors.ts`:

```ts
export class ResearchSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidResearchSessionInputError extends ResearchSessionError {}
export class ResearchSessionNotFoundError extends ResearchSessionError {}
```

`src/adapters/prisma/research-session/schemas.ts`:

```ts
import { z } from 'zod';
import { RESEARCH_SESSION_KINDS, RESEARCH_SESSION_STATUSES } from '../../../domain/v1/models/research-session';

export const ResearchSessionKindSchema = z.enum(RESEARCH_SESSION_KINDS);
export const ResearchSessionStatusSchema = z.enum(RESEARCH_SESSION_STATUSES);

export const ResearchSessionSubmissionSchema = z
  .object({
    kind: ResearchSessionKindSchema,
    label: z.string().min(1).max(200),
    notes: z.string().max(4000).nullable(),
    configJson: z.string().min(2).max(2_000_000),
    createdBy: z.string().min(1).max(120),
  })
  .strict();

export const ResearchSessionDraftPatchSchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    notes: z.string().max(4000).nullable().optional(),
    configJson: z.string().min(2).max(2_000_000).optional(),
  })
  .strict();
```

`src/adapters/prisma/research-session/mapping.ts`:

```ts
import type { ResearchSession as ResearchSessionRow } from '@prisma/client';
import type { ResearchSessionPersistedShape } from '../../../domain/v1/models/research-session';

export const toResearchSession = (row: ResearchSessionRow): ResearchSessionPersistedShape => ({
  sessionId: row.sessionId,
  kind: row.kind,
  status: row.status,
  label: row.label,
  notes: row.notes,
  configJson: row.configJson,
  resultJson: row.resultJson,
  errorSummary: row.errorSummary,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
```

`src/adapters/prisma/research-session/repository.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import type { ResearchSessionPersistedShape } from '../../../domain/v1/models/research-session';
import type {
  ResearchSessionDraftPatch,
  ResearchSessionListQuery,
  ResearchSessionOutcome,
  ResearchSessionRepository,
  ResearchSessionSubmission,
} from '../../../domain/v1/ports/research-session-repository';
import { toResearchSession } from './mapping';

export class PrismaResearchSessionRepository implements ResearchSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(submission: ResearchSessionSubmission): Promise<ResearchSessionPersistedShape> {
    const row = await this.prisma.researchSession.create({
      data: {
        kind: submission.kind,
        status: 'DRAFT',
        label: submission.label,
        notes: submission.notes,
        configJson: submission.configJson,
        createdBy: submission.createdBy,
      },
    });
    return toResearchSession(row);
  }

  async findById(sessionId: string): Promise<ResearchSessionPersistedShape | null> {
    const row = await this.prisma.researchSession.findUnique({ where: { sessionId } });
    return row === null ? null : toResearchSession(row);
  }

  async list(query: ResearchSessionListQuery): Promise<readonly ResearchSessionPersistedShape[]> {
    const rows = await this.prisma.researchSession.findMany({
      where: {
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        ...(query.status === undefined ? {} : { status: query.status }),
      },
      orderBy: [{ createdAt: 'desc' }, { sessionId: 'desc' }],
      take: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: { sessionId: query.cursor }, skip: 1 }),
    });
    return rows.map(toResearchSession);
  }

  async updateDraft(
    sessionId: string,
    patch: ResearchSessionDraftPatch,
  ): Promise<ResearchSessionPersistedShape | null> {
    // Condicional em `status: 'DRAFT'` — editar a config de uma sessão já em
    // execução tornaria o resultado impossível de atribuir a uma configuração.
    const affected = await this.prisma.researchSession.updateMany({
      where: { sessionId, status: 'DRAFT' },
      data: {
        ...(patch.label === undefined ? {} : { label: patch.label }),
        ...(patch.notes === undefined ? {} : { notes: patch.notes }),
        ...(patch.configJson === undefined ? {} : { configJson: patch.configJson }),
      },
    });
    if (affected.count === 0) return null;
    return this.findById(sessionId);
  }

  async claimForRun(sessionId: string): Promise<boolean> {
    // CAS: mesma trava que `ModelVersion.publishedAt` já usa neste schema.
    // Nunca read-then-write — duas chamadas concorrentes de run() não podem
    // ambas disparar processamento sobre o mesmo rascunho.
    const affected = await this.prisma.researchSession.updateMany({
      where: { sessionId, status: 'DRAFT' },
      data: { status: 'RUNNING' },
    });
    return affected.count === 1;
  }

  async finish(sessionId: string, outcome: ResearchSessionOutcome): Promise<ResearchSessionPersistedShape | null> {
    const affected = await this.prisma.researchSession.updateMany({
      where: { sessionId, status: 'RUNNING' },
      data:
        outcome.status === 'DONE'
          ? { status: 'DONE', resultJson: outcome.resultJson }
          : { status: 'FAILED', errorSummary: outcome.errorSummary },
    });
    if (affected.count === 0) return null;
    return this.findById(sessionId);
  }

  async cancel(sessionId: string): Promise<ResearchSessionPersistedShape | null> {
    await this.prisma.researchSession.updateMany({
      where: { sessionId, status: { in: ['DRAFT', 'RUNNING'] } },
      data: { status: 'CANCELLED' },
    });
    // Idempotente: cancelar uma sessão já terminal devolve a linha atual, não
    // um erro. Cancelar duas vezes não é um problema a reportar.
    return this.findById(sessionId);
  }

  async delete(sessionId: string): Promise<boolean> {
    const affected = await this.prisma.researchSession.deleteMany({ where: { sessionId } });
    return affected.count === 1;
  }
}
```

`src/adapters/prisma/research-session/test-support.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import type { ResearchSessionPersistedShape } from '../../../domain/v1/models/research-session';
import { toResearchSession } from './mapping';

export interface ResearchSessionTestOverrides {
  readonly kind?: string;
  readonly status?: string;
  readonly label?: string;
  readonly configJson?: string;
  readonly createdBy?: string;
}

/** Insere uma sessão direto no banco, para testes de repositório. */
export async function insertResearchSessionForTest(
  prisma: PrismaClient,
  overrides: ResearchSessionTestOverrides = {},
): Promise<ResearchSessionPersistedShape> {
  const row = await prisma.researchSession.create({
    data: {
      kind: overrides.kind ?? 'SIGNIFICANCE',
      status: overrides.status ?? 'DRAFT',
      label: overrides.label ?? 'sessão de teste',
      notes: null,
      configJson: overrides.configJson ?? '{}',
      createdBy: overrides.createdBy ?? 'test',
    },
  });
  return toResearchSession(row);
}
```

`src/adapters/prisma/research-session/index.ts`:

```ts
export * from './errors';
export { PrismaResearchSessionRepository } from './repository';
export {
  ResearchSessionDraftPatchSchema,
  ResearchSessionKindSchema,
  ResearchSessionStatusSchema,
  ResearchSessionSubmissionSchema,
} from './schemas';
export { toResearchSession } from './mapping';
export { insertResearchSessionForTest } from './test-support';
```

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `npm run test:research-session`
Expected: PASSA, com as 4 linhas novas `— OK`.

- [ ] **Step 9: Commit**

```bash
git add prisma src/domain/v1/models/research-session src/domain/v1/ports/research-session-repository.ts src/adapters/prisma/research-session scripts/research-session
git commit -m "feat(pesquisa): modelo ResearchSession com claim atomico DRAFT->RUNNING"
```

---

### Task 5: Serviço de aplicação

**Files:**
- Create: `src/application/research-session/config-schemas.ts`
- Create: `src/application/research-session/dto.ts`
- Create: `src/application/research-session/service.ts`
- Create: `src/application/research-session/index.ts`
- Modify: `src/application/read-models-v1/errors.ts` (talvez — ver Step 1)
- Modify: `scripts/research-session/research-session-test.ts`

**Interfaces:**
- Consumes: `ruleSignificanceTest` (Task 2), `monteCarloTrades` (Task 3), `PrismaResearchSessionRepository` (Task 4).
- Produces:
  - `createResearchSessionService(prisma: PrismaClient): ResearchSessionService`
  - Métodos: `createDraft`, `updateDraft`, `get`, `list`, `run`, `cancel`, `remove`
  - `SignificanceConfigSchema`, `MonteCarloConfigSchema`
  - `ResearchSessionReadModel = { sessionId, kind, status, label, notes, config, result, errorSummary, createdBy, createdAt, updatedAt }`

- [ ] **Step 1: Acrescentar os códigos de erro ao union**

`ReadModelErrorCode` em `src/application/read-models-v1/errors.ts` é um union FECHADO, e ele não tem `NOT_FOUND` nem `CONFLICT` genéricos — a convenção do arquivo é um código por recurso (`BACKTEST_NOT_FOUND`, `SIGNAL_NOT_FOUND`). Siga a convenção: acrescente três membros ao union, junto dos outros `*_NOT_FOUND`:

```ts
  | 'RESEARCH_SESSION_NOT_FOUND'
  | 'RESEARCH_SESSION_ALREADY_RUNNING'
  | 'RESEARCH_SESSION_NOT_EDITABLE'
```

`INVALID_QUERY`, `INVALID_BODY` e `INSUFFICIENT_DATA` já existem e são reaproveitados.

- [ ] **Step 2: Escrever os testes que falham**

Acrescentar os imports no topo de `scripts/research-session/research-session-test.ts`:

```ts
import { createResearchSessionService } from '../../src/application/research-session';
import { ReadModelError } from '../../src/application/read-models-v1';
```

E os casos:

```ts
/** Config de significância sobre uma série com deriva positiva clara. */
function significanceConfigFor(nBars: number): Record<string, unknown> {
  const closes = Array.from({ length: nBars }, (_, i) => 100 * 1.004 ** i);
  const bars = closes.map((close, i) => {
    const time = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
    return { time, open: close, high: close, low: close, close, knowledgeTime: time };
  });
  return {
    bars,
    signals: bars
      .slice(0, -1)
      .map((bar) => ({ barTime: bar.time, direction: 'BUY', knowledgeTime: bar.knowledgeTime })),
    nSimulations: 200,
    seed: 42,
  };
}

async function serviceRunsSignificanceEndToEnd(prisma: PrismaClient): Promise<void> {
  const service = createResearchSessionService(prisma);
  const draft = await service.createDraft({
    kind: 'SIGNIFICANCE',
    label: 'regra de teste',
    notes: null,
    config: significanceConfigFor(120),
    createdBy: 'test',
  });
  assert.equal(draft.status, 'DRAFT');

  const done = await service.run(draft.sessionId);
  assert.equal(done.status, 'DONE', 'a sessão deveria concluir');
  const result = done.result as { pValue: number | null; insufficientData: boolean };
  assert.equal(result.insufficientData, false);
  assert.ok(result.pValue !== null && result.pValue < 0.05, `esperava significativo, veio p=${result.pValue}`);
  console.log('Serviço: significância roda fim-a-fim e persiste o resultado — OK');
}

async function serviceRejectsWrongConfigForKind(prisma: PrismaClient): Promise<void> {
  const service = createResearchSessionService(prisma);
  await assert.rejects(
    () =>
      service.createDraft({
        kind: 'SIGNIFICANCE',
        label: 'config trocada',
        notes: null,
        // Config de Monte Carlo num rascunho de significância.
        config: { trades: [], periodsPerYear: 252, startingBalance: 1000 },
        createdBy: 'test',
      }),
    (error: unknown) => error instanceof ReadModelError,
    'config de outro kind deve ser rejeitada na fronteira',
  );
  console.log('Serviço: config inválida para o kind é rejeitada — OK');
}

async function serviceRunRefusesSecondRun(prisma: PrismaClient): Promise<void> {
  const service = createResearchSessionService(prisma);
  const draft = await service.createDraft({
    kind: 'SIGNIFICANCE',
    label: 'roda uma vez só',
    notes: null,
    config: significanceConfigFor(120),
    createdBy: 'test',
  });
  await service.run(draft.sessionId);
  await assert.rejects(
    () => service.run(draft.sessionId),
    (error: unknown) => error instanceof ReadModelError && error.code === 'RESEARCH_SESSION_ALREADY_RUNNING',
    'a segunda chamada de run deve ser recusada',
  );
  console.log('Serviço: run duplicado é recusado com RESEARCH_SESSION_ALREADY_RUNNING — OK');
}

async function serviceCancelIsIdempotent(prisma: PrismaClient): Promise<void> {
  const service = createResearchSessionService(prisma);
  const draft = await service.createDraft({
    kind: 'MONTE_CARLO',
    label: 'cancelar duas vezes',
    notes: null,
    config: { trades: [], periodsPerYear: 252, startingBalance: 1000, nScenarios: 10 },
    createdBy: 'test',
  });
  const first = await service.cancel(draft.sessionId);
  const second = await service.cancel(draft.sessionId);
  assert.equal(first.status, 'CANCELLED');
  assert.equal(second.status, 'CANCELLED', 'cancelar de novo não é erro');
  console.log('Serviço: cancel é idempotente — OK');
}
```

E registrar dentro do bloco `try` do Prisma em `main()`:

```ts
    await serviceRunsSignificanceEndToEnd(prisma);
    await serviceRejectsWrongConfigForKind(prisma);
    await serviceRunRefusesSecondRun(prisma);
    await serviceCancelIsIdempotent(prisma);
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm run test:research-session`
Expected: FALHA — `Cannot find module '../../src/application/research-session'`.

- [ ] **Step 4: Implementar os schemas de configuração**

`src/application/research-session/config-schemas.ts`:

```ts
/**
 * Configuração por `kind`. Um rascunho de SIGNIFICANCE e um de MONTE_CARLO
 * não aceitam a mesma config — validar na criação evita uma sessão que só
 * descobre estar inválida na hora de rodar.
 *
 * Todo schema é `.strict()`: campo extra é rejeitado, nunca ignorado.
 */
import { z } from 'zod';

const TimestampSchema = z.string().datetime();

const BarSchema = z
  .object({
    time: TimestampSchema,
    open: z.number().finite(),
    high: z.number().finite(),
    low: z.number().finite(),
    close: z.number().finite(),
    knowledgeTime: TimestampSchema,
  })
  .strict();

const SignalSchema = z
  .object({
    barTime: TimestampSchema,
    direction: z.enum(['BUY', 'SELL', 'HOLD']),
    knowledgeTime: TimestampSchema,
    stopPrice: z.number().finite().nullish(),
    takeProfitPrice: z.number().finite().nullish(),
  })
  .strict();

export const SignificanceConfigSchema = z
  .object({
    bars: z.array(BarSchema).min(1).max(50_000),
    signals: z.array(SignalSchema).max(50_000),
    nSimulations: z.number().int().min(100).max(20_000).optional(),
    seed: z.number().int().optional(),
    meanBlockLength: z.number().int().min(1).max(500).optional(),
  })
  .strict();

const TradeSchema = z
  .object({
    signalBarTime: TimestampSchema,
    entryTime: TimestampSchema,
    entryPrice: z.number().finite(),
    exitTime: TimestampSchema,
    exitPrice: z.number().finite(),
    direction: z.enum(['BUY', 'SELL']),
    grossPnl: z.number().finite(),
    costs: z.number().finite(),
    netPnl: z.number().finite(),
    netReturn: z.number().finite(),
    exitReason: z.enum(['STOP', 'TAKE_PROFIT', 'WINDOW_END', 'HORIZON_END']),
  })
  .strict();

export const MonteCarloConfigSchema = z
  .object({
    trades: z.array(TradeSchema).max(50_000),
    periodsPerYear: z.number().positive().max(525_600),
    startingBalance: z.number().positive(),
    nScenarios: z.number().int().min(10).max(20_000).optional(),
    seed: z.number().int().optional(),
  })
  .strict();

export type SignificanceConfig = z.infer<typeof SignificanceConfigSchema>;
export type MonteCarloConfig = z.infer<typeof MonteCarloConfigSchema>;
```

- [ ] **Step 5: Implementar o DTO**

`src/application/research-session/dto.ts`:

```ts
import type { ResearchSessionKind, ResearchSessionStatus } from '../../domain/v1/models/research-session';

export interface ResearchSessionReadModel {
  readonly sessionId: string;
  readonly kind: ResearchSessionKind;
  readonly status: ResearchSessionStatus;
  readonly label: string;
  readonly notes: string | null;
  readonly config: unknown;
  readonly result: unknown;
  readonly errorSummary: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateDraftRequest {
  readonly kind: ResearchSessionKind;
  readonly label: string;
  readonly notes: string | null;
  readonly config: unknown;
  readonly createdBy: string;
}

export interface UpdateDraftRequest {
  readonly label?: string;
  readonly notes?: string | null;
  readonly config?: unknown;
}

export interface ListRequest {
  readonly kind?: ResearchSessionKind;
  readonly status?: ResearchSessionStatus;
  readonly limit: number;
  readonly cursor?: string;
}
```

- [ ] **Step 6: Implementar o serviço**

`src/application/research-session/service.ts`:

```ts
/**
 * Orquestração das sessões de pesquisa: a camada que lê banco e valida. O
 * cálculo em si vive nos módulos PUROS de domínio, que não conhecem nem
 * Prisma nem Zod.
 */
import type { PrismaClient } from '@prisma/client';
import { PrismaResearchSessionRepository } from '../../adapters/prisma/research-session';
import type { ResearchSessionRepository } from '../../domain/v1/ports/research-session-repository';
import { canTransition } from '../../domain/v1/models/research-session';
import type {
  ResearchSessionKind,
  ResearchSessionPersistedShape,
  ResearchSessionStatus,
} from '../../domain/v1/models/research-session';
import { ruleSignificanceTest } from '../../domain/v1/models/rule-significance';
import { monteCarloTrades } from '../../domain/v1/models/monte-carlo-trades';
import { ReadModelError } from '../read-models-v1/errors';
import { MonteCarloConfigSchema, SignificanceConfigSchema } from './config-schemas';
import type { CreateDraftRequest, ListRequest, ResearchSessionReadModel, UpdateDraftRequest } from './dto';

const MAX_ERROR_SUMMARY = 400;

function parseConfig(kind: ResearchSessionKind, config: unknown): unknown {
  const schema = kind === 'SIGNIFICANCE' ? SignificanceConfigSchema : MonteCarloConfigSchema;
  const parsed = schema.safeParse(config);
  if (!parsed.success) {
    throw new ReadModelError(
      'INVALID_QUERY',
      `config inválida para ${kind}: ` +
        parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`).join('; '),
    );
  }
  return parsed.data;
}

/**
 * Resumo sanitizado: nunca stack trace, path ou mensagem crua do driver —
 * mesmo cuidado já aplicado em `BackfillRun`.
 */
function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'erro desconhecido';
  return raw
    .replace(/[A-Za-z]:\\[^\s]*/g, '<path>')
    .replace(/\/[^\s]*\//g, '<path>')
    .slice(0, MAX_ERROR_SUMMARY);
}

function toReadModel(row: ResearchSessionPersistedShape): ResearchSessionReadModel {
  return {
    sessionId: row.sessionId,
    kind: row.kind as ResearchSessionKind,
    status: row.status as ResearchSessionStatus,
    label: row.label,
    notes: row.notes,
    config: JSON.parse(row.configJson),
    result: row.resultJson === null ? null : JSON.parse(row.resultJson),
    errorSummary: row.errorSummary,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ResearchSessionService {
  constructor(private readonly repository: ResearchSessionRepository) {}

  async createDraft(request: CreateDraftRequest): Promise<ResearchSessionReadModel> {
    const config = parseConfig(request.kind, request.config);
    const row = await this.repository.create({
      kind: request.kind,
      label: request.label,
      notes: request.notes,
      configJson: JSON.stringify(config),
      createdBy: request.createdBy,
    });
    return toReadModel(row);
  }

  async updateDraft(sessionId: string, patch: UpdateDraftRequest): Promise<ResearchSessionReadModel> {
    const existing = await this.repository.findById(sessionId);
    if (existing === null) throw new ReadModelError('RESEARCH_SESSION_NOT_FOUND', 'sessão de pesquisa não encontrada');

    const configJson =
      patch.config === undefined
        ? undefined
        : JSON.stringify(parseConfig(existing.kind as ResearchSessionKind, patch.config));

    const updated = await this.repository.updateDraft(sessionId, {
      ...(patch.label === undefined ? {} : { label: patch.label }),
      ...(patch.notes === undefined ? {} : { notes: patch.notes }),
      ...(configJson === undefined ? {} : { configJson }),
    });
    if (updated === null) {
      throw new ReadModelError('RESEARCH_SESSION_NOT_EDITABLE', `sessão em status ${existing.status} não aceita edição de rascunho`);
    }
    return toReadModel(updated);
  }

  async get(sessionId: string): Promise<ResearchSessionReadModel> {
    const row = await this.repository.findById(sessionId);
    if (row === null) throw new ReadModelError('RESEARCH_SESSION_NOT_FOUND', 'sessão de pesquisa não encontrada');
    return toReadModel(row);
  }

  async list(request: ListRequest): Promise<readonly ResearchSessionReadModel[]> {
    const rows = await this.repository.list(request);
    return rows.map(toReadModel);
  }

  async run(sessionId: string): Promise<ResearchSessionReadModel> {
    const existing = await this.repository.findById(sessionId);
    if (existing === null) throw new ReadModelError('RESEARCH_SESSION_NOT_FOUND', 'sessão de pesquisa não encontrada');

    // Guarda de estado explícita ANTES do claim: dá a mensagem correta
    // ("sessão em status DONE") em vez de deixar o claim falhar mudo. A
    // máquina de estados do domínio é a fonte da regra; o `where` do
    // repositório é o que a torna atômica sob concorrência.
    if (!canTransition(existing.status as ResearchSessionStatus, 'RUNNING')) {
      throw new ReadModelError(
        'RESEARCH_SESSION_ALREADY_RUNNING',
        `sessão em status ${existing.status} não pode ser executada`,
      );
    }

    // CAS: só quem transiciona DRAFT->RUNNING roda. A guarda acima não
    // basta — entre ela e aqui outra chamada pode ter reivindicado a mesma
    // sessão. Uma segunda chamada concorrente perde a corrida e é recusada,
    // em vez de disparar o mesmo processamento duas vezes.
    const claimed = await this.repository.claimForRun(sessionId);
    if (!claimed) {
      throw new ReadModelError('RESEARCH_SESSION_ALREADY_RUNNING', `sessão em status ${existing.status} não pode ser executada`);
    }

    try {
      const kind = existing.kind as ResearchSessionKind;
      const config = parseConfig(kind, JSON.parse(existing.configJson));
      const result =
        kind === 'SIGNIFICANCE'
          ? ruleSignificanceTest(config as Parameters<typeof ruleSignificanceTest>[0])
          : monteCarloTrades(config as Parameters<typeof monteCarloTrades>[0]);

      const finished = await this.repository.finish(sessionId, {
        status: 'DONE',
        resultJson: JSON.stringify(result),
      });
      if (finished === null) throw new ReadModelError('RESEARCH_SESSION_NOT_EDITABLE', 'sessão deixou o estado RUNNING durante a execução');
      return toReadModel(finished);
    } catch (error) {
      const failed = await this.repository.finish(sessionId, {
        status: 'FAILED',
        errorSummary: sanitizeError(error),
      });
      if (failed !== null) return toReadModel(failed);
      throw error;
    }
  }

  async cancel(sessionId: string): Promise<ResearchSessionReadModel> {
    const row = await this.repository.cancel(sessionId);
    if (row === null) throw new ReadModelError('RESEARCH_SESSION_NOT_FOUND', 'sessão de pesquisa não encontrada');
    return toReadModel(row);
  }

  async remove(sessionId: string): Promise<void> {
    const deleted = await this.repository.delete(sessionId);
    if (!deleted) throw new ReadModelError('RESEARCH_SESSION_NOT_FOUND', 'sessão de pesquisa não encontrada');
  }
}

export function createResearchSessionService(prisma: PrismaClient): ResearchSessionService {
  return new ResearchSessionService(new PrismaResearchSessionRepository(prisma));
}
```

`src/application/research-session/index.ts`:

```ts
export { createResearchSessionService, ResearchSessionService } from './service';
export { MonteCarloConfigSchema, SignificanceConfigSchema } from './config-schemas';
export type { CreateDraftRequest, ListRequest, ResearchSessionReadModel, UpdateDraftRequest } from './dto';
```

- [ ] **Step 7: Rodar e confirmar que passa**

Run: `npm run test:research-session`
Expected: PASSA, com as 4 linhas novas `— OK`.

- [ ] **Step 8: Commit**

```bash
git add src/application scripts/research-session
git commit -m "feat(pesquisa): servico de sessao com validacao por kind e CAS no run"
```

---

### Task 6: Rotas HTTP

**Files:**
- Create: `src/app/api/v1/research-sessions/route.ts`
- Create: `src/app/api/v1/research-sessions/[id]/route.ts`
- Create: `src/app/api/v1/research-sessions/[id]/run/route.ts`
- Create: `src/app/api/v1/research-sessions/[id]/cancel/route.ts`

**Interfaces:**
- Consumes: `createResearchSessionService` (Task 5); `extractStrictQuery`, `jsonError`, `jsonSuccess`, `parseWithSchema` de `src/app/api/v1/_shared/http`.
- Produces: as 7 rotas da spec. Nenhuma task posterior depende delas — as tools MCP chamam o serviço direto, não o HTTP.

- [ ] **Step 1: Criar a rota de coleção**

`src/app/api/v1/research-sessions/route.ts`:

```ts
import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { createResearchSessionService } from '../../../../application/research-session';
import {
  ResearchSessionKindSchema,
  ResearchSessionStatusSchema,
} from '../../../../adapters/prisma/research-session';
import { extractStrictQuery, jsonError, jsonSuccess, parseWithSchema } from '../_shared/http';
import { ReadModelError } from '../../../../application/read-models-v1';

export const dynamic = 'force-dynamic';

const BodySchema = z
  .object({
    kind: ResearchSessionKindSchema,
    label: z.string().min(1).max(200),
    notes: z.string().max(4000).nullable().optional(),
    config: z.unknown(),
    createdBy: z.string().min(1).max(120),
  })
  .strict();

const ListQuerySchema = z
  .object({
    kind: ResearchSessionKindSchema.optional(),
    status: ResearchSessionStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(64).optional(),
  })
  .strict();

async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ReadModelError('INVALID_BODY', 'corpo da requisição não é um JSON válido');
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = parseWithSchema(BodySchema, await parseBody(request));
    const service = createResearchSessionService(prisma);
    const session = await service.createDraft({
      kind: body.kind,
      label: body.label,
      notes: body.notes ?? null,
      config: body.config,
      createdBy: body.createdBy,
    });
    return jsonSuccess(session, {}, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const raw = extractStrictQuery(request, ['kind', 'status', 'limit', 'cursor'] as const);
    const query = parseWithSchema(ListQuerySchema, raw);
    const service = createResearchSessionService(prisma);
    const limit = query.limit ?? 20;

    const sessions = await service.list({
      ...(query.kind === undefined ? {} : { kind: query.kind }),
      ...(query.status === undefined ? {} : { status: query.status }),
      limit: limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });

    const hasNext = sessions.length > limit;
    const page = hasNext ? sessions.slice(0, limit) : sessions;
    const nextCursor = hasNext ? page[page.length - 1].sessionId : null;

    return jsonSuccess(page, { nextCursor });
  } catch (error) {
    return jsonError(error);
  }
}
```

- [ ] **Step 2: Criar a rota de item**

`src/app/api/v1/research-sessions/[id]/route.ts`:

```ts
import { z } from 'zod';
import { prisma } from '../../../../../lib/prisma';
import { createResearchSessionService } from '../../../../../application/research-session';
import { jsonError, jsonSuccess, parseWithSchema } from '../../_shared/http';
import { ReadModelError } from '../../../../../application/read-models-v1';

export const dynamic = 'force-dynamic';

const PatchSchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    notes: z.string().max(4000).nullable().optional(),
    config: z.unknown().optional(),
  })
  .strict();

async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ReadModelError('INVALID_BODY', 'corpo da requisição não é um JSON válido');
  }
}

// Next.js 15: `params` é uma Promise.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    return jsonSuccess(await createResearchSessionService(prisma).get(id));
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = parseWithSchema(PatchSchema, await parseBody(request));
    return jsonSuccess(await createResearchSessionService(prisma).updateDraft(id, body));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    await createResearchSessionService(prisma).remove(id);
    return jsonSuccess({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
```

- [ ] **Step 3: Criar as rotas de ação**

`src/app/api/v1/research-sessions/[id]/run/route.ts`:

```ts
import { prisma } from '../../../../../../lib/prisma';
import { createResearchSessionService } from '../../../../../../application/research-session';
import { jsonError, jsonSuccess } from '../../../_shared/http';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    return jsonSuccess(await createResearchSessionService(prisma).run(id));
  } catch (error) {
    return jsonError(error);
  }
}
```

`src/app/api/v1/research-sessions/[id]/cancel/route.ts` — idêntica ao arquivo acima, trocando apenas `.run(id)` por `.cancel(id)`.

- [ ] **Step 4: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erro. Se houver erro de caminho relativo, conte os níveis a partir de `src/app/api/v1/research-sessions/[id]/run/` até `src/`: são seis (`../../../../../../`).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/research-sessions
git commit -m "feat(pesquisa): rotas /api/v1/research-sessions"
```

---

### Task 7: As 12 tools MCP

**Files:**
- Create: `src/mcp/pilot/tools/research.ts`
- Modify: `src/mcp/pilot/index.ts`
- Modify: `scripts/research-session/research-session-test.ts`
- Modify: `scripts/research-session/tsconfig.json` (incluir `src/mcp/**`)

**Interfaces:**
- Consumes: `ResearchSessionService` (Task 5); `McpToolDefinition`, `parseToolArgs`, `toToolError` de `src/mcp/tools/registry-types`.
- Produces: `buildResearchTools(service: ResearchSessionService): readonly McpToolDefinition[]` — 12 definições.

- [ ] **Step 1: Incluir `src/mcp` no tsconfig do teste**

Em `scripts/research-session/tsconfig.json`, acrescentar ao array `include`:

```json
    "../../src/mcp/**/*.ts"
```

- [ ] **Step 2: Escrever os testes que falham**

Acrescentar o import no topo do arquivo de teste:

```ts
import { buildResearchTools } from '../../src/mcp/pilot/tools/research';
```

E os casos:

```ts
async function researchToolsAreRegisteredAndFree(prisma: PrismaClient): Promise<void> {
  const tools = buildResearchTools(createResearchSessionService(prisma));
  const names = tools.map((tool) => tool.name);
  assert.equal(names.length, 12, `esperava 12 tools, veio ${names.length}`);
  for (const prefix of ['significance', 'monte_carlo']) {
    for (const action of ['create_draft', 'update_draft', 'get', 'list', 'run', 'cancel']) {
      assert.ok(names.includes(`research.${prefix}.${action}`), `tool research.${prefix}.${action} faltando`);
    }
  }
  assert.ok(
    tools.every((tool) => tool.privilege === 'free'),
    'nenhuma tool de pesquisa pode ser gated: nenhuma envia ordem',
  );
  assert.ok(
    tools.every((tool) => tool.description.length > 20),
    'toda tool precisa de descrição — é o que o agente lê para decidir usá-la',
  );
  console.log('Tools: 12 registradas, todas free e descritas — OK');
}

async function researchToolRejectsInvalidArgsWithoutThrowing(prisma: PrismaClient): Promise<void> {
  const tools = buildResearchTools(createResearchSessionService(prisma));
  const get = tools.find((tool) => tool.name === 'research.significance.get');
  assert.ok(get !== undefined, 'tool get deveria existir');
  const result = await get.handler({ sessionId: 42 });
  assert.equal(result.isError, true, 'argumento inválido deve virar isError, não exceção');
  console.log('Tools: entrada inválida devolve isError em vez de lançar — OK');
}

async function researchToolNeutralizesCreatedByFromArgs(prisma: PrismaClient): Promise<void> {
  const tools = buildResearchTools(createResearchSessionService(prisma));
  const create = tools.find((tool) => tool.name === 'research.monte_carlo.create_draft');
  assert.ok(create !== undefined, 'tool create_draft deveria existir');
  const result = await create.handler({
    label: 'tentativa de forjar autoria',
    config: { trades: [], periodsPerYear: 252, startingBalance: 1000 },
    createdBy: 'alguem-mais',
  });

  // `createdBy` não está no inputSchema. O `parseToolArgs` compartilhado usa
  // `z.object(shape)` sem `.strict()`, e o modo padrão do Zod DESCARTA campo
  // desconhecido em vez de recusá-lo — então a chamada NÃO vira erro. A
  // garantia de segurança não vem da recusa: vem de o handler passar
  // `createdBy: MCP_CREATED_BY` explicitamente, ignorando o que veio nos
  // argumentos. É essa propriedade que o teste precisa provar.
  assert.notEqual(result.isError, true, 'campo extra é descartado pelo Zod, não vira erro');
  const payload = JSON.parse(result.content[0].text) as { createdBy: string };
  assert.equal(payload.createdBy, 'mcp:hermes', 'a tentativa de forjar autoria tem que ser neutralizada');
  assert.notEqual(payload.createdBy, 'alguem-mais', 'autoria jamais pode vir do argumento');
  console.log('Tools: createdBy vindo do argumento é neutralizado — OK');
}

async function researchToolCreatesWithServerFixedAuthor(prisma: PrismaClient): Promise<void> {
  const tools = buildResearchTools(createResearchSessionService(prisma));
  const create = tools.find((tool) => tool.name === 'research.monte_carlo.create_draft');
  assert.ok(create !== undefined, 'tool create_draft deveria existir');
  const result = await create.handler({
    label: 'rascunho válido',
    config: { trades: [], periodsPerYear: 252, startingBalance: 1000 },
  });
  assert.notEqual(result.isError, true, 'rascunho válido não deveria ser erro');
  const payload = JSON.parse(result.content[0].text) as { createdBy: string; status: string };
  assert.equal(payload.createdBy, 'mcp:hermes', 'autoria é fixada no servidor');
  assert.equal(payload.status, 'DRAFT', 'create_draft não roda nada');
  console.log('Tools: create_draft fixa createdBy no servidor — OK');
}
```

E registrar em `main()`, dentro do `try` do Prisma:

```ts
    await researchToolsAreRegisteredAndFree(prisma);
    await researchToolRejectsInvalidArgsWithoutThrowing(prisma);
    await researchToolNeutralizesCreatedByFromArgs(prisma);
    await researchToolCreatesWithServerFixedAuthor(prisma);
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm run test:research-session`
Expected: FALHA — `Cannot find module '../../src/mcp/pilot/tools/research'`.

- [ ] **Step 4: Implementar as tools**

`src/mcp/pilot/tools/research.ts`:

```ts
/**
 * MCP Piloto — tools `research.*`: o padrão draft→run→session portado do
 * Jesse. Camada FINA de tradução Zod -> `ResearchSessionService`; nenhuma
 * regra de negócio aqui.
 *
 * Todas `privilege: 'free'` — leitura e computação; nenhuma envia ordem.
 *
 * SEGURANÇA: `createdBy` NÃO é argumento de nenhuma tool — é fixado aqui
 * como `'mcp:hermes'`. Mesmo raciocínio do docblock de `trade.ts` sobre
 * `requestedBy`: se viesse do argumento, o agente poderia variar o valor
 * para forjar autoria.
 */
import { z } from 'zod';
import { parseToolArgs, toToolError, type McpToolDefinition, type McpToolResult } from '../../tools/registry-types';
import type { ResearchSessionService } from '../../../application/research-session';
import type { ResearchSessionKind } from '../../../domain/v1/models/research-session';

const MCP_CREATED_BY = 'mcp:hermes';

const CREATE_SHAPE = {
  label: z.string().min(1).max(200),
  notes: z.string().max(4000).nullish(),
  config: z.unknown(),
};

const UPDATE_SHAPE = {
  sessionId: z.string().min(1).max(64),
  label: z.string().min(1).max(200).optional(),
  notes: z.string().max(4000).nullish(),
  config: z.unknown().optional(),
};

const ID_SHAPE = {
  sessionId: z.string().min(1).max(64),
};

const LIST_SHAPE = {
  status: z.enum(['DRAFT', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(64).optional(),
};

const ok = (payload: unknown): McpToolResult => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
});

const KIND_DESCRIPTION: Readonly<Record<ResearchSessionKind, string>> = {
  SIGNIFICANCE:
    'teste de significância — mede se o retorno médio da barra seguinte aos sinais poderia vir do acaso, por bootstrap estacionário. Abaixo de 30 observações devolve pValue null em vez de um número. Um p-valor alto não prova que a regra é inútil: prova que esta amostra não sustenta a afirmação de que ela funciona',
  MONTE_CARLO:
    'Monte Carlo de ordem dos trades — mede quanto do drawdown observado é sorte de sequência. No motor da WR retorno total, Sharpe e win rate são invariantes à ordem e vêm em `invariants` sem percentil; só drawdown e Calmar variam, em `pathDependent`',
};

function toolsForKind(
  service: ResearchSessionService,
  kind: ResearchSessionKind,
  prefix: string,
): McpToolDefinition[] {
  return [
    {
      name: `research.${prefix}.create_draft`,
      description: `Cria um rascunho de ${KIND_DESCRIPTION[kind]}. O rascunho não roda nada — use research.${prefix}.run depois de montar a configuração.`,
      privilege: 'free',
      inputSchema: CREATE_SHAPE,
      handler: async (args) => {
        try {
          const parsed = parseToolArgs(CREATE_SHAPE, args);
          return ok(
            await service.createDraft({
              kind,
              label: parsed.label,
              notes: parsed.notes ?? null,
              config: parsed.config,
              // NUNCA vem de `args` — ver docblock do módulo.
              createdBy: MCP_CREATED_BY,
            }),
          );
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: `research.${prefix}.update_draft`,
      description: `Atualiza rótulo, notas ou configuração de um rascunho de ${prefix} ainda em DRAFT. Sessão em execução ou já concluída é recusada.`,
      privilege: 'free',
      inputSchema: UPDATE_SHAPE,
      handler: async (args) => {
        try {
          const parsed = parseToolArgs(UPDATE_SHAPE, args);
          return ok(
            await service.updateDraft(parsed.sessionId, {
              ...(parsed.label === undefined ? {} : { label: parsed.label }),
              ...(parsed.notes === undefined ? {} : { notes: parsed.notes ?? null }),
              ...(parsed.config === undefined ? {} : { config: parsed.config }),
            }),
          );
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: `research.${prefix}.get`,
      description: `Lê uma sessão de ${prefix} pelo id — status, configuração e, quando concluída, o resultado.`,
      privilege: 'free',
      inputSchema: ID_SHAPE,
      handler: async (args) => {
        try {
          return ok(await service.get(parseToolArgs(ID_SHAPE, args).sessionId));
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: `research.${prefix}.list`,
      description: `Lista sessões de ${prefix}, mais recentes primeiro, com filtro opcional por status.`,
      privilege: 'free',
      inputSchema: LIST_SHAPE,
      handler: async (args) => {
        try {
          const parsed = parseToolArgs(LIST_SHAPE, args);
          return ok(
            await service.list({
              kind,
              ...(parsed.status === undefined ? {} : { status: parsed.status }),
              limit: parsed.limit ?? 20,
              ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
            }),
          );
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: `research.${prefix}.run`,
      description: `Executa o rascunho de ${prefix} e persiste o resultado. Roda uma vez só: uma sessão já executada devolve RESEARCH_SESSION_ALREADY_RUNNING.`,
      privilege: 'free',
      inputSchema: ID_SHAPE,
      handler: async (args) => {
        try {
          return ok(await service.run(parseToolArgs(ID_SHAPE, args).sessionId));
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: `research.${prefix}.cancel`,
      description: `Cancela uma sessão de ${prefix} em DRAFT ou RUNNING. Idempotente: cancelar de novo não é erro.`,
      privilege: 'free',
      inputSchema: ID_SHAPE,
      handler: async (args) => {
        try {
          return ok(await service.cancel(parseToolArgs(ID_SHAPE, args).sessionId));
        } catch (error) {
          return toToolError(error);
        }
      },
    },
  ];
}

export function buildResearchTools(service: ResearchSessionService): readonly McpToolDefinition[] {
  return Object.freeze([
    ...toolsForKind(service, 'SIGNIFICANCE', 'significance'),
    ...toolsForKind(service, 'MONTE_CARLO', 'monte_carlo'),
  ]);
}
```

- [ ] **Step 5: Registrar no Pilot**

Em `src/mcp/pilot/index.ts`, junto aos outros imports de tools:

```ts
import { buildResearchTools } from './tools/research';
import { createResearchSessionService } from '../../application/research-session';
```

E no array `extraTools`, logo depois de `...buildTradeTools(tradeService),`:

```ts
    ...buildResearchTools(createResearchSessionService(prisma)),
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npm run test:research-session`
Expected: PASSA, com as 4 linhas novas `— OK`.

- [ ] **Step 7: Rodar a suíte MCP existente**

Run: `npm run test:mcp`
Expected: PASSA. Se houver uma asserção sobre a contagem total de tools do catálogo, atualize o número para incluir as 12 novas — e só isso; não relaxe a asserção para um `>=`.

- [ ] **Step 8: Commit**

```bash
git add src/mcp scripts/research-session
git commit -m "feat(pesquisa): 12 tools MCP research.* no padrao draft->run->session"
```

---

### Task 8: Verificação final e documentação

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/CODEX_HANDOFF.md`

**Interfaces:**
- Consumes: tudo das tasks anteriores.
- Produces: nada de código.

- [ ] **Step 1: Rodar as suítes que tocam o que foi mexido**

Run:
```bash
npm run test:research-session && npm run test:mcp && npm run test:read-models-v1 && npm run test:signal
```
Expected: todas PASSAM. Se alguma falhar, conserte antes de seguir — não documente como pronto o que não passou.

- [ ] **Step 2: Confirmar que o build de produção compila**

Run: `npm run build`
Expected: o build do Next conclui sem erro, e as 4 rotas novas aparecem na listagem de rotas.

- [ ] **Step 3: Documentar no `CLAUDE.md`**

Inserir a seção abaixo depois de "Bloco de bancos na Saúde Financeira":

~~~markdown
### Ferramentas de pesquisa estatística — portadas do Jesse (2026-09-06)

Duas capacidades que o motor de backtest da WR não tinha, portadas do framework
Jesse (MIT, `jesse 3.1.1`) e adaptadas ao que o motor da WR permite afirmar:

```
src/domain/v1/models/research-rng/            PRNG semeado (xoshiro128**) — nunca Math.random
src/domain/v1/models/rule-significance/       bootstrap estacionário + p-valor, PURO
src/domain/v1/models/monte-carlo-trades/      embaralhamento de ordem de trades, PURO
src/domain/v1/models/backtest-run/metrics.ts  computeMetrics extraída para reuso
src/application/research-session/             valida config por kind, CAS no run
src/app/api/v1/research-sessions/**           rotas
src/mcp/pilot/tools/research.ts               12 tools research.* (todas 'free')
```

- **A Fase 1 do Jesse não foi portada, de propósito.** Lá o teste de significância
  roda um backtest só-de-sinal chamando `should_long()` porque o sinal só existe
  dentro do ciclo de vida da estratégia. Na WR o sinal já é dado de primeira classe
  (`Signal`, `BacktestSignalInput`), então a saída dessa fase já existe — e com o
  `knowledgeTime` herdando a garantia point-in-time do motor (R-BT-7).
- **Piso de 30 observações** (`MIN_OBSERVATIONS`, mesmo valor do Jesse): abaixo dele
  o retorno é `pValue: null` com `insufficientData: true`, nunca um p-valor sobre
  amostra pequena demais. Mesma regra do "pilar sem dado não reprova" da Saúde
  Financeira.
- **O Monte Carlo NÃO produz intervalo de confiança para retorno.** O motor da WR é
  aditivo (`netPnl` absoluto, `lotSize` fixo), então retorno total, Sharpe, win rate
  e desvio-padrão são invariantes à ordem dos trades — só `maxDrawdown` e o Calmar
  variam. O resultado separa `invariants` (valor único, com `orderInvariant: true`)
  de `pathDependent` (percentis 5/50/95 e ICs de 90%/95%). Publicar percentis
  idênticos em três casas para o retorno pareceria informação sem ser. O Jesse varia
  o retorno porque compõe (sizing sai do saldo corrente); replicar isso exigiria
  mudar o motor para sizing proporcional — decisão de modelagem, não feita.
- **Determinismo é requisito, não conveniência:** nenhum `Math.random()` no domínio.
  Mesma seed → mesmo p-valor, sempre. Um p-valor irreprodutível não é evidência.
- **Sem UI, de propósito** — a validação estatística nasce como capacidade do agente,
  que é quem propõe trades. As 10 abas continuam sendo o critério de "terminar".
- **Nada torna o gate obrigatório ainda:** as tools existem, mas `trade.propose` não
  exige p-valor mínimo. É decisão de governança em aberto, não esquecimento.
- Testes: `npm run test:research-session`
- Spec: `docs/superpowers/specs/2026-09-06-ferramentas-pesquisa-jesse-design.md`
- Plano: `docs/superpowers/plans/2026-09-06-ferramentas-pesquisa-jesse.md`
~~~

- [ ] **Step 4: Registrar no handoff**

Acrescentar em `docs/CODEX_HANDOFF.md` uma entrada datada de 2026-09-06 com: o que foi portado; o que ficou de fora (Monte Carlo por reamostragem de candles, unificação de `ml_features()`, consolidação dos guard-rails em filtros nomeados); e a decisão em aberto — se `trade.propose` passa a exigir um p-valor mínimo antes de aceitar proposta.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/CODEX_HANDOFF.md
git commit -m "docs(pesquisa): registra as ferramentas de pesquisa portadas do Jesse"
```
