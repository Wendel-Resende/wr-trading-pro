# Ranking de Saúde Financeira — Plano de Implementação

> **Para trabalhadores agênticos:** SUB-SKILL OBRIGATÓRIA: use
> `superpowers:subagent-driven-development` ou `superpowers:executing-plans`
> para implementar tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** Nova aba que ranqueia 117 empresas da B3 pela consistência de
cinco pilares de saúde financeira ao longo de até 60 trimestres da CVM.

**Arquitetura:** Leitura direta de `data/cvm/cvm_fundamentos.db` com
`node:sqlite` read-only, cálculo em TypeScript, seguindo `cvm-sector-ranking.ts`.
Regras puras (limiares e agregação) isoladas do acesso a dados para serem
testáveis sem banco. Sem Prisma, sem Python, sem ML Engine.

**Stack:** Next.js 15 (App Router, `runtime = 'nodejs'`), `node:sqlite`
(builtin), React 19, Tailwind, tsx para os testes.

**Spec:** `docs/superpowers/specs/2026-08-12-ranking-saude-financeira-design.md`

## Restrições Globais

- **Nunca escreve no banco.** `new DatabaseSync(file, { readOnly: true })`.
- **Dado ausente nunca vira zero nem reprovação.** Pilar sem dado não conta.
- **Legenda obrigatória e fixa na tela:** "Consistência financeira histórica.
  Não é previsão de retorno nem recomendação de compra."
- **Exclusões aparecem na tela com a razão**, nunca por omissão silenciosa.
- **Escala:** cada pilar lê de uma tabela só. `endividamento` (percentual
  0–100) não é usado.
- **Sem alteração** em tabelas, migrations, modelos Prisma, na aba Ranking
  Fundamentalista, ou em qualquer tool MCP.
- **Não commitar sem o usuário pedir** (`AGENTS.md`). Os passos de commit ficam
  como marcação de fim de tarefa; a execução do `git commit` depende de pedido.
- Comentários e identificadores de domínio em português, como o resto do repo.

---

### Task 1: Regras puras — pilares e agregação

**Arquivos:**
- Criar: `src/lib/server/cvm-financial-health-rules.ts`
- Criar: `scripts/financial-health/financial-health-test.ts`
- Criar: `scripts/financial-health/run-financial-health-tests.cjs`
- Modificar: `package.json` (adicionar script `test:financial-health`)

**Interfaces:**
- Consome: nada.
- Produz:
  - `type PillarKey = 'alavancagem' | 'liquidez' | 'juros' | 'lucro' | 'caixa'`
  - `const PILLAR_KEYS: readonly PillarKey[]`
  - `const HEALTH_THRESHOLDS: { maxDividaBrutaPl: 1; minLiquidezCorrente: 1; minIcj: 2 }`
  - `const MIN_QUARTERS = 20`, `const RECENT_QUARTERS = 8`
  - `interface QuarterInput`, `interface QuarterResult`, `interface CompanyHealth`
  - `function evaluateQuarter(q: QuarterInput): QuarterResult`
  - `function scoreCompany(base, quarters): CompanyHealth | null`
  - `function rankCompanies(rows: CompanyHealth[]): CompanyHealth[]`

- [ ] **Passo 1: Escrever o módulo de regras**

Criar `src/lib/server/cvm-financial-health-rules.ts`:

