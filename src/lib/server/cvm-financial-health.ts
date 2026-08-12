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
  scoreCompany,
  rankCompanies,
  MIN_QUARTERS,
  RECENT_QUARTERS,
  HEALTH_THRESHOLDS,
  type CompanyHealth,
  type QuarterInput,
  type CompanyBase,
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
  const rows = getDb().prepare(QUERY).all() as unknown as Record<string, unknown>[];

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
      ano,
      trimestre,
      knowledgeDate: iso,
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
        ticker,
        nome: base.nome,
        motivo: 'SETOR_FINANCEIRO',
        detalhe: `${base.setorCvm} — critérios de liquidez e alavancagem não têm o mesmo significado no setor`,
      });
      continue;
    }
    const health = scoreCompany(base, quarters.get(ticker)!);
    if (health === null) {
      const n = quarters.get(ticker)!.length;
      excluidas.push({
        ticker,
        nome: base.nome,
        motivo: 'HISTORICO_INSUFICIENTE',
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
