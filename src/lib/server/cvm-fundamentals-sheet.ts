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

interface FiRow {
  ano: number;
  trimestre: number;
  dataRef: string | null;
  roic: number | null;
  dividaLiquidaEbitda: number | null;
  payoutRatio: number | null;
  evEbitda: number | null;
}

function getFundamentalIndicators(cdCvm: string): FiRow[] {
  return (
    getDb()
      .prepare(
        'SELECT ano, trimestre, data_ref, roic, divida_liquida_ebitda, payout_ratio, ev_ebitda FROM fundamental_indicators WHERE cd_cvm = ?',
      )
      .all(cdCvm) as Record<string, unknown>[]
  ).map((r) => ({
    ano: Number(r.ano),
    trimestre: Number(r.trimestre),
    dataRef: (typeof r.data_ref === 'string' && r.data_ref.length > 0 ? r.data_ref : null),
    roic: num(r.roic),
    dividaLiquidaEbitda: num(r.divida_liquida_ebitda),
    payoutRatio: num(r.payout_ratio),
    evEbitda: num(r.ev_ebitda),
  }));
}

export function buildFundamentalSheet(cdCvm: string): FundamentalSheetV1 | null {
  const company = getCompany(cdCvm);
  if (!company) return null;

  const quarters = getQuarters(cdCvm);
  const fi = new Map(getFundamentalIndicators(cdCvm).map((r) => [`${r.ano}T${r.trimestre}`, r]));

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

  const series: Record<string, FundamentalPointV1[]> = {
    margemBruta: [],
    margemEbitda: [],
    margemLiquida: [],
    roe: [],
    roa: [],
    roic: [],
    endividamento: [],
    dividaPl: [],
    dividaLiquidaEbitda: [],
    liquidezCorrente: [],
    payoutRatio: [],
    conversaoCaixa: [],
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
    provenance: {
      db: 'data/cvm/cvm_fundamentos.db',
      tables: ['fundamental_indicators', 'indicadores', 'dre_trimestral', 'dfc_trimestral', 'empresas'],
      legalLagRule: LEGAL_LAG_RULE,
      base: CVM_LEGACY_PROVENANCE,
      generatedAt: new Date().toISOString(),
    },
  };
}