```ts
/**
 * Ranking de Saúde Financeira — REGRAS PURAS (sem I/O).
 *
 * Avalia cinco pilares por trimestre e agrega a consistência histórica.
 * Não lê banco, não faz rede: é o único ponto onde os limiares e a agregação
 * vivem, e é puro justamente para que um sinal invertido apareça no teste em
 * vez de virar um ranking plausível e falso.
 *
 * Spec: docs/superpowers/specs/2026-08-12-ranking-saude-financeira-design.md
 */

export type PillarKey = 'alavancagem' | 'liquidez' | 'juros' | 'lucro' | 'caixa';

export const PILLAR_KEYS: readonly PillarKey[] = Object.freeze([
  'alavancagem', 'liquidez', 'juros', 'lucro', 'caixa',
]);

export const PILLAR_LABELS: Readonly<Record<PillarKey, string>> = Object.freeze({
  alavancagem: 'Alavancagem',
  liquidez: 'Liquidez',
  juros: 'Juros',
  lucro: 'Lucro',
  caixa: 'Caixa',
});

/**
 * Limiares calibrados contra a distribuição real do banco (ver spec):
 * liquidez >= 1 aprova ~78% dos trimestres, divida_bruta_pl <= 1 aprova ~72%,
 * icj >= 2 aprova ~50% (a mediana do mercado é 2,09).
 */
export const HEALTH_THRESHOLDS = Object.freeze({
  maxDividaBrutaPl: 1.0,
  minLiquidezCorrente: 1.0,
  minIcj: 2.0,
});

/** Piso de história: sem isso, "100% saudável" em 11 trimestres seria barato. */
export const MIN_QUARTERS = 20;

/** Janela recente — denuncia a empresa que era boa e piorou. */
export const RECENT_QUARTERS = 8;

export interface QuarterInput {
  readonly ano: number;
  readonly trimestre: number;
  /** Carimbo de conhecimento (prazo legal), ISO YYYY-MM-DD. */
  readonly knowledgeDate: string;
  readonly dividaBrutaPl: number | null;
  readonly liquidezCorrente: number | null;
  readonly icj: number | null;
  readonly lucroLiquido: number | null;
  readonly fco: number | null;
}

export interface QuarterResult {
  readonly ano: number;
  readonly trimestre: number;
  readonly knowledgeDate: string;
  /** `null` = pilar sem dado: não aprova e NÃO reprova. */
  readonly pillars: Readonly<Record<PillarKey, boolean | null>>;
  readonly medidos: number;
  readonly aprovados: number;
  /** aprovados/medidos, ou `null` quando nada foi medido. */
  readonly nota: number | null;
}

export interface CompanyBase {
  readonly cdCvm: string;
  readonly ticker: string;
  readonly nome: string;
  readonly setorCvm: string | null;
}

export interface PillarRate {
  readonly aprovados: number;
  readonly medidos: number;
  /** `null` quando o pilar nunca teve dado. */
  readonly taxa: number | null;
}

export interface CompanyHealth extends CompanyBase {
  /** Média das notas trimestrais, em [0,1]. */
  readonly score: number;
  /** Trimestres com ao menos um pilar medido. */
  readonly trimestres: number;
  readonly pilares: Readonly<Record<PillarKey, PillarRate>>;
  /** Janela recente, SEMPRE separada do score histórico. */
  readonly recente: { readonly score: number | null; readonly trimestres: number };
}

const finito = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * Avalia um trimestre. Cada pilar vira `true`, `false` ou `null` (sem dado).
 * `null` jamais conta como reprovação: fingir doença por dado ausente seria o
 * mesmo defeito de exibir zero como cotação.
 */
export function evaluateQuarter(q: QuarterInput): QuarterResult {
  const t = HEALTH_THRESHOLDS;
  const pillars: Record<PillarKey, boolean | null> = {
    alavancagem: finito(q.dividaBrutaPl) ? q.dividaBrutaPl <= t.maxDividaBrutaPl : null,
    liquidez: finito(q.liquidezCorrente) ? q.liquidezCorrente >= t.minLiquidezCorrente : null,
    juros: finito(q.icj) ? q.icj >= t.minIcj : null,
    lucro: finito(q.lucroLiquido) ? q.lucroLiquido > 0 : null,
    caixa: finito(q.fco) ? q.fco > 0 : null,
  };
  let medidos = 0;
  let aprovados = 0;
  for (const k of PILLAR_KEYS) {
    const v = pillars[k];
    if (v === null) continue;
    medidos += 1;
    if (v) aprovados += 1;
  }
  return {
    ano: q.ano,
    trimestre: q.trimestre,
    knowledgeDate: q.knowledgeDate,
    pillars: Object.freeze(pillars),
    medidos,
    aprovados,
    nota: medidos > 0 ? aprovados / medidos : null,
  };
}

/**
 * Agrega a história de uma empresa. Devolve `null` quando ela não atinge o
 * piso de trimestres MEDIDOS — quem não pode ser avaliada não entra no
 * ranking, e é listada à parte pelo chamador.
 *
 * `quarters` deve vir ordenado por período crescente; a janela recente usa a
 * cauda da lista.
 */
export function scoreCompany(
  base: CompanyBase,
  quarters: readonly QuarterInput[],
): CompanyHealth | null {
  const avaliados = quarters.map(evaluateQuarter).filter((r) => r.nota !== null);
  if (avaliados.length < MIN_QUARTERS) return null;

  const score = avaliados.reduce((acc, r) => acc + (r.nota as number), 0) / avaliados.length;

  const pilares = {} as Record<PillarKey, PillarRate>;
  for (const k of PILLAR_KEYS) {
    let medidos = 0;
    let aprovados = 0;
    for (const r of avaliados) {
      const v = r.pillars[k];
      if (v === null) continue;
      medidos += 1;
      if (v) aprovados += 1;
    }
    pilares[k] = { aprovados, medidos, taxa: medidos > 0 ? aprovados / medidos : null };
  }

  const cauda = avaliados.slice(-RECENT_QUARTERS);
  const recente = {
    score: cauda.length > 0
      ? cauda.reduce((acc, r) => acc + (r.nota as number), 0) / cauda.length
      : null,
    trimestres: cauda.length,
  };

  return {
    ...base,
    score,
    trimestres: avaliados.length,
    pilares: Object.freeze(pilares),
    recente,
  };
}

/**
 * Ordenação determinística: escore desc, mais trimestres primeiro (mais
 * evidência ganha), depois ticker. Sem isso, duas cargas da mesma aba
 * poderiam mostrar listas diferentes.
 */
export function rankCompanies(rows: readonly CompanyHealth[]): CompanyHealth[] {
  return [...rows].sort(
    (a, b) =>
      b.score - a.score ||
      b.trimestres - a.trimestres ||
      a.ticker.localeCompare(b.ticker),
  );
}
```

- [ ] **Passo 2: Escrever os testes das regras**

Criar `scripts/financial-health/financial-health-test.ts`:

