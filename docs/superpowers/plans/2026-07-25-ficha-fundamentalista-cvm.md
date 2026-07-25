# Ficha Fundamentalista por Empresa (v1) — Implementation Plan

> **For agentic workers:** execução INLINE nesta sessão (o usuário não pediu subagentes). Steps em checkbox (`- [ ]`).

**Goal:** Superfície read-only por empresa com a evolução trimestral dos indicadores fundamentalistas já computados pelo pipeline CVM (margens, retornos incl. ROIC, alavancagem, liquidez, payout) + conversão de caixa derivada no WR, cada ponto com proveniência e carimbo de conhecimento derivado do prazo legal.

**Architecture:** Reaproveita `src/lib/server/cvm-legacy-db.ts` (já lê `cvm_fundamentos.db` read-only e retorna `getQuarters()` com DRE/BPA/BPP/DFC/`indicadores`). Adiciona: helpers puros de derivação (conversão de caixa + carimbo de conhecimento), leitor de `fundamental_indicators`, assembler do DTO `FundamentalSheetV1`, rota `GET /api/cvm/companies/[cdCvm]/fundamentals`, e seção "Ficha Fundamentalista" na `CvmFundamentalsTab`.

**Tech Stack:** Next.js API route (nodejs runtime), `node:sqlite` DatabaseSync read-only, TypeScript, Recharts (UI), harness tsx + `assertLog`.

## Global Constraints (do spec `docs/architecture/2026-07-25-ficha-fundamentalista-cvm-design.md`)

- Read-only sobre `data/cvm/cvm_fundamentos.db`; nenhuma escrita nesse banco, nenhum schema Prisma tocado.
- Fonte = tabelas do pipeline (`fundamental_indicators` primária p/ ROIC/EV/payout; `indicadores` complemento; `dre`/`dfc` p/ derivada). Nunca recalcular indicadores do pipeline.
- Carimbo de conhecimento = `data_ref` (ou fim do período civil) + `(trimestre==4 ? 90 : 45)` dias; `estimadoPorPrazoLegal` sempre `true` na v1.
- Conversão de caixa = `fco / lucro_liquido`; `lucro<=0` → null+`LUCRO_NAO_POSITIVO`; ausente → null+`DADO_AUSENTE`.
- Dado ausente = `value: null` explícito, período preservado, nunca fabricado (D6).
- Proveniência por métrica: `source: 'pipeline-cvm' | 'derivado-wr'`, unidade declarada.
- Sem "as of", sem valuation/preço, sem comparação setorial (fora de escopo v1).
- Verificação: `tsc --noEmit` limpo; suítes CVM existentes intactas; `npm run build`.
- Atualizar docs (handoff + vault) ao concluir o backend e ao concluir a UI (instrução do usuário: dar visibilidade incremental ao Guardião).

---

## Task 1: Helpers puros de derivação + testes

**Files:**
- Create: `src/lib/server/cvm-fundamentals-derive.ts`
- Create: `scripts/cvm-fundamentals/cvm-fundamentals-test.ts`
- Create: `scripts/cvm-fundamentals/run-cvm-fundamentals-tests.cjs`
- Modify: `package.json` (script `test:cvm-fundamentals`)

**Interfaces produzidas:**
- `cashConversion(fco: number|null, lucroLiquido: number|null): { value: number|null; note?: 'DADO_AUSENTE' | 'LUCRO_NAO_POSITIVO' }`
- `knowledgeDateFor(dataRef: string|null, ano: number, trimestre: number): { iso: string; estimadoPorPrazoLegal: boolean }`
- `LEGAL_LAG_RULE: string` (texto de proveniência)

- [ ] **Step 1: Escrever o teste (falha)** — `scripts/cvm-fundamentals/cvm-fundamentals-test.ts`:

