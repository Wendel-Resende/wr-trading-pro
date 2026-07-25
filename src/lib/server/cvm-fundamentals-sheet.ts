/**
 * Assembler da Ficha Fundamentalista por empresa (read-only sobre o snapshot
 * `data/cvm/cvm_fundamentos.db`). Reaproveita `cvm-legacy-db` (DRE/BPA/BPP/DFC/
 * `indicadores` + proveniência) e adiciona a leitura de `fundamental_indicators`
 * (ROIC, dívida líquida/EBITDA, payout, EV/EBITDA), a derivada de conversão de
 * caixa e o carimbo de conhecimento. Nunca escreve; nunca recalcula os
 * indicadores do pipeline. Spec:
 * docs/architecture/2026-07-25-ficha-fundamentalista-cvm-design.md
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { getCompany, getQuarters, CVM_LEGACY_PROVENANCE } from './cvm-legacy-db';
import {
  cashConversion,
  knowledgeDateFor,
  LEGAL_LAG_RULE,
  dupontFactors,
  multipleBand,
  impliedFairPrice,
  median,
  type MultipleBand,
} from './cvm-fundamentals-derive';

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

export interface DupontPointV1 {
  period: { ano: number; trimestre: number };
  margemLiquida: number | null;
  giroAtivo: number | null;
  alavancagem: number | null;
  roeReconstruido: number | null;
  roePipeline: number | null;
  consistente: boolean | null;
  knowledgeDate: string;
  estimadoPorPrazoLegal: boolean;
}

export interface ValuationV1 {
  /** Último preço de referência do pipeline e o período dele. */
  precoRef: number | null;
  precoRefPeriod: { ano: number; trimestre: number } | null;
  /** Banda histórica por múltiplo (atual = último válido da série). */
  bands: { key: 'evEbitda' | 'pEbitda' | 'evEbit'; label: string; band: MultipleBand }[];
  /** Preço-justo implícito por reversão do EV/EBITDA à mediana histórica —
   *  NÃO é preço-alvo; nota obrigatória na UI. */
  fairPrice: {
    basis: 'evEbitda';
    currentMult: number | null;
    medianMult: number | null;
    fairPrice: number | null;
    upsidePct: number | null;
    /** 'BASE_INSUFICIENTE' quando a janela não tem períodos válidos suficientes. */
    note?: string;
  };
  /** Mediana do EV/EBITDA do setor (setor_cvm) no período do múltiplo atual. */
  sector: { setorCvm: string; medianEvEbitda: number | null; n: number } | null;
}