```ts
import assert from 'node:assert/strict';
import {
  evaluateQuarter, scoreCompany, rankCompanies,
  HEALTH_THRESHOLDS, MIN_QUARTERS, RECENT_QUARTERS, PILLAR_KEYS,
  type QuarterInput, type CompanyBase, type CompanyHealth,
} from '../../src/lib/server/cvm-financial-health-rules';

function assertLog(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  console.log(`ok: ${msg}`);
}

const BASE: CompanyBase = { cdCvm: '000001', ticker: 'TEST3', nome: 'Teste S.A.', setorCvm: 'Alimentos' };

function q(over: Partial<QuarterInput> = {}, i = 1): QuarterInput {
  return {
    ano: 2020, trimestre: ((i - 1) % 4) + 1, knowledgeDate: '2020-05-15',
    dividaBrutaPl: 0.5, liquidezCorrente: 2, icj: 5, lucroLiquido: 100, fco: 100,
    ...over,
  };
}

function serie(n: number, over: Partial<QuarterInput> = {}): QuarterInput[] {
  return Array.from({ length: n }, (_, i) => q(over, i + 1));
}

function main(): void {
  // --- limiares na fronteira ---
  assertLog(evaluateQuarter(q({ liquidezCorrente: 1.0 })).pillars.liquidez === true, 'liquidez 1,00 aprova');
  assertLog(evaluateQuarter(q({ liquidezCorrente: 0.99 })).pillars.liquidez === false, 'liquidez 0,99 reprova');
  assertLog(evaluateQuarter(q({ dividaBrutaPl: 1.0 })).pillars.alavancagem === true, 'dívida/PL 1,00 aprova');
  assertLog(evaluateQuarter(q({ dividaBrutaPl: 1.01 })).pillars.alavancagem === false, 'dívida/PL 1,01 reprova');
  assertLog(evaluateQuarter(q({ icj: 2.0 })).pillars.juros === true, 'icj 2,00 aprova');
  assertLog(evaluateQuarter(q({ icj: 1.99 })).pillars.juros === false, 'icj 1,99 reprova');
  assertLog(evaluateQuarter(q({ lucroLiquido: 0 })).pillars.lucro === false, 'lucro 0 reprova');
  assertLog(evaluateQuarter(q({ lucroLiquido: 0.01 })).pillars.lucro === true, 'lucro 0,01 aprova');
  assertLog(evaluateQuarter(q({ fco: 0 })).pillars.caixa === false, 'FCO 0 reprova');
  assertLog(evaluateQuarter(q({ fco: 0.01 })).pillars.caixa === true, 'FCO 0,01 aprova');
  assertLog(HEALTH_THRESHOLDS.minIcj === 2 && HEALTH_THRESHOLDS.maxDividaBrutaPl === 1, 'limiares da spec preservados');

  // --- dado ausente não aprova nem reprova ---
  const semIcj = evaluateQuarter(q({ icj: null }));
  assertLog(semIcj.pillars.juros === null, 'pilar sem dado fica null');
  assertLog(semIcj.medidos === 4 && semIcj.aprovados === 4, 'trimestre conta só os pilares medidos');
  assertLog(semIcj.nota === 1, '4 de 4 medidos vale 1,0 — não 0,8');
  const naN = evaluateQuarter(q({ icj: Number.NaN }));
  assertLog(naN.pillars.juros === null, 'NaN é tratado como dado ausente');

  // --- trimestre sem nenhum pilar medido é descartado ---
  const vazio = evaluateQuarter(q({
    dividaBrutaPl: null, liquidezCorrente: null, icj: null, lucroLiquido: null, fco: null,
  }));
  assertLog(vazio.medidos === 0 && vazio.nota === null, 'trimestre sem dado tem nota null, nunca 0');
  const comVazios = scoreCompany(BASE, [...serie(MIN_QUARTERS), ...serie(5, {
    dividaBrutaPl: null, liquidezCorrente: null, icj: null, lucroLiquido: null, fco: null,
  })]);
  assertLog(comVazios !== null && comVazios.trimestres === MIN_QUARTERS, 'trimestres sem dado não entram na contagem');
  assertLog(comVazios !== null && comVazios.score === 1, 'trimestres sem dado não puxam o escore para baixo');

  // --- piso de história ---
  assertLog(scoreCompany(BASE, serie(MIN_QUARTERS - 1)) === null, `${MIN_QUARTERS - 1} trimestres: fora do ranking`);
  assertLog(scoreCompany(BASE, serie(MIN_QUARTERS)) !== null, `${MIN_QUARTERS} trimestres: entra`);

  // --- escore e taxas por pilar ---
  const metade = scoreCompany(BASE, [...serie(10), ...serie(10, { icj: 0 })]);
  assertLog(metade !== null && Math.abs(metade.score - 0.9) < 1e-9, '10 trimestres perfeitos + 10 com 4/5 → escore 0,9');
  assertLog(metade !== null && metade.pilares.juros.taxa === 0.5, 'taxa do pilar juros = 50%');
  assertLog(metade !== null && metade.pilares.lucro.taxa === 1, 'taxa do pilar lucro = 100%');
  assertLog(metade !== null && PILLAR_KEYS.every((k) => metade.pilares[k].medidos === 20), 'todos os pilares medidos em 20 trimestres');

  // --- janela recente separada do histórico ---
  const piorou = scoreCompany(BASE, [...serie(20), ...serie(RECENT_QUARTERS, { icj: 0, lucroLiquido: -1 })]);
  assertLog(piorou !== null && piorou.recente.trimestres === RECENT_QUARTERS, 'janela recente usa os últimos 8');
  assertLog(piorou !== null && piorou.recente.score === 0.6, 'recente = 3/5 aprovados = 0,6');
  assertLog(piorou !== null && piorou.score > (piorou.recente.score as number), 'histórico alto convive com recente baixo');
  const curta = scoreCompany(BASE, serie(MIN_QUARTERS));
  assertLog(curta !== null && curta.recente.trimestres === RECENT_QUARTERS, 'empresa no piso ainda tem 8 recentes');

  // --- ordenação determinística ---
  const mk = (ticker: string, score: number, trimestres: number): CompanyHealth => ({
    ...BASE, ticker, score, trimestres,
    pilares: { alavancagem: { aprovados: 0, medidos: 0, taxa: null }, liquidez: { aprovados: 0, medidos: 0, taxa: null }, juros: { aprovados: 0, medidos: 0, taxa: null }, lucro: { aprovados: 0, medidos: 0, taxa: null }, caixa: { aprovados: 0, medidos: 0, taxa: null } },
    recente: { score: null, trimestres: 0 },
  });
  const ord = rankCompanies([mk('BBB3', 0.5, 60), mk('AAA3', 0.9, 30), mk('CCC3', 0.9, 60), mk('AAA4', 0.9, 30)]);
  assertLog(ord.map((r) => r.ticker).join(',') === 'CCC3,AAA3,AAA4,BBB3', 'ordem: escore desc, trimestres desc, ticker asc');

  console.log('saúde financeira (regras): TODOS OS TESTES PASSARAM');
}
main();
```

- [ ] **Passo 3: Criar o runner e registrar o script**

Criar `scripts/financial-health/run-financial-health-tests.cjs` (cópia exata do
padrão de `scripts/cvm-fundamentals/run-cvm-fundamentals-tests.cjs`):

```js
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const r = spawnSync(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'scripts/financial-health/financial-health-test.ts'],
  { cwd: root, stdio: 'inherit' },
);
if (r.error) {
  console.error(r.error);
  process.exitCode = 1;
} else {
  process.exitCode = r.status ?? 1;
}
```

Em `package.json`, junto dos demais `test:*`:

```json
"test:financial-health": "node scripts/financial-health/run-financial-health-tests.cjs",
```

- [ ] **Passo 4: Rodar os testes**

Executar: `npm run test:financial-health`
Esperado: todas as linhas `ok:` e `saúde financeira (regras): TODOS OS TESTES PASSARAM`.

- [ ] **Passo 5: Fim da tarefa**

```bash
git add src/lib/server/cvm-financial-health-rules.ts scripts/financial-health package.json
# commit somente se o usuário pedir
```