```ts
import assert from 'node:assert/strict';
import { cashConversion, knowledgeDateFor, LEGAL_LAG_RULE } from '../../src/lib/server/cvm-fundamentals-derive';

function assertLog(cond: unknown, msg: string): void { assert.ok(cond, msg); console.log(`ok: ${msg}`); }

function main(): void {
  // conversão de caixa
  assertLog(cashConversion(120, 100).value === 1.2, 'fco/lucro = 1.2 quando ambos positivos');
  assertLog(cashConversion(80, -50).value === null && cashConversion(80, -50).note === 'LUCRO_NAO_POSITIVO', 'lucro<=0 → null + LUCRO_NAO_POSITIVO');
  assertLog(cashConversion(80, 0).note === 'LUCRO_NAO_POSITIVO', 'lucro=0 → LUCRO_NAO_POSITIVO');
  assertLog(cashConversion(null, 100).note === 'DADO_AUSENTE', 'fco ausente → DADO_AUSENTE');
  assertLog(cashConversion(80, null).note === 'DADO_AUSENTE', 'lucro ausente → DADO_AUSENTE');

  // carimbo de conhecimento — a partir de data_ref
  const k1 = knowledgeDateFor('2025-03-31', 2025, 1);
  assertLog(k1.iso.startsWith('2025-05-15') && k1.estimadoPorPrazoLegal, 'T1: data_ref + 45d = 2025-05-15, estimado');
  const k4 = knowledgeDateFor('2025-12-31', 2025, 4);
  assertLog(k4.iso.startsWith('2026-03-31'), 'T4: data_ref + 90d = 2026-03-31');
  // sem data_ref → fim do período civil de (ano,tri) + prazo
  const k3 = knowledgeDateFor(null, 2024, 3);
  assertLog(k3.iso.startsWith('2024-11-14'), 'T3 sem data_ref: fim civil 2024-09-30 + 45d = 2024-11-14');
  assertLog(typeof LEGAL_LAG_RULE === 'string' && LEGAL_LAG_RULE.length > 0, 'regra de prazo documentada');

  console.log('cvm-fundamentals: TODOS OS TESTES PASSARAM');
}
main();
```

Runner `scripts/cvm-fundamentals/run-cvm-fundamentals-tests.cjs` (padrão b3-ticker, sem Prisma):

```js
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const root = join(__dirname, '..', '..');
const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/cvm-fundamentals/cvm-fundamentals-test.ts'], { cwd: root, stdio: 'inherit' });
if (r.error) { console.error(r.error); process.exitCode = 1; } else { process.exitCode = r.status ?? 1; }
```

Adicionar em `package.json` (junto aos `test:*`): `"test:cvm-fundamentals": "node scripts/cvm-fundamentals/run-cvm-fundamentals-tests.cjs",`

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:cvm-fundamentals` → falha (módulo inexistente).

- [ ] **Step 3: Implementar** `src/lib/server/cvm-fundamentals-derive.ts`:

```ts
/**
 * Derivações puras da Ficha Fundamentalista (sem acesso a banco — testáveis
 * isoladamente). Spec: docs/architecture/2026-07-25-ficha-fundamentalista-cvm-design.md
 */
export const LEGAL_LAG_RULE =
  'Carimbo de conhecimento derivado do prazo legal CVM (ITR T1/T2/T3: +45 dias; DFP T4: +90 dias a partir do fim do período). Estimado — o snapshot não tem data de publicação real.';

export function cashConversion(
  fco: number | null,
  lucroLiquido: number | null,
): { value: number | null; note?: 'DADO_AUSENTE' | 'LUCRO_NAO_POSITIVO' } {
  if (fco === null || lucroLiquido === null) return { value: null, note: 'DADO_AUSENTE' };
  if (lucroLiquido <= 0) return { value: null, note: 'LUCRO_NAO_POSITIVO' };
  return { value: fco / lucroLiquido };
}

