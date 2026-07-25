/**
 * Comparação setorial point-in-time (read-only sobre `cvm_fundamentos.db`).
 * Agrupa por `setor_cvm` (classificação CVM, buckets padrão) e ranqueia empresas
 * do setor por um indicador de `fundamental_indicators` (12M, decimal — fonte
 * única e consistente, ver cvm-fundamentals-sheet.ts). Nunca escreve; nunca
 * recalcula os indicadores do pipeline. Point-in-time: o período padrão é o mais
 * recente cujo carimbo de conhecimento (prazo legal) já passou — não compara um
 * período que ainda não foi amplamente publicado. Spec:
 * docs/architecture/2026-07-25-ficha-fundamentalista-cvm-design.md (fatia setorial).
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { knowledgeDateFor, median, percentile, LEGAL_LAG_RULE } from './cvm-fundamentals-derive';
import { CVM_LEGACY_PROVENANCE } from './cvm-legacy-db';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

let db: DatabaseSync | null = null;
function getDb(): DatabaseSync {
  if (db) return db;
  const file = path.join(process.cwd(), 'data', 'cvm', 'cvm_fundamentos.db');
  if (!existsSync(file)) throw new Error(`Banco de fundamentos CVM não encontrado em ${file}.`);
  db = new DatabaseSync(file, { readOnly: true });
  return db;
}

/** Allowlist de indicadores comparáveis. `col` NUNCA vem de input do usuário —
 *  a chave é validada contra este mapa antes de compor a query. */
const INDICATORS = {
  roe: { col: 'roe', label: 'ROE', unit: 'percent', pct: true, betterWhen: 'higher' },
  roic: { col: 'roic', label: 'ROIC', unit: 'percent', pct: true, betterWhen: 'higher' },
  margemLiquida: { col: 'margem_liquida', label: 'Margem Líquida', unit: 'percent', pct: true, betterWhen: 'higher' },
  margemEbitda: { col: 'margem_ebitda', label: 'Margem EBITDA', unit: 'percent', pct: true, betterWhen: 'higher' },
  dividaLiquidaEbitda: { col: 'divida_liquida_ebitda', label: 'Dívida Líq./EBITDA', unit: 'ratio', pct: false, betterWhen: 'lower' },
  payoutRatio: { col: 'payout_ratio', label: 'Payout', unit: 'percent', pct: true, betterWhen: 'higher' },
  giroAtivos: { col: 'giro_ativos', label: 'Giro do Ativo', unit: 'ratio', pct: false, betterWhen: 'higher' },
} as const;

export type IndicatorKey = keyof typeof INDICATORS;
export const isIndicatorKey = (k: string): k is IndicatorKey => Object.prototype.hasOwnProperty.call(INDICATORS, k);
export const indicatorCatalog = (Object.keys(INDICATORS) as IndicatorKey[]).map((k) => ({
  key: k,
  label: INDICATORS[k].label,
  unit: INDICATORS[k].unit,
  betterWhen: INDICATORS[k].betterWhen,
}));

export interface SectorInfo {
  setor: string;
  n: number;
}

export function listSectors(): SectorInfo[] {
  return (
    getDb()
      .prepare(
        "SELECT setor_cvm AS setor, COUNT(*) AS n FROM empresas WHERE setor_cvm IS NOT NULL AND setor_cvm <> '' GROUP BY setor_cvm ORDER BY n DESC, setor_cvm",
      )
      .all() as Record<string, unknown>[]
  ).map((r) => ({ setor: String(r.setor), n: Number(r.n) }));
}

export interface SectorRankingRow {
  cdCvm: string;
  ticker: string;
  nome: string;
  value: number | null;
  rank: number | null;
}