---

### Task 2: Leitura do banco CVM — point-in-time e exclusões

**Arquivos:**
- Criar: `src/lib/server/cvm-financial-health.ts`
- Modificar: `scripts/financial-health/financial-health-test.ts` (prova de fumaça)

**Interfaces:**
- Consome de Task 1: `scoreCompany`, `rankCompanies`, `MIN_QUARTERS`,
  `type CompanyHealth`, `type QuarterInput`, `type CompanyBase`.
- Consome do repo: `knowledgeDateFor`, `LEGAL_LAG_RULE` de
  `./cvm-fundamentals-derive`; `CVM_LEGACY_PROVENANCE` de `./cvm-legacy-db`.
- Produz: `function financialHealthRanking(asOf?: string): FinancialHealthResult`
  e `const FINANCIAL_SECTOR_BUCKETS: readonly string[]`.

- [ ] **Passo 1: Escrever o módulo de leitura**

Criar `src/lib/server/cvm-financial-health.ts`:

```ts
/**
 * Ranking de Saúde Financeira — leitura read-only sobre `cvm_fundamentos.db`.
 *
 * Mesmo padrão de acesso de `cvm-sector-ranking.ts`. Aplica point-in-time
 * (carimbo de conhecimento por prazo legal), remove o setor financeiro e
 * delega TODO o julgamento a `cvm-financial-health-rules.ts`, que é puro.
 *
 * Spec: docs/superpowers/specs/2026-08-12-ranking-saude-financeira-design.md
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { knowledgeDateFor, LEGAL_LAG_RULE } from './cvm-fundamentals-derive';
import { CVM_LEGACY_PROVENANCE } from './cvm-legacy-db';
import {
  scoreCompany, rankCompanies, MIN_QUARTERS, RECENT_QUARTERS, HEALTH_THRESHOLDS,
  type CompanyHealth, type QuarterInput, type CompanyBase,
} from './cvm-financial-health-rules';

/**
 * Buckets de `empresas.setor_cvm` (classificação oficial da CVM) do setor
 * financeiro. Usa setor_cvm, NUNCA o campo `setor` de texto livre.
 *
 * Por que excluir: num banco o passivo circulante É o depósito do cliente,
 * alavancagem alta é o modelo de negócio, e `icj` mede cobertura de juros de
 * quem toma emprestado. A régua da indústria faria ITUB4 parecer doente.
 */
export const FINANCIAL_SECTOR_BUCKETS: readonly string[] = Object.freeze([
  'Bancos',
  'Seguradoras e Corretoras',
  'Emp. Adm. Part. - Seguradoras e Corretoras',
  'Emp. Adm. Part. - Intermediação Financeira',
  'Bolsas de Valores/Mercadorias e Futuros',
]);

let db: DatabaseSync | null = null;
function getDb(): DatabaseSync {
  if (db) return db;
  const file = path.join(process.cwd(), 'data', 'cvm', 'cvm_fundamentos.db');
  if (!existsSync(file)) throw new Error(`Banco de fundamentos CVM não encontrado em ${file}.`);
  db = new DatabaseSync(file, { readOnly: true });
  return db;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export interface ExcludedCompany {
  readonly ticker: string;
  readonly nome: string;
  readonly motivo: 'SETOR_FINANCEIRO' | 'HISTORICO_INSUFICIENTE';
  readonly detalhe: string;
}

export interface FinancialHealthResult {
  readonly geradoEm: string;
  readonly asOf: string;
  readonly universo: {
    readonly total: number;
    readonly ranqueadas: number;
    readonly excluidas: readonly ExcludedCompany[];
  };
  readonly criterios: {
    readonly limiares: typeof HEALTH_THRESHOLDS;
    readonly minTrimestres: number;
    readonly janelaRecente: number;
    readonly regraPrazoLegal: string;
  };
  readonly proveniencia: typeof CVM_LEGACY_PROVENANCE;
  readonly rows: readonly CompanyHealth[];
}

/**
 * `fundamental_indicators` é a espinha da consulta (traz alavancagem e juros);
 * as demais tabelas entram por LEFT JOIN. Trimestre que só existe em `dre`/`dfc`
 * fica de fora — limitação conhecida e sem efeito prático: a espinha tem 6.955
 * linhas contra 7.096 da `dre`.
 */
const QUERY = `
  SELECT e.cd_cvm AS cdCvm, e.ticker, e.nome, e.setor_cvm AS setorCvm,
         fi.ano, fi.trimestre, fi.data_ref AS dataRef,
         fi.divida_bruta_pl AS dividaBrutaPl, fi.icj,
         i.liquidez_corrente AS liquidezCorrente,
         d.lucro_liquido AS lucroLiquido,
         f.fco
    FROM empresas e
    JOIN fundamental_indicators fi ON fi.cd_cvm = e.cd_cvm
    LEFT JOIN indicadores i     ON i.cd_cvm = e.cd_cvm AND i.ano = fi.ano AND i.trimestre = fi.trimestre
    LEFT JOIN dre_trimestral d  ON d.cd_cvm = e.cd_cvm AND d.ano = fi.ano AND d.trimestre = fi.trimestre
    LEFT JOIN dfc_trimestral f  ON f.cd_cvm = e.cd_cvm AND f.ano = fi.ano AND f.trimestre = fi.trimestre
   WHERE e.ticker IS NOT NULL AND e.ticker <> ''
   ORDER BY e.ticker, fi.ano, fi.trimestre