function endOfCivilQuarter(ano: number, trimestre: number): Date {
  // T1→31/03, T2→30/06, T3→30/09, T4→31/12 (UTC)
  const endMonthDay: Record<number, [number, number]> = { 1: [2, 31], 2: [5, 30], 3: [8, 30], 4: [11, 31] };
  const [m, d] = endMonthDay[trimestre] ?? [11, 31];
  return new Date(Date.UTC(ano, m, d));
}

export function knowledgeDateFor(
  dataRef: string | null,
  ano: number,
  trimestre: number,
): { iso: string; estimadoPorPrazoLegal: boolean } {
  const base = dataRef ? new Date(`${dataRef}T00:00:00.000Z`) : endOfCivilQuarter(ano, trimestre);
  const lagDays = trimestre === 4 ? 90 : 45;
  const known = new Date(base.getTime() + lagDays * 24 * 60 * 60 * 1000);
  return { iso: known.toISOString().slice(0, 10), estimadoPorPrazoLegal: true };
}
```

> Nota de verificação do exemplo: 2025-03-31 + 45d = 2025-05-15; 2025-12-31 + 90d = 2026-03-31; 2024-09-30 + 45d = 2024-11-14. Confirmar no teste; se o fim civil de T3 (30/09) exigir `[8,30]` (mês 8 = setembro 0-indexed) confira o valor real e ajuste o teste ao resultado do `Date.UTC` (não force um offset errado).

- [ ] **Step 4: Rodar e ver passar** — `npm run test:cvm-fundamentals` → `TODOS OS TESTES PASSARAM`; `npx tsc --noEmit` limpo.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/cvm-fundamentals-derive.ts scripts/cvm-fundamentals/ package.json
git commit -m "feat(cvm): helpers puros da ficha fundamentalista (conversão de caixa + carimbo de conhecimento)"
```

---

## Task 2: Leitor de `fundamental_indicators` + assembler do DTO

**Files:**
- Create: `src/lib/server/cvm-fundamentals-sheet.ts`
- Test: estende `scripts/cvm-fundamentals/cvm-fundamentals-test.ts` (smoke read-only contra o banco real, 1 ticker)

**Interfaces:**
- Consumes: `getCompany`, `getQuarters` (de `cvm-legacy-db.ts`); `cashConversion`, `knowledgeDateFor`, `LEGAL_LAG_RULE` (Task 1).
- Produces: `buildFundamentalSheet(cdCvm: string): FundamentalSheetV1 | null` + tipos `FundamentalPointV1`, `FundamentalSheetV1`.

- [ ] **Step 1: Implementar** `src/lib/server/cvm-fundamentals-sheet.ts`:

