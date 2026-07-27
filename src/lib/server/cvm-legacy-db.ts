/**
 * Acesso read-only ao banco derivado de fundamentos CVM — WR Trading Pro
 *
 * Fonte: data/cvm/cvm_fundamentos.db (snapshot do pipeline do lab; ver
 * data/cvm/README.md). São valores DERIVADOS/normalizados, sem point-in-time
 * (sem protocolo de documento, publicação ou versionamento de retificação) —
 * proveniência distinta do modelo canônico CvmFiling/CvmFact, que segue
 * reservado para a ingestão real dos dados brutos do portal da CVM.
 *
 * Usa node:sqlite (builtin) em modo somente leitura; nenhuma escrita passa
 * por aqui.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { existsSync } from 'node:fs';

export const CVM_LEGACY_PROVENANCE = {
  source: 'CVM (derivado — pipeline do lab, snapshot 2026-07-14)',
  pointInTime: false,
  note:
    'Valores derivados/normalizados de arquivos públicos da CVM. Sem protocolo de documento, data de publicação ou versionamento de retificação.',
} as const;

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  const file = path.join(process.cwd(), 'data', 'cvm', 'cvm_fundamentos.db');
  if (!existsSync(file)) {
    throw new Error(
      `Banco de fundamentos CVM não encontrado em ${file}. Ver data/cvm/README.md.`
    );
  }
  db = new DatabaseSync(file, { readOnly: true });
  return db;
}

export interface CvmCompany {
  cdCvm: string;
  ticker: string;
  nome: string;
  setor: string | null;
  segmento: string | null;
}

export interface CvmQuarter {
  ano: number;
  trimestre: number;
  dataRef: string | null;
  // DRE
  receitaLiquida: number | null;
  lucroBruto: number | null;
  ebit: number | null;
  ebitda: number | null;
  lucroLiquido: number | null;
  // BPA / BPP
  ativoTotal: number | null;
  ativoCirculante: number | null;
  caixa: number | null;
  patrimonioLiquido: number | null;
  passivoCirculante: number | null;
  passivoNaoCirc: number | null;
  dividaCp: number | null;
  dividaLp: number | null;
  // DFC
  fco: number | null;
  capex: number | null;
  fcf: number | null;
  dividendosPagos: number | null;
  jcpPagos: number | null;
  // Indicadores calculados
  margemBruta: number | null;
  margemEbit: number | null;
  margemEbitda: number | null;
  margemLiquida: number | null;
  roe: number | null;
  roa: number | null;
  endividamento: number | null;
  liquidezCorrente: number | null;
  dividaPl: number | null;
}

export interface CvmShareCapital {
  ano: number;
  trimestre: number;
  acoesTotal: number | null;
  acoesOn: number | null;
  acoesPn: number | null;
  qtOn: number | null;
  qtPn: number | null;
  qtTotal: number | null;
  qtTesouraria: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export function listCompanies(): CvmCompany[] {
  const rows = getDb()
    .prepare('SELECT cd_cvm, ticker, nome, setor, segmento FROM empresas ORDER BY ticker')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    cdCvm: String(r.cd_cvm),
    ticker: String(r.ticker),
    nome: String(r.nome),
    setor: str(r.setor),
    segmento: str(r.segmento),
  }));
}

export function getCompany(cdCvm: string): CvmCompany | null {
  const r = getDb()
    .prepare('SELECT cd_cvm, ticker, nome, setor, segmento FROM empresas WHERE cd_cvm = ?')
    .get(cdCvm) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    cdCvm: String(r.cd_cvm),
    ticker: String(r.ticker),
    nome: String(r.nome),
    setor: str(r.setor),
    segmento: str(r.segmento),
  };
}

export function getQuarters(cdCvm: string): CvmQuarter[] {
  const d = getDb();
  const byKey = new Map<string, CvmQuarter>();

  const ensure = (ano: number, trimestre: number): CvmQuarter => {
    const key = `${ano}T${trimestre}`;
    let q = byKey.get(key);
    if (!q) {
      q = {
        ano,
        trimestre,
        dataRef: null,
        receitaLiquida: null,
        lucroBruto: null,
        ebit: null,
        ebitda: null,
        lucroLiquido: null,
        ativoTotal: null,
        ativoCirculante: null,
        caixa: null,
        patrimonioLiquido: null,
        passivoCirculante: null,
        passivoNaoCirc: null,
        dividaCp: null,
        dividaLp: null,
        fco: null,
        capex: null,
        fcf: null,
        dividendosPagos: null,
        jcpPagos: null,
        margemBruta: null,
        margemEbit: null,
        margemEbitda: null,
        margemLiquida: null,
        roe: null,
        roa: null,
        endividamento: null,
        liquidezCorrente: null,
        dividaPl: null,
      };
      byKey.set(key, q);
    }
    return q;
  };

  for (const r of d
    .prepare(
      'SELECT ano, trimestre, data_ref, receita_liquida, lucro_bruto, ebit, ebitda, lucro_liquido FROM dre_trimestral WHERE cd_cvm = ?'
    )
    .all(cdCvm) as Record<string, unknown>[]) {
    const q = ensure(Number(r.ano), Number(r.trimestre));
    q.dataRef = str(r.data_ref) ?? q.dataRef;
    q.receitaLiquida = num(r.receita_liquida);
    q.lucroBruto = num(r.lucro_bruto);
    q.ebit = num(r.ebit);
    q.ebitda = num(r.ebitda);
    q.lucroLiquido = num(r.lucro_liquido);
  }

  for (const r of d
    .prepare('SELECT ano, trimestre, ativo_total, ativo_circulante, caixa FROM bpa_trimestral WHERE cd_cvm = ?')
    .all(cdCvm) as Record<string, unknown>[]) {
    const q = ensure(Number(r.ano), Number(r.trimestre));
    q.ativoTotal = num(r.ativo_total);
    q.ativoCirculante = num(r.ativo_circulante);
    q.caixa = num(r.caixa);
  }

  for (const r of d
    .prepare(
      'SELECT ano, trimestre, patrimonio_liquido, passivo_circulante, passivo_nao_circ, divida_cp, divida_lp FROM bpp_trimestral WHERE cd_cvm = ?'
    )
    .all(cdCvm) as Record<string, unknown>[]) {
    const q = ensure(Number(r.ano), Number(r.trimestre));
    q.patrimonioLiquido = num(r.patrimonio_liquido);
    q.passivoCirculante = num(r.passivo_circulante);
    q.passivoNaoCirc = num(r.passivo_nao_circ);
    q.dividaCp = num(r.divida_cp);
    q.dividaLp = num(r.divida_lp);
  }

  for (const r of d
    .prepare(
      'SELECT ano, trimestre, fco, capex, fcf, dividendos_pagos, jcp_pagos FROM dfc_trimestral WHERE cd_cvm = ?'
    )
    .all(cdCvm) as Record<string, unknown>[]) {
    const q = ensure(Number(r.ano), Number(r.trimestre));
    q.fco = num(r.fco);
    q.capex = num(r.capex);
    q.fcf = num(r.fcf);
    q.dividendosPagos = num(r.dividendos_pagos);
    q.jcpPagos = num(r.jcp_pagos);
  }

  for (const r of d
    .prepare(
      'SELECT ano, trimestre, margem_bruta, margem_ebit, margem_ebitda, margem_liquida, roe, roa, endividamento, liquidez_corrente, divida_pl FROM indicadores WHERE cd_cvm = ?'
    )
    .all(cdCvm) as Record<string, unknown>[]) {
    const q = ensure(Number(r.ano), Number(r.trimestre));
    q.margemBruta = num(r.margem_bruta);
    q.margemEbit = num(r.margem_ebit);
    q.margemEbitda = num(r.margem_ebitda);
    q.margemLiquida = num(r.margem_liquida);
    q.roe = num(r.roe);
    q.roa = num(r.roa);
    q.endividamento = num(r.endividamento);
    q.liquidezCorrente = num(r.liquidez_corrente);
    q.dividaPl = num(r.divida_pl);
  }

  return Array.from(byKey.values()).sort(
    (a, b) => a.ano - b.ano || a.trimestre - b.trimestre
  );
}

export function getShareCapital(cdCvm: string): CvmShareCapital[] {
  const rows = getDb()
    .prepare(
      'SELECT ano, trimestre, acoes_total, acoes_on, acoes_pn, qt_on, qt_pn, qt_total, qt_tesouraria FROM capital_social WHERE cd_cvm = ? ORDER BY ano, trimestre'
    )
    .all(cdCvm) as Record<string, unknown>[];
  return rows.map((r) => ({
    ano: Number(r.ano),
    trimestre: Number(r.trimestre),
    acoesTotal: num(r.acoes_total),
    acoesOn: num(r.acoes_on),
    acoesPn: num(r.acoes_pn),
    qtOn: num(r.qt_on),
    qtPn: num(r.qt_pn),
    qtTotal: num(r.qt_total),
    qtTesouraria: num(r.qt_tesouraria),
  }));
}