`;

/**
 * Monta o ranking completo. `asOf` (YYYY-MM-DD) permite reproduzir o estado do
 * conhecimento numa data passada; o padrão é hoje.
 */
export function financialHealthRanking(asOf?: string): FinancialHealthResult {
  const corte = asOf ?? new Date().toISOString().slice(0, 10);
  const rows = getDb().prepare(QUERY).all() as Record<string, unknown>[];

  const bases = new Map<string, CompanyBase>();
  const quarters = new Map<string, QuarterInput[]>();

  for (const r of rows) {
    const ticker = str(r.ticker);
    if (!ticker) continue;
    if (!bases.has(ticker)) {
      bases.set(ticker, {
        cdCvm: String(r.cdCvm),
        ticker,
        nome: str(r.nome) ?? ticker,
        setorCvm: str(r.setorCvm),
      });
      quarters.set(ticker, []);
    }
    const ano = Number(r.ano);
    const trimestre = Number(r.trimestre);
    if (!Number.isInteger(ano) || !Number.isInteger(trimestre)) continue;
    // Point-in-time: período só entra se o prazo legal de publicação já venceu.
    const { iso } = knowledgeDateFor(str(r.dataRef), ano, trimestre);
    if (iso > corte) continue;
    quarters.get(ticker)!.push({
      ano, trimestre, knowledgeDate: iso,
      dividaBrutaPl: num(r.dividaBrutaPl),
      liquidezCorrente: num(r.liquidezCorrente),
      icj: num(r.icj),
      lucroLiquido: num(r.lucroLiquido),
      fco: num(r.fco),
    });
  }

  const ranqueadas: CompanyHealth[] = [];
  const excluidas: ExcludedCompany[] = [];

  for (const [ticker, base] of bases) {
    if (base.setorCvm !== null && FINANCIAL_SECTOR_BUCKETS.includes(base.setorCvm)) {
      excluidas.push({
        ticker, nome: base.nome, motivo: 'SETOR_FINANCEIRO',
        detalhe: `${base.setorCvm} — critérios de liquidez e alavancagem não têm o mesmo significado no setor`,
      });
      continue;
    }
    const health = scoreCompany(base, quarters.get(ticker)!);
    if (health === null) {
      const n = quarters.get(ticker)!.length;
      excluidas.push({
        ticker, nome: base.nome, motivo: 'HISTORICO_INSUFICIENTE',
        detalhe: `${n} trimestre(s) publicado(s); mínimo de ${MIN_QUARTERS}`,
      });
      continue;
    }
    ranqueadas.push(health);
  }

  excluidas.sort((a, b) => a.motivo.localeCompare(b.motivo) || a.ticker.localeCompare(b.ticker));

  return {
    geradoEm: new Date().toISOString(),
    asOf: corte,
    universo: { total: bases.size, ranqueadas: ranqueadas.length, excluidas },
    criterios: {
      limiares: HEALTH_THRESHOLDS,
      minTrimestres: MIN_QUARTERS,
      janelaRecente: RECENT_QUARTERS,
      regraPrazoLegal: LEGAL_LAG_RULE,
    },
    proveniencia: CVM_LEGACY_PROVENANCE,
    rows: rankCompanies(ranqueadas),
  };
}
```

- [ ] **Passo 2: Acrescentar a prova de fumaça sobre o banco real**

Em `scripts/financial-health/financial-health-test.ts`, trocar o import inicial
por um que também traga o módulo de leitura, tornar `main` assíncrona e inserir
o bloco abaixo antes da linha final de `console.log`:

```ts
import { existsSync } from 'node:fs';
import path from 'node:path';
import { financialHealthRanking, FINANCIAL_SECTOR_BUCKETS } from '../../src/lib/server/cvm-financial-health';

// ... dentro de main(), após os testes puros:
const dbFile = path.join(process.cwd(), 'data', 'cvm', 'cvm_fundamentos.db');
if (existsSync(dbFile)) {
  const rk = financialHealthRanking();
  assertLog(rk.rows.length > 0, `ranking real devolve ${rk.rows.length} empresas`);
  assertLog(
    rk.rows.every((r) => r.setorCvm === null || !FINANCIAL_SECTOR_BUCKETS.includes(r.setorCvm)),
    'nenhum ticker de bucket financeiro no ranking',
  );
  assertLog(
    rk.universo.ranqueadas + rk.universo.excluidas.length === rk.universo.total,
    'ranqueadas + excluídas = universo',
  );
  assertLog(rk.rows.every((r) => r.score >= 0 && r.score <= 1), 'todo escore dentro de [0,1]');
  assertLog(rk.rows.every((r) => r.trimestres >= MIN_QUARTERS), 'toda empresa ranqueada atinge o piso de história');
  assertLog(
    rk.universo.excluidas.filter((e) => e.motivo === 'SETOR_FINANCEIRO').length === 18,
    '18 empresas excluídas pelo setor financeiro',
  );
  const semFuturo = rk.rows.every((r) => r.recente.trimestres <= RECENT_QUARTERS);
  assertLog(semFuturo, 'janela recente nunca excede 8 trimestres');
  // as-of antigo enxerga menos história que hoje
  const passado = financialHealthRanking('2018-01-01');
  assertLog(passado.rows.length <= rk.rows.length, 'as-of de 2018 ranqueia no máximo o que hoje ranqueia');
  console.log(`   universo ${rk.universo.total} · ranqueadas ${rk.universo.ranqueadas} · excluídas ${rk.universo.excluidas.length}`);
} else {
  console.log('ok: prova de fumaça pulada (banco CVM ausente no ambiente)');
}
```

- [ ] **Passo 3: Rodar os testes**

Executar: `npm run test:financial-health`
Esperado: os testes puros continuam verdes e a prova de fumaça imprime o
universo com 18 excluídas por setor.

- [ ] **Passo 4: Fim da tarefa**

```bash
git add src/lib/server/cvm-financial-health.ts scripts/financial-health/financial-health-test.ts
# commit somente se o usuário pedir
```

---

### Task 3: Rota da API

**Arquivos:**
- Criar: `src/app/api/cvm/financial-health/route.ts`

**Interfaces:**
- Consome de Task 2: `financialHealthRanking(asOf?)`.
- Produz: `GET /api/cvm/financial-health[?asOf=YYYY-MM-DD]` → `FinancialHealthResult`.

- [ ] **Passo 1: Escrever a rota**

Criar `src/app/api/cvm/financial-health/route.ts`, seguindo
`src/app/api/cvm/sector-ranking/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { financialHealthRanking } from '@/lib/server/cvm-financial-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const asOfRaw = searchParams.get('asOf');
    let asOf: string | undefined;
    if (asOfRaw !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) || Number.isNaN(Date.parse(asOfRaw))) {
        return NextResponse.json({ error: 'Parâmetro "asOf" inválido (YYYY-MM-DD).' }, { status: 400 });
      }
      asOf = asOfRaw;
    }
    return NextResponse.json(financialHealthRanking(asOf));
  } catch (error) {
    console.error('[api/cvm/financial-health]', error);
    return NextResponse.json(
      { error: 'Não foi possível montar o ranking de saúde financeira.' },
      { status: 500 },
    );
  }
}
```