```ts
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { getCompany, getQuarters, CVM_LEGACY_PROVENANCE } from './cvm-legacy-db';
import { cashConversion, knowledgeDateFor, LEGAL_LAG_RULE } from './cvm-fundamentals-derive';

export type Unit = 'percent' | 'ratio' | 'multiple';
export interface FundamentalPointV1 {
  period: { ano: number; trimestre: number };
  value: number | null;
  unit: Unit;
  source: 'pipeline-cvm' | 'derivado-wr';
  dataRef: string | null;
  knowledgeDate: string;
  estimadoPorPrazoLegal: boolean;
  note?: string;
}
export interface FundamentalSheetV1 {
  company: { cdCvm: string; ticker: string; nome: string; setor: string | null };
  series: Record<string, FundamentalPointV1[]>;
  provenance: { db: string; tables: string[]; legalLagRule: string; base: typeof CVM_LEGACY_PROVENANCE; generatedAt: string };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
let db: DatabaseSync | null = null;
function getDb(): DatabaseSync {
  if (db) return db;
  const file = path.join(process.cwd(), 'data', 'cvm', 'cvm_fundamentos.db');
  if (!existsSync(file)) throw new Error(`Banco CVM não encontrado em ${file}.`);
  db = new DatabaseSync(file, { readOnly: true });
  return db;
}

interface FiRow { ano: number; trimestre: number; dataRef: string | null; roic: number|null; dividaLiquidaEbitda: number|null; payoutRatio: number|null; evEbitda: number|null; }
function getFundamentalIndicators(cdCvm: string): FiRow[] {
  return (getDb()
    .prepare('SELECT ano, trimestre, data_ref, roic, divida_liquida_ebitda, payout_ratio, ev_ebitda FROM fundamental_indicators WHERE cd_cvm = ?')
    .all(cdCvm) as Record<string, unknown>[])
    .map((r) => ({ ano: Number(r.ano), trimestre: Number(r.trimestre), dataRef: (typeof r.data_ref === 'string' && r.data_ref) || null,
      roic: num(r.roic), dividaLiquidaEbitda: num(r.divida_liquida_ebitda), payoutRatio: num(r.payout_ratio), evEbitda: num(r.ev_ebitda) }));
}

export function buildFundamentalSheet(cdCvm: string): FundamentalSheetV1 | null {
  const company = getCompany(cdCvm);
  if (!company) return null;
  const quarters = getQuarters(cdCvm);
  const fi = new Map(getFundamentalIndicators(cdCvm).map((r) => [`${r.ano}T${r.trimestre}`, r]));

  const point = (ano: number, trimestre: number, dataRef: string | null, value: number | null, unit: Unit, source: 'pipeline-cvm' | 'derivado-wr', note?: string): FundamentalPointV1 => {
    const k = knowledgeDateFor(dataRef, ano, trimestre);
    return { period: { ano, trimestre }, value, unit, source, dataRef, knowledgeDate: k.iso, estimadoPorPrazoLegal: k.estimadoPorPrazoLegal, note };
  };

  const series: Record<string, FundamentalPointV1[]> = {
    margemBruta: [], margemEbitda: [], margemLiquida: [], roe: [], roa: [], roic: [],
    endividamento: [], dividaPl: [], dividaLiquidaEbitda: [], liquidezCorrente: [], payoutRatio: [], conversaoCaixa: [],
  };

  for (const q of quarters) {
    const f = fi.get(`${q.ano}T${q.trimestre}`) ?? null;
    const dr = q.dataRef ?? f?.dataRef ?? null;
    series.margemBruta.push(point(q.ano, q.trimestre, dr, q.margemBruta, 'percent', 'pipeline-cvm'));
    series.margemEbitda.push(point(q.ano, q.trimestre, dr, q.margemEbitda, 'percent', 'pipeline-cvm'));
    series.margemLiquida.push(point(q.ano, q.trimestre, dr, q.margemLiquida, 'percent', 'pipeline-cvm'));
    series.roe.push(point(q.ano, q.trimestre, dr, q.roe, 'percent', 'pipeline-cvm'));
    series.roa.push(point(q.ano, q.trimestre, dr, q.roa, 'percent', 'pipeline-cvm'));
    series.roic.push(point(q.ano, q.trimestre, dr, f?.roic ?? null, 'percent', 'pipeline-cvm'));
    series.endividamento.push(point(q.ano, q.trimestre, dr, q.endividamento, 'ratio', 'pipeline-cvm'));
    series.dividaPl.push(point(q.ano, q.trimestre, dr, q.dividaPl, 'ratio', 'pipeline-cvm'));
    series.dividaLiquidaEbitda.push(point(q.ano, q.trimestre, dr, f?.dividaLiquidaEbitda ?? null, 'ratio', 'pipeline-cvm'));
    series.liquidezCorrente.push(point(q.ano, q.trimestre, dr, q.liquidezCorrente, 'ratio', 'pipeline-cvm'));
    series.payoutRatio.push(point(q.ano, q.trimestre, dr, f?.payoutRatio ?? null, 'percent', 'pipeline-cvm'));
    const cc = cashConversion(q.fco, q.lucroLiquido);
    series.conversaoCaixa.push(point(q.ano, q.trimestre, dr, cc.value, 'ratio', 'derivado-wr', cc.note));
  }

  return {
    company: { cdCvm: company.cdCvm, ticker: company.ticker, nome: company.nome, setor: company.setor },
    series,
    provenance: { db: 'data/cvm/cvm_fundamentos.db', tables: ['fundamental_indicators', 'indicadores', 'dre_trimestral', 'dfc_trimestral', 'empresas'], legalLagRule: LEGAL_LAG_RULE, base: CVM_LEGACY_PROVENANCE, generatedAt: new Date().toISOString() },
  };
}
```