export interface SectorRanking {
  setor: string;
  indicator: { key: IndicatorKey; label: string; unit: string; betterWhen: string };
  period: { ano: number; trimestre: number } | null;
  knowledgeDate: string | null;
  estimadoPorPrazoLegal: boolean;
  comparable: boolean;
  rows: SectorRankingRow[];
  stats: { n: number; median: number | null; p25: number | null; p75: number | null; mean: number | null };
  provenance: { db: string; tables: string[]; legalLagRule: string; base: typeof CVM_LEGACY_PROVENANCE; generatedAt: string };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Períodos (ano,tri) com dado do indicador no setor, do mais recente ao mais antigo. */
function candidatePeriods(setor: string, col: string): { ano: number; trimestre: number }[] {
  return (
    getDb()
      .prepare(
        `SELECT DISTINCT fi.ano AS ano, fi.trimestre AS trimestre
         FROM empresas e JOIN fundamental_indicators fi ON fi.cd_cvm = e.cd_cvm
         WHERE e.setor_cvm = ? AND fi.${col} IS NOT NULL
         ORDER BY fi.ano DESC, fi.trimestre DESC`,
      )
      .all(setor) as Record<string, unknown>[]
  ).map((r) => ({ ano: Number(r.ano), trimestre: Number(r.trimestre) }));
}

export function sectorRanking(
  setor: string,
  indicatorKey: IndicatorKey,
  ano?: number,
  trimestre?: number,
  asOf?: string,
): SectorRanking {
  // Corte de conhecimento: `asOf` (ISO) reconstrói o ranking como era naquela
  // data (carimbo por prazo legal); sem asOf, vale hoje.
  const cutoff = asOf ?? todayIso();
  const spec = INDICATORS[indicatorKey];
  const provenance = {
    db: 'data/cvm/cvm_fundamentos.db',
    tables: ['empresas', 'fundamental_indicators'],
    legalLagRule: LEGAL_LAG_RULE,
    base: CVM_LEGACY_PROVENANCE,
    generatedAt: new Date().toISOString(),
  };
  const empty = (period: { ano: number; trimestre: number } | null): SectorRanking => ({
    setor,
    indicator: { key: indicatorKey, label: spec.label, unit: spec.unit, betterWhen: spec.betterWhen },
    period,
    knowledgeDate: period ? knowledgeDateFor(null, period.ano, period.trimestre).iso : null,
    estimadoPorPrazoLegal: true,
    comparable: period ? knowledgeDateFor(null, period.ano, period.trimestre).iso <= cutoff : false,
    rows: [],
    stats: { n: 0, median: null, p25: null, p75: null, mean: null },
    provenance,
  });

  // Período: explícito, ou o mais recente já "conhecido" (carimbo <= hoje).
  let period: { ano: number; trimestre: number } | null = null;
  if (typeof ano === 'number' && typeof trimestre === 'number') {
    period = { ano, trimestre };
  } else {
    const cands = candidatePeriods(setor, spec.col);
    period = cands.find((p) => knowledgeDateFor(null, p.ano, p.trimestre).iso <= cutoff) ?? cands[0] ?? null;
  }
  if (!period) return empty(null);

  const raw = getDb()
    .prepare(
      `SELECT e.cd_cvm AS cdCvm, e.ticker AS ticker, e.nome AS nome, fi.${spec.col} AS value
       FROM empresas e JOIN fundamental_indicators fi ON fi.cd_cvm = e.cd_cvm
       WHERE e.setor_cvm = ? AND fi.ano = ? AND fi.trimestre = ?`,
    )
    .all(setor, period.ano, period.trimestre) as Record<string, unknown>[];

  const rows: SectorRankingRow[] = raw.map((r) => {
    const v = num(r.value);
    return { cdCvm: String(r.cdCvm), ticker: String(r.ticker), nome: String(r.nome), value: v === null ? null : spec.pct ? v * 100 : v, rank: null };
  });

  // Ordena: null sempre por último; entre válidos, direção conforme betterWhen.
  rows.sort((a, b) => {
    if (a.value === null && b.value === null) return a.ticker.localeCompare(b.ticker);
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return spec.betterWhen === 'lower' ? a.value - b.value : b.value - a.value;
  });
  rows.forEach((r, i) => {
    r.rank = r.value === null ? null : i + 1;
  });

  const values = rows.map((r) => r.value);
  const finite = values.filter((v): v is number => v !== null);
  const stats = {
    n: finite.length,
    median: median(values),
    p25: percentile(values, 25),
    p75: percentile(values, 75),
    mean: finite.length ? finite.reduce((s, v) => s + v, 0) / finite.length : null,
  };

  const k = knowledgeDateFor(null, period.ano, period.trimestre);
  return {
    setor,
    indicator: { key: indicatorKey, label: spec.label, unit: spec.unit, betterWhen: spec.betterWhen },
    period,
    knowledgeDate: k.iso,
    estimadoPorPrazoLegal: k.estimadoPorPrazoLegal,
    comparable: k.iso <= cutoff,
    rows,
    stats,
    provenance,
  };
}