- [ ] **Passo 2: Verificar a compilação**

Executar: `npx tsc --noEmit`
Esperado: sem erros.

- [ ] **Passo 3: Fim da tarefa**

```bash
git add src/app/api/cvm/financial-health/route.ts
# commit somente se o usuário pedir
```

---

### Task 4: Interface — aba, tabela e painel de exclusões

**Arquivos:**
- Criar: `src/components/saude/types.ts`
- Criar: `src/components/saude/SaudeTable.tsx`
- Criar: `src/components/saude/ExclusoesPanel.tsx`
- Criar: `src/components/saude/SaudeFinanceiraView.tsx`
- Criar: `src/components/tabs/SaudeFinanceiraTab.tsx`
- Modificar: `src/app/page.tsx`

**Interfaces:**
- Consome de Task 3: `GET /api/cvm/financial-health`.
- Produz: aba `saude` no `page.tsx`.

- [ ] **Passo 1: Contratos e utilitários da UI**

Criar `src/components/saude/types.ts` (espelha o DTO da rota; nada de tipos
importados do servidor, mesma disciplina de `src/components/ranking/types.ts`):

```ts
/**
 * Ranking de Saúde Financeira — contratos da UI.
 * Espelham `GET /api/cvm/financial-health`.
 */

export type PillarKey = 'alavancagem' | 'liquidez' | 'juros' | 'lucro' | 'caixa';

export const PILLAR_ORDER: readonly PillarKey[] = ['alavancagem', 'liquidez', 'juros', 'lucro', 'caixa'];

export const PILLAR_LABELS: Readonly<Record<PillarKey, string>> = {
  alavancagem: 'Alavancagem',
  liquidez: 'Liquidez',
  juros: 'Juros',
  lucro: 'Lucro',
  caixa: 'Caixa',
};

export interface PillarRate {
  readonly aprovados: number;
  readonly medidos: number;
  readonly taxa: number | null;
}

export interface HealthRow {
  readonly cdCvm: string;
  readonly ticker: string;
  readonly nome: string;
  readonly setorCvm: string | null;
  readonly score: number;
  readonly trimestres: number;
  readonly pilares: Readonly<Record<PillarKey, PillarRate>>;
  readonly recente: { readonly score: number | null; readonly trimestres: number };
}

export interface ExcludedCompany {
  readonly ticker: string;
  readonly nome: string;
  readonly motivo: 'SETOR_FINANCEIRO' | 'HISTORICO_INSUFICIENTE';
  readonly detalhe: string;
}

export interface HealthResponse {
  readonly geradoEm: string;
  readonly asOf: string;
  readonly universo: {
    readonly total: number;
    readonly ranqueadas: number;
    readonly excluidas: readonly ExcludedCompany[];
  };
  readonly criterios: {
    readonly limiares: { readonly maxDividaBrutaPl: number; readonly minLiquidezCorrente: number; readonly minIcj: number };
    readonly minTrimestres: number;
    readonly janelaRecente: number;
    readonly regraPrazoLegal: string;
  };
  readonly rows: readonly HealthRow[];
}

/** Percentual legível; `null` vira travessão, nunca 0%. */
export const pct = (v: number | null | undefined, casas = 0): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(casas)}%`;

/**
 * Divergência relevante entre histórico e recente: a empresa que era boa e
 * piorou. 15 p.p. é o corte para exibir o alerta.
 */
export const DECLINIO_PP = 0.15;

export const emDeclinio = (r: HealthRow): boolean =>
  r.recente.score !== null && r.score - r.recente.score >= DECLINIO_PP;

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}
```

- [ ] **Passo 2: Tabela**

Criar `src/components/saude/SaudeTable.tsx`:

```tsx
'use client';

import React from 'react';
import { pct, emDeclinio, PILLAR_ORDER, PILLAR_LABELS, type HealthRow } from './types';

/**
 * Lista do ranking. Componente puro: recebe tudo por props, não faz rede.
 *
 * Os cinco pilares aparecem ABERTOS, com a taxa de cada um — é o que torna
 * cada linha auditável contra o balanço da empresa. A coluna "Recente" fica
 * SEMPRE separada do escore histórico: a divergência entre as duas é a
 * informação, e fundi-las num peso único a destruiria.
 */

interface Props {
  readonly rows: readonly HealthRow[];
  readonly loading: boolean;
  readonly emptyMessage: string;
}

function barra(v: number | null): React.ReactElement {
  const w = v === null || !Number.isFinite(v) ? 0 : Math.max(0, Math.min(100, v * 100));
  return (
    <span className="w-16 h-1.5 bg-gray-800 rounded overflow-hidden hidden sm:block">
      <span className="block h-full bg-cyber-cyan" style={{ width: `${w}%` }} />
    </span>
  );
}