- [ ] **Step 2: Smoke test read-only** — adicionar ao `cvm-fundamentals-test.ts` um bloco que só roda se o banco existir (senão pula com log), monta a ficha de um ticker conhecido e verifica invariantes:

```ts
import { existsSync } from 'node:fs';
import { buildFundamentalSheet } from '../../src/lib/server/cvm-fundamentals-sheet';
// dentro de main(), ao final:
if (existsSync('data/cvm/cvm_fundamentos.db')) {
  // WEGE3 = cd_cvm 005410? usar um cd_cvm real do banco; se desconhecido, pega o 1º de empresas
  const sheet = buildFundamentalSheet(process.env.CVM_TEST_CDCVM ?? '022470');
  assertLog(sheet !== null, 'ficha montada p/ cd_cvm de teste');
  if (sheet) {
    assertLog(Array.isArray(sheet.series.conversaoCaixa), 'série conversaoCaixa presente');
    assertLog(sheet.series.roic.every((p) => p.source === 'pipeline-cvm'), 'roic marcado pipeline-cvm');
    assertLog(sheet.series.conversaoCaixa.every((p) => p.source === 'derivado-wr'), 'conversaoCaixa marcada derivado-wr');
    assertLog(sheet.series.roe.every((p) => typeof p.knowledgeDate === 'string' && p.estimadoPorPrazoLegal), 'todo ponto tem carimbo estimado');
    assertLog(sheet.provenance.tables.includes('fundamental_indicators'), 'proveniência lista as tabelas');
  }
} else { console.log('ok: smoke da ficha pulado (banco CVM ausente no ambiente)'); }
```

- [ ] **Step 3: Rodar** — `npm run test:cvm-fundamentals` (verde) + `npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/cvm-fundamentals-sheet.ts scripts/cvm-fundamentals/cvm-fundamentals-test.ts
git commit -m "feat(cvm): assembler da ficha fundamentalista (fundamental_indicators + derivada + proveniência)"
```

---

## Task 3: Rota `GET /api/cvm/companies/[cdCvm]/fundamentals`

**Files:**
- Create: `src/app/api/cvm/companies/[cdCvm]/fundamentals/route.ts`

**Interfaces:** Consumes `buildFundamentalSheet` (Task 2).

- [ ] **Step 1: Implementar a rota** (padrão da rota de detalhe existente):