export interface FundamentalSheetV1 {
  company: { cdCvm: string; ticker: string; nome: string; setor: string | null };
  /** Data de corte "as of" (ISO) quando a ficha foi reconstruída para uma data
   *  passada — só períodos cujo carimbo de conhecimento (prazo legal) <= corte.
   *  `null` = visão completa atual. Limitação declarada: o corte usa o carimbo
   *  ESTIMADO por prazo legal e o snapshot não versiona retificações. */
  asOf: string | null;
  series: Record<string, FundamentalPointV1[]>;
  /** Decomposição DuPont do ROE por período (derivado no WR sobre fatores do pipeline). */
  dupont: DupontPointV1[];
  /** Valuation por múltiplos do pipeline + derivadas no WR (bandas, preço-justo implícito). */
  valuation: ValuationV1;
  provenance: {
    db: string;
    tables: string[];
    legalLagRule: string;
    base: typeof CVM_LEGACY_PROVENANCE;
    generatedAt: string;
  };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

let db: DatabaseSync | null = null;
function getDb(): DatabaseSync {
  if (db) return db;
  const file = path.join(process.cwd(), 'data', 'cvm', 'cvm_fundamentos.db');
  if (!existsSync(file)) throw new Error(`Banco de fundamentos CVM não encontrado em ${file}.`);
  db = new DatabaseSync(file, { readOnly: true });
  return db;
}

/**
 * `fundamental_indicators` é a fonte ÚNICA e internamente consistente dos
 * indicadores da ficha: valores em DECIMAL e base 12M (ex.: roe 0.18 = 18%).
 * A tabela `indicadores` usa outra escala (percentual) E outra semântica
 * (trimestral), então NÃO é misturada aqui — evita a inconsistência de escala/
 * base que quebraria a identidade DuPont e os gráficos. Percentuais são
 * convertidos para percentual (×100) no DTO; razões/múltiplos ficam em decimal.
 */
interface FiRow {
  ano: number;
  trimestre: number;
  dataRef: string | null;
  margemBruta: number | null;
  margemEbitda: number | null;
  margemLiquida: number | null;
  roe: number | null;
  roa: number | null;
  roic: number | null;
  giroAtivos: number | null;
  plAtivos: number | null;
  dividaBrutaPl: number | null;
  dividaLiquidaEbitda: number | null;
  payoutRatio: number | null;
  precoRef: number | null;
  pEbitda: number | null;
  evEbitda: number | null;
  evEbit: number | null;
}

function getFundamentalIndicators(cdCvm: string): FiRow[] {
  return (
    getDb()
      .prepare(
        'SELECT ano, trimestre, data_ref, margem_bruta, margem_ebitda, margem_liquida, roe, roa, roic, giro_ativos, pl_ativos, divida_bruta_pl, divida_liquida_ebitda, payout_ratio, preco_ref, p_ebitda, ev_ebitda, ev_ebit FROM fundamental_indicators WHERE cd_cvm = ?',
      )
      .all(cdCvm) as Record<string, unknown>[]
  ).map((r) => ({
    ano: Number(r.ano),
    trimestre: Number(r.trimestre),
    dataRef: typeof r.data_ref === 'string' && r.data_ref.length > 0 ? r.data_ref : null,
    margemBruta: num(r.margem_bruta),
    margemEbitda: num(r.margem_ebitda),
    margemLiquida: num(r.margem_liquida),
    roe: num(r.roe),
    roa: num(r.roa),
    roic: num(r.roic),
    giroAtivos: num(r.giro_ativos),
    plAtivos: num(r.pl_ativos),
    dividaBrutaPl: num(r.divida_bruta_pl),
    dividaLiquidaEbitda: num(r.divida_liquida_ebitda),
    payoutRatio: num(r.payout_ratio),
    precoRef: num(r.preco_ref),
    pEbitda: num(r.p_ebitda),
    evEbitda: num(r.ev_ebitda),
    evEbit: num(r.ev_ebit),
  }));
}

/** Multiplica por 100 preservando `null` (decimal → percentual para exibição). */
const pct = (v: number | null): number | null => (v === null ? null : v * 100);

export function buildFundamentalSheet(cdCvm: string, asOf?: string): FundamentalSheetV1 | null {
  const company = getCompany(cdCvm);
  if (!company) return null;

  const quarters = getQuarters(cdCvm);

  const point = (
    ano: number,
    trimestre: number,
    dataRef: string | null,
    value: number | null,
    unit: Unit,
    source: 'pipeline-cvm' | 'derivado-wr',
    note?: string,
  ): FundamentalPointV1 => {
    const k = knowledgeDateFor(dataRef, ano, trimestre);
    return {
      period: { ano, trimestre },
      value,
      unit,
      source,
      dataRef,
      knowledgeDate: k.iso,
      estimadoPorPrazoLegal: k.estimadoPorPrazoLegal,
      ...(note ? { note } : {}),
    };
  };

  // Iteração pela UNIÃO de períodos (indicadores de `fundamental_indicators` +
  // liquidez/fco de `getQuarters`), ordenada — nenhum período é descartado
  // silenciosamente (D6): um período que só tem um dos lados vira lacuna no outro.
  const qMap = new Map(quarters.map((q) => [`${q.ano}T${q.trimestre}`, q]));
  const fiMap = new Map(getFundamentalIndicators(cdCvm).map((r) => [`${r.ano}T${r.trimestre}`, r]));
  const keys = Array.from(new Set([...qMap.keys(), ...fiMap.keys()])).sort((a, b) => {
    const [ay, at] = a.split('T').map(Number);
    const [by, bt] = b.split('T').map(Number);
    return ay - by || at - bt;
  });

  const dupont: DupontPointV1[] = [];
  const series: Record<string, FundamentalPointV1[]> = {
    margemBruta: [],
    margemEbitda: [],
    margemLiquida: [],
    roe: [],
    roa: [],
    roic: [],
    dividaBrutaPl: [],
    dividaLiquidaEbitda: [],
    liquidezCorrente: [],
    payoutRatio: [],
    conversaoCaixa: [],
    evEbitda: [],
    pEbitda: [],
    evEbit: [],
  };

  // Acumuladores de valuation (ordem cronológica das keys).
  const multSeq: Record<'evEbitda' | 'pEbitda' | 'evEbit', (number | null)[]> = {
    evEbitda: [],
    pEbitda: [],
    evEbit: [],
  };
  let lastPreco: { v: number; ano: number; trimestre: number } | null = null;
  let lastEvPeriod: { ano: number; trimestre: number } | null = null;

  for (const key of keys) {
    const f = fiMap.get(key) ?? null;
    const q = qMap.get(key) ?? null;
    const [ano, trimestre] = key.split('T').map(Number);
    const dr = f?.dataRef ?? q?.dataRef ?? null;

    // As-of por prazo legal: períodos ainda não conhecidos na data de corte
    // ficam FORA de tudo (séries, DuPont, bandas, preço, mediana setorial —
    // que usa lastEvPeriod, também filtrado aqui).
    if (asOf && knowledgeDateFor(dr, ano, trimestre).iso > asOf) continue;

    // Indicadores: fonte única `fundamental_indicators` (decimal, 12M);
    // percentuais convertidos ×100 para exibição, razões em decimal.
    series.margemBruta.push(point(ano, trimestre, dr, pct(f?.margemBruta ?? null), 'percent', 'pipeline-cvm'));
    series.margemEbitda.push(point(ano, trimestre, dr, pct(f?.margemEbitda ?? null), 'percent', 'pipeline-cvm'));
    series.margemLiquida.push(point(ano, trimestre, dr, pct(f?.margemLiquida ?? null), 'percent', 'pipeline-cvm'));
    series.roe.push(point(ano, trimestre, dr, pct(f?.roe ?? null), 'percent', 'pipeline-cvm'));
    series.roa.push(point(ano, trimestre, dr, pct(f?.roa ?? null), 'percent', 'pipeline-cvm'));
    series.roic.push(point(ano, trimestre, dr, pct(f?.roic ?? null), 'percent', 'pipeline-cvm'));
    series.dividaBrutaPl.push(point(ano, trimestre, dr, f?.dividaBrutaPl ?? null, 'ratio', 'pipeline-cvm'));
    series.dividaLiquidaEbitda.push(point(ano, trimestre, dr, f?.dividaLiquidaEbitda ?? null, 'ratio', 'pipeline-cvm'));
    // Liquidez corrente só existe em `indicadores` — é uma razão (escala segura).
    series.liquidezCorrente.push(point(ano, trimestre, dr, q?.liquidezCorrente ?? null, 'ratio', 'pipeline-cvm'));
    series.payoutRatio.push(point(ano, trimestre, dr, pct(f?.payoutRatio ?? null), 'percent', 'pipeline-cvm'));
    const cc = cashConversion(q?.fco ?? null, q?.lucroLiquido ?? null);
    series.conversaoCaixa.push(point(ano, trimestre, dr, cc.value, 'ratio', 'derivado-wr', cc.note));

    // Múltiplos de valuation (pipeline, decimal — exibidos como múltiplo mesmo).
    series.evEbitda.push(point(ano, trimestre, dr, f?.evEbitda ?? null, 'multiple', 'pipeline-cvm'));
    series.pEbitda.push(point(ano, trimestre, dr, f?.pEbitda ?? null, 'multiple', 'pipeline-cvm'));
    series.evEbit.push(point(ano, trimestre, dr, f?.evEbit ?? null, 'multiple', 'pipeline-cvm'));
    multSeq.evEbitda.push(f?.evEbitda ?? null);
    multSeq.pEbitda.push(f?.pEbitda ?? null);
    multSeq.evEbit.push(f?.evEbit ?? null);
    if (f?.precoRef !== null && f?.precoRef !== undefined && f.precoRef > 0) {
      lastPreco = { v: f.precoRef, ano, trimestre };
    }
    if (f?.evEbitda !== null && f?.evEbitda !== undefined && f.evEbitda > 0) {
      lastEvPeriod = { ano, trimestre };
    }

    // DuPont (identidade em decimal dentro de `fundamental_indicators`);
    // margem/ROE exibidos em percentual (×100), giro e alavancagem como estão.
    const df = dupontFactors(f?.margemLiquida ?? null, f?.giroAtivos ?? null, f?.plAtivos ?? null, f?.roe ?? null);
    const k = knowledgeDateFor(dr, ano, trimestre);
    dupont.push({
      period: { ano, trimestre },
      margemLiquida: pct(df.margemLiquida),
      giroAtivo: df.giroAtivo,
      alavancagem: df.alavancagem,
      roeReconstruido: pct(df.roeReconstruido),
      roePipeline: pct(f?.roe ?? null),
      consistente: df.consistente,
      knowledgeDate: k.iso,
      estimadoPorPrazoLegal: k.estimadoPorPrazoLegal,
    });
  }

  // --- valuation: bandas históricas + preço-justo implícito + mediana do setor ---
  // Janela recente (últimos 20 trimestres ≈ 5 anos): banda de valuation clássica,
  // menos sujeita a regimes antigos irrelevantes. O teto de plausibilidade
  // (>100× descartado) vive em multipleBand — documentado lá.
  const BAND_WINDOW = 20;
  const bandEv = multipleBand(multSeq.evEbitda.slice(-BAND_WINDOW));
  const bandPe = multipleBand(multSeq.pEbitda.slice(-BAND_WINDOW));
  const bandEvbit = multipleBand(multSeq.evEbit.slice(-BAND_WINDOW));
  // Preço-justo só com base estatística mínima (>= 8 períodos válidos na
  // janela) — mediana sobre poucos pontos seria um número enganoso, não
  // informação. Sem base → null com nota, nunca fabricado.
  const FAIR_PRICE_MIN_N = 8;
  const fp =
    bandEv.n >= FAIR_PRICE_MIN_N
      ? impliedFairPrice(lastPreco?.v ?? null, bandEv.current, bandEv.median)
      : { fairPrice: null, upsidePct: null };
  const fpNote = bandEv.n >= FAIR_PRICE_MIN_N ? undefined : 'BASE_INSUFICIENTE';

  let sector: ValuationV1['sector'] = null;
  const setorRow = getDb().prepare('SELECT setor_cvm FROM empresas WHERE cd_cvm = ?').get(cdCvm) as
    | Record<string, unknown>
    | undefined;
  const setorCvm = typeof setorRow?.setor_cvm === 'string' && setorRow.setor_cvm.length > 0 ? setorRow.setor_cvm : null;
  if (setorCvm && lastEvPeriod) {
    const peers = (
      getDb()
        .prepare(
          'SELECT fi.ev_ebitda AS v FROM empresas e JOIN fundamental_indicators fi ON fi.cd_cvm = e.cd_cvm WHERE e.setor_cvm = ? AND fi.ano = ? AND fi.trimestre = ? AND fi.ev_ebitda IS NOT NULL AND fi.ev_ebitda > 0',
        )
        .all(setorCvm, lastEvPeriod.ano, lastEvPeriod.trimestre) as Record<string, unknown>[]
    ).map((r) => num(r.v));
    sector = { setorCvm, medianEvEbitda: median(peers), n: peers.filter((v) => v !== null).length };
  }

  const valuation: ValuationV1 = {
    precoRef: lastPreco?.v ?? null,
    precoRefPeriod: lastPreco ? { ano: lastPreco.ano, trimestre: lastPreco.trimestre } : null,
    bands: [
      { key: 'evEbitda', label: 'EV/EBITDA', band: bandEv },
      { key: 'pEbitda', label: 'P/EBITDA', band: bandPe },
      { key: 'evEbit', label: 'EV/EBIT', band: bandEvbit },
    ],
    fairPrice: {
      basis: 'evEbitda',
      currentMult: bandEv.current,
      medianMult: bandEv.median,
      fairPrice: fp.fairPrice,
      upsidePct: fp.upsidePct,
      ...(fpNote ? { note: fpNote } : {}),
    },
    sector,
  };

  return {
    company: { cdCvm: company.cdCvm, ticker: company.ticker, nome: company.nome, setor: company.setor },
    asOf: asOf ?? null,
    series,
    dupont,
    valuation,
    provenance: {
      db: 'data/cvm/cvm_fundamentos.db',
      tables: ['fundamental_indicators', 'indicadores', 'dre_trimestral', 'dfc_trimestral', 'empresas'],
      legalLagRule: LEGAL_LAG_RULE,
      base: CVM_LEGACY_PROVENANCE,
      generatedAt: new Date().toISOString(),
    },
  };
}
