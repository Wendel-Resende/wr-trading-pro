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
import { cashConversion, knowledgeDateFor, LEGAL_LAG_RULE, dupontFactors } from './cvm-fundamentals-derive';

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

export interface FundamentalSheetV1 {
  company: { cdCvm: string; ticker: string; nome: string; setor: string | null };
  series: Record<string, FundamentalPointV1[]>;
  /** Decomposição DuPont do ROE por período (derivado no WR sobre fatores do pipeline). */
  dupont: DupontPointV1[];
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
}

function getFundamentalIndicators(cdCvm: string): FiRow[] {
  return (
    getDb()
      .prepare(
        'SELECT ano, trimestre, data_ref, margem_bruta, margem_ebitda, margem_liquida, roe, roa, roic, giro_ativos, pl_ativos, divida_bruta_pl, divida_liquida_ebitda, payout_ratio FROM fundamental_indicators WHERE cd_cvm = ?',
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
  }));
}

/** Multiplica por 100 preservando `null` (decimal → percentual para exibição). */
const pct = (v: number | null): number | null => (v === null ? null : v * 100);

export function buildFundamentalSheet(cdCvm: string): FundamentalSheetV1 | null {
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
  };

  for (const key of keys) {
    const f = fiMap.get(key) ?? null;
    const q = qMap.get(key) ?? null;
    const [ano, trimestre] = key.split('T').map(Number);
    const dr = f?.dataRef ?? q?.dataRef ?? null;

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

  return {
    company: { cdCvm: company.cdCvm, ticker: company.ticker, nome: company.nome, setor: company.setor },
    series,
    dupont,
    provenance: {
      db: 'data/cvm/cvm_fundamentos.db',
      tables: ['fundamental_indicators', 'indicadores', 'dre_trimestral', 'dfc_trimestral', 'empresas'],
      legalLagRule: LEGAL_LAG_RULE,
      base: CVM_LEGACY_PROVENANCE,
      generatedAt: new Date().toISOString(),
    },
  };
}