export default function SaudeTable({ rows, loading, emptyMessage }: Props): React.ReactElement {
  if (loading) return <p className="text-xs text-gray-500">Carregando ranking…</p>;
  if (rows.length === 0) return <p className="text-xs text-gray-500">{emptyMessage}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800">
            <th className="text-left py-2 px-2">#</th>
            <th className="text-left py-2 px-2">Ticker</th>
            <th className="text-right py-2 px-2">Escore histórico</th>
            <th className="text-right py-2 px-2">Recente</th>
            <th className="text-right py-2 px-2">Trimestres</th>
            {PILLAR_ORDER.map((k) => (
              <th key={k} className="text-right py-2 px-2">{PILLAR_LABELS[k]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.ticker} className="border-b border-gray-900 hover:bg-gray-900/40">
              <td className="py-2 px-2 text-gray-600 tabular-nums">{i + 1}</td>
              <td className="py-2 px-2">
                <span className="font-mono text-gray-200">{r.ticker}</span>
                <span className="block text-[10px] text-gray-600 truncate max-w-[16rem]">{r.nome}</span>
              </td>
              <td className="py-2 px-2">
                <div className="flex items-center justify-end gap-2">
                  <span className="font-mono text-gray-200 tabular-nums">{r.score.toFixed(2)}</span>
                  {barra(r.score)}
                </div>
              </td>
              <td className="py-2 px-2 text-right font-mono tabular-nums">
                <span className={emDeclinio(r) ? 'text-amber-400' : 'text-gray-400'}>
                  {r.recente.score === null ? '—' : r.recente.score.toFixed(2)}
                  {emDeclinio(r) ? ' ⚠' : ''}
                </span>
                <span className="block text-[10px] text-gray-600">{r.recente.trimestres} tri</span>
              </td>
              <td className="py-2 px-2 text-right font-mono text-gray-400 tabular-nums">{r.trimestres}</td>
              {PILLAR_ORDER.map((k) => (
                <td key={k} className="py-2 px-2 text-right font-mono text-gray-400 tabular-nums">
                  {pct(r.pilares[k].taxa)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Passo 3: Painel de exclusões**

Criar `src/components/saude/ExclusoesPanel.tsx`:

```tsx
'use client';

import React from 'react';
import type { ExcludedCompany } from './types';

/**
 * Quem ficou de fora, e por quê. Existe para que a exclusão nunca seja uma
 * omissão silenciosa: cinco dos papéis excluídos por setor estão na watchlist
 * do usuário, e sumir com eles sem explicação seria mentir por ausência.
 */

interface Props {
  readonly excluidas: readonly ExcludedCompany[];
}

export default function ExclusoesPanel({ excluidas }: Props): React.ReactElement | null {
  if (excluidas.length === 0) return null;
  const setor = excluidas.filter((e) => e.motivo === 'SETOR_FINANCEIRO');
  const historia = excluidas.filter((e) => e.motivo === 'HISTORICO_INSUFICIENTE');

  return (
    <div className="cyber-card p-4 space-y-3">
      <h3 className="font-orbitron text-sm text-gray-300">Fora do ranking ({excluidas.length})</h3>

      {setor.length > 0 && (
        <div>
          <p className="text-xs text-gray-400">
            <strong className="text-gray-300">{setor.length} do setor financeiro.</strong>{' '}
            Num banco, o passivo circulante é o depósito do cliente e a alavancagem alta é o
            modelo de negócio — os critérios de liquidez e endividamento não têm o mesmo
            significado, e aplicá-los faria empresas sadias parecerem doentes.
          </p>
          <p className="mt-1 font-mono text-[11px] text-gray-500">
            {setor.map((e) => e.ticker).join(' · ')}
          </p>
        </div>
      )}

      {historia.length > 0 && (
        <div>
          <p className="text-xs text-gray-400">
            <strong className="text-gray-300">{historia.length} sem histórico suficiente.</strong>{' '}
            Consistência exige série comparável: 100% de trimestres saudáveis numa amostra curta
            é barato.
          </p>
          <ul className="mt-1 space-y-0.5">
            {historia.map((e) => (
              <li key={e.ticker} className="font-mono text-[11px] text-gray-500">
                {e.ticker} — {e.detalhe}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Passo 4: View orquestradora**

Criar `src/components/saude/SaudeFinanceiraView.tsx`:

```tsx
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import SaudeTable from './SaudeTable';
import ExclusoesPanel from './ExclusoesPanel';
import { getJson, emDeclinio, type HealthResponse } from './types';

/**
 * ÚNICO componente desta pasta que conhece rede. Os filhos recebem dados por
 * props e são testáveis isoladamente — mesma fronteira de `components/ranking/`.
 */

type Filtro = 'TODOS' | 'DECLINIO';

export default function SaudeFinanceiraView(): React.ReactElement {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('TODOS');

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      setData(await getJson<HealthResponse>('/api/cvm/financial-health'));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o ranking.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const rows = data?.rows ?? [];
  const visiveis = filtro === 'DECLINIO' ? rows.filter(emDeclinio) : rows;
  const emQueda = rows.filter(emDeclinio).length;

  return (
    <div className="space-y-4">
      <div className="cyber-card p-4">
        <p className="text-xs text-gray-400">
          <strong className="text-gray-300">Consistência financeira histórica.</strong>{' '}
          Não é previsão de retorno nem recomendação de compra. O escore é a fração média de
          cinco pilares aprovados por trimestre — alavancagem, liquidez, cobertura de juros,
          lucro e geração de caixa —, contada apenas sobre balanços cujo prazo legal de
          publicação já venceu.
        </p>
        {data && (
          <p className="mt-2 text-[11px] text-gray-600 font-mono">
            {data.universo.ranqueadas} ranqueadas de {data.universo.total} · limiares:
            dívida/PL ≤ {data.criterios.limiares.maxDividaBrutaPl} · liquidez ≥{' '}
            {data.criterios.limiares.minLiquidezCorrente} · juros ≥ {data.criterios.limiares.minIcj} ·
            mínimo de {data.criterios.minTrimestres} trimestres · janela recente de{' '}
            {data.criterios.janelaRecente}
          </p>
        )}
      </div>

      {erro && (
        <div className="cyber-card p-4 border border-red-500/40">
          <p className="text-xs text-red-400">{erro}</p>
          <button onClick={() => void carregar()} className="cyber-button cyber-button-secondary mt-2 text-xs">
            Tentar novamente
          </button>
        </div>
      )}

      {!erro && (
        <>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFiltro('TODOS')}
              className={`cyber-button text-xs ${filtro === 'TODOS' ? '' : 'cyber-button-secondary'}`}
            >
              Todas ({rows.length})
            </button>
            <button
              onClick={() => setFiltro('DECLINIO')}
              className={`cyber-button text-xs ${filtro === 'DECLINIO' ? '' : 'cyber-button-secondary'}`}
              title="Escore recente ao menos 15 p.p. abaixo do histórico"
            >
              Em declínio ({emQueda})
            </button>
          </div>

          <div className="cyber-card p-4">
            <SaudeTable
              rows={visiveis}
              loading={loading}
              emptyMessage={
                filtro === 'DECLINIO'
                  ? 'Nenhuma empresa com queda relevante entre o histórico e os últimos trimestres.'
                  : 'Nenhuma empresa qualificada — verifique se o banco de fundamentos CVM está presente.'
              }
            />
          </div>

          {data && <ExclusoesPanel excluidas={data.universo.excluidas} />}
        </>
      )}
    </div>
  );
}
```

- [ ] **Passo 5: Aba**

Criar `src/components/tabs/SaudeFinanceiraTab.tsx`:

```tsx
'use client';

import React from 'react';
import SaudeFinanceiraView from '@/components/saude/SaudeFinanceiraView';

/**
 * Aba Saúde Financeira.
 *
 * Afirmação DESCRITIVA — "esta empresa manteve as contas em ordem ao longo do
 * tempo" —, distinta da aba Ranking Fundamentalista, que é preditiva. Não tem
 * gate nem modelo: é contagem sobre balanço publicado. Ver
 * docs/superpowers/specs/2026-08-12-ranking-saude-financeira-design.md.
 */
export default function SaudeFinanceiraTab(): React.ReactElement {
  return (
    <div className="p-6 space-y-6 text-white">
      <h2 className="font-orbitron text-2xl font-bold neon-text-cyan">
        Saúde Financeira — consistência histórica
      </h2>
      <p className="text-xs text-gray-500 -mt-4">
        Quantos trimestres, ao longo de até 15 anos de balanços CVM, a empresa manteve
        alavancagem, liquidez, cobertura de juros, lucro e geração de caixa em ordem.
      </p>

      <SaudeFinanceiraView />
    </div>
  );
}
```

- [ ] **Passo 6: Registrar a aba**

Em `src/app/page.tsx`, quatro edições:

1. import do ícone — acrescentar `HeartPulse` à lista importada de `lucide-react`;
2. lazy: `const SaudeFinanceiraTab = lazy(() => import("@/components/tabs/SaudeFinanceiraTab"));`
3. `type TabId`: acrescentar `| "saude"`;
4. `TABS`: inserir logo após a entrada `ml`:
   `{ id: "saude", label: "Saúde Financeira", icon: HeartPulse },`
5. bloco de conteúdo, seguindo o padrão vizinho:

```tsx
{mountedTabs.has("saude") && (
  <div style={{ display: activeTab === "saude" ? "block" : "none" }}>
    <Suspense fallback={<TabLoader />}><SaudeFinanceiraTab /></Suspense>
  </div>
)}
```

- [ ] **Passo 7: Compilar e construir**

Executar: `npx tsc --noEmit && npm run build`
Esperado: ambos limpos.

- [ ] **Passo 8: Fim da tarefa**

```bash
git add src/components/saude src/components/tabs/SaudeFinanceiraTab.tsx src/app/page.tsx
# commit somente se o usuário pedir
```

---

### Task 5: Verificação runtime e documentação

**Arquivos:**
- Modificar: `CLAUDE.md` (seção de arquitetura)
- Modificar: `docs/CODEX_HANDOFF.md` (entrada da sessão)

- [ ] **Passo 1: Subir o servidor e conferir a resposta real**

Receita de `.claude/skills/verify/SKILL.md`: cópia do `dev.db`, `.env.local`
temporário, porta dedicada, tudo removido ao final. O `cvm_fundamentos.db` é
aberto somente para leitura e pode ser o real.

```bash
curl -s 'http://127.0.0.1:3210/api/cvm/financial-health' > /tmp/health.json
```

Conferir na resposta: `universo.ranqueadas` igual a 117, ausência dos 18
tickers financeiros em `rows`, `pilares` aberto por empresa, e `recente`
presente e distinto de `score`.

- [ ] **Passo 2: Rodar a suíte inteira que toca esta área**

Executar: `npm run test:financial-health && npm run test:cvm-fundamentals`
Esperado: ambas verdes — a segunda prova que a leitura nova não afetou a ficha.

- [ ] **Passo 3: Documentar**

Em `CLAUDE.md`, acrescentar à seção de arquitetura um parágrafo curto sobre a
aba nova: o que ela afirma, por que não tem gate, onde vive o código, e que o
setor financeiro está fora até a coleta de Basileia/inadimplência.

Em `docs/CODEX_HANDOFF.md`, entrada de sessão com: as cinco decisões, o
universo de 117, os limiares, o motivo da exclusão do setor financeiro, e a
pendência do bloco das financeiras.

- [ ] **Passo 4: Limpar o ambiente**

Remover `.env.local`, apagar a cópia do `dev.db`, encerrar o servidor.
Conferir: `git status` sem arquivos temporários.

---

## Auto-revisão

**Cobertura da spec:** motivação e legenda obrigatória → Task 4 Passo 4;
exclusão do setor financeiro → Task 2 Passo 1 + Task 4 Passo 3; piso de
história → Task 1 Passo 1 (`MIN_QUARTERS`) e prova em Task 2; cinco pilares e
limiares → Task 1 Passo 1, testados na fronteira em Task 1 Passo 2; dado
ausente não reprova → Task 1 Passos 1–2; escore e pilares abertos → Task 1 e
Task 4 Passo 2; desempate → Task 1 Passo 1 e teste de ordenação; point-in-time
→ Task 2 Passo 1 (`knowledgeDateFor`, corte `asOf`); coluna recente → Task 1
(`RECENT_QUARTERS`) e Task 4 Passo 2; arquitetura e fronteiras → estrutura de
arquivos das Tasks 1–4; ausência de tool MCP → nenhuma tarefa a cria; erros e
estados honestos → Task 2 (banco ausente), Task 3 (500/400), Task 4 (erro com
"Tentar novamente", `emptyMessage`); testes → Tasks 1, 2 e 5.

**Consistência de tipos:** `PillarKey`, `PillarRate`, `CompanyHealth` e
`HealthRow` compartilham a mesma forma; `scoreCompany` devolve
`CompanyHealth | null` e é o único produtor de `null`, tratado em Task 2;
`financialHealthRanking(asOf?)` tem a mesma assinatura na Task 2, na Task 3 e
no teste da Task 2.

**Sem placeholders:** todo passo de código traz o código real.