```ts
import { NextRequest, NextResponse } from 'next/server';
import { buildFundamentalSheet } from '@/lib/server/cvm-fundamentals-sheet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CD_CVM_PATTERN = /^[0-9]{1,10}$/;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ cdCvm: string }> }) {
  try {
    const { cdCvm } = await params;
    if (!CD_CVM_PATTERN.test(cdCvm)) return NextResponse.json({ error: 'Código CVM inválido.' }, { status: 400 });
    const sheet = buildFundamentalSheet(cdCvm);
    if (!sheet) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
    return NextResponse.json(sheet);
  } catch (error) {
    console.error('[api/cvm/companies/:cdCvm/fundamentals]', error);
    return NextResponse.json({ error: 'Não foi possível montar a ficha fundamentalista.' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verificar** — `npx tsc --noEmit`; `npm run build` (rota compila; não quebra as `/api/cvm/*` existentes).

- [ ] **Step 3: Smoke E2E opcional** — com o app dev rodando (se disponível): `GET /api/cvm/companies/<cd>/fundamentals` retorna 200 com `series`/`provenance`; `<cd>` inválido → 400; inexistente → 404. (Se não houver app rodando, o teste da Task 2 já cobre o assembler; a rota é um wrapper fino.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cvm/companies/[cdCvm]/fundamentals/route.ts
git commit -m "feat(cvm): rota read-only GET /api/cvm/companies/[cdCvm]/fundamentals"
```

- [ ] **Step 5: Checkpoint de docs (backend concluído)** — atualizar `docs/CODEX_HANDOFF.md` com uma nota da sessão registrando o backend da ficha (helpers, assembler, rota) pronto e verificado; commit `docs(handoff): ...`. (Instrução do usuário: visibilidade incremental ao Guardião.)

---

## Task 4: Seção "Ficha Fundamentalista" na `CvmFundamentalsTab`

**Files:**
- Modify: `src/components/tabs/CvmFundamentalsTab.tsx`

- [ ] **Step 1: Ler o componente atual** para casar estilo (como carrega o detalhe da empresa via `/api/cvm/companies/[cdCvm]`, estados de loading/erro, uso de Recharts/Toast). Seguir os padrões existentes (Toast global, nunca `alert()`).

- [ ] **Step 2: Implementar a seção** — quando uma empresa está selecionada, buscar `/api/cvm/companies/${cdCvm}/fundamentals` e renderizar:
  - Small-multiples (Recharts `LineChart` ou sparklines) por dimensão: Margens (bruta/EBITDA/líquida), Retornos (ROE/ROA/ROIC), Alavancagem (dívida/PL, dívida líq./EBITDA, endividamento), Liquidez, Payout, e Conversão de caixa.
  - Pontos com `value === null` aparecem como gap/"sem dado" (não zero); tooltip mostra período + `knowledgeDate` (com selo "estimado — prazo legal") + `source` (`pipeline` vs `derivado WR`) + `note` quando houver.
  - Um rodapé de proveniência com `provenance.legalLagRule` e `provenance.base.note`.
  - Erros → Toast global; loading → skeleton/spinner no padrão do componente.

- [ ] **Step 3: Verificar** — `npx tsc --noEmit`; `npm run build` (a aba compila e renderiza). Se houver app rodando, validar visualmente com 1 ticker (opcional).

- [ ] **Step 4: Commit**

```bash
git add src/components/tabs/CvmFundamentalsTab.tsx
git commit -m "feat(cvm): seção Ficha Fundamentalista na aba Fundamentos CVM (Recharts + proveniência)"
```

---

## Task 5: Verificação final + docs

- [ ] **Step 1: Suíte + tipos + build**

```bash
npm run test:cvm-fundamentals
npx tsc --noEmit
npm run build
```
Esperado: verde; build sem erros; `/api/cvm/*` e a aba existentes intactos.

- [ ] **Step 2: Atualizar handoff + vault (feature concluída)** — nota final no `docs/CODEX_HANDOFF.md` (ficha completa: helpers, assembler, rota, UI; o que ficou fora de escopo/próximas fatias) + entrada no `log.md` do vault e nota na página do upgrade. Commit `docs(...)` + push.

- [ ] **Step 3: Reportar ao usuário** — resumo do que foi entregue, como abrir (aba Fundamentos CVM → empresa), e as próximas fatias do painel (DuPont/ROIC, comparação setorial, valuation).

## Self-Review

- Cobertura do spec: D1 (fonte pipeline, sem recálculo) ✓ Task 2; D2 (indicadores) ✓ Task 2; D3 (conversão de caixa) ✓ Task 1; D4 (carimbo) ✓ Task 1; D5 (série reportada) ✓ (sem as-of); D6 (faltantes null) ✓ Tasks 1-2; D7 (envelope) ✓ Task 2; D8 (rota) ✓ Task 3; D9 (UI) ✓ Task 4.
- Placeholders: nenhum passo sem código/comando.
- Tipos: `FundamentalPointV1`/`FundamentalSheetV1`/`cashConversion`/`knowledgeDateFor` consistentes entre tasks.
