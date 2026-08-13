/**
 * Acesso read-only às tabelas BCB (IFData) — WR Trading Pro
 *
 * Fonte: data/cvm/cvm_fundamentos.db, tabelas `bcb_prudencial_*` (12) e
 * `bcb_financeiro_*` (14). Sincronizadas a partir da fonte canônica local
 * (Guardião_Hermes/WSL) por scripts/bcb-sync/sync-bcb-snapshot.cjs — ver
 * esse script e docs/architecture/phase-bcb-wr-integration.md para
 * proveniência completa.
 *
 * REGRAS DE IDENTIDADE E DADOS (não violar):
 *  - Ticker NUNCA é chave prudencial única — toda consulta usa
 *    (cd_cvm, data_base) ou (cod_inst, data_base), nunca ticker isolado
 *    como chave primária de agregação.
 *  - Prudencial (tipo_instituicao 1004/1009) e financeiro (1005) usam
 *    códigos de conglomerado (`cod_inst`) DIFERENTES — nunca são
 *    combinados/misturados num mesmo agregado ou JOIN direto por cod_inst.
 *  - Ausência de dado é NULL, nunca 0 — um pilar sem métrica não é
 *    "métrica zero".
 *  - Este módulo é SOMENTE LEITURA (node:sqlite, readOnly: true) e não
 *    calcula ranking, sinal, recomendação ou estratégia de trading —
 *    isso está fora do escopo desta integração por decisão de governança.
 *
 * Reusa a mesma conexão/arquivo de cvm-legacy-db.ts (mesmo banco), mas é
 * um módulo server-only separado para reduzir acoplamento: consumidores
 * de fundamentos CVM não precisam conhecer o schema BCB e vice-versa.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { existsSync } from 'node:fs';

export const BCB_PROVENANCE = {
  source: 'BCB/IFData (Banco Central do Brasil) — snapshot local via scripts/bcb-sync/sync-bcb-snapshot.cjs',
  fonteCampo: 'BCB_IFDATA',
  note:
    'Dados prudenciais (tipo_instituicao 1004 até 202306, 1009 a partir de 202309) e financeiros ' +
    '(tipo_instituicao 1005) publicados pelo BCB por conglomerado. Prudencial e financeiro usam ' +
    'códigos de conglomerado (cod_inst) DIFERENTES — nunca combinar num mesmo agregado. Valores ' +
    'monetários em BRL (campo `unidade`); percentuais/frações marcados como `ratio`. Datas-base no ' +
    'formato AAAAMM (fim de trimestre BCB), preservadas como publicadas.',
} as const;

/**
 * 27 tabelas bcb_* reproduzidas no destino (14 bcb_prudencial_* + 13 bcb_financeiro_*).
 * Uma primeira verificação por amostragem (só as *_resumo) havia sugerido 26 tabelas
 * (12+14); a contagem real via `sqlite_master` sobre TODAS as tabelas, feita ao
 * implementar este módulo, confirma 27 — batendo exatamente com o número da spec.
 * Não há divergência real; documentado aqui só para não reabrir essa dúvida depois.
 */
export const BCB_TABLE_COUNT_NOTE =
  'Contagem real via sqlite_master: 27 tabelas bcb_* (14 bcb_prudencial_* + 13 bcb_financeiro_*), ' +
  'batendo com a spec. Uma suposição anterior de "26" (12+14) não se confirmou ao contar todas as ' +
  'tabelas (não só as *_resumo).';

export const TIPO_INSTITUICAO_PRUDENCIAL = [1004, 1009] as const;
export const TIPO_INSTITUICAO_FINANCEIRO = [1005] as const;

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  const file = path.join(process.cwd(), 'data', 'cvm', 'cvm_fundamentos.db');
  if (!existsSync(file)) {
    throw new Error(
      `Banco de fundamentos CVM/BCB não encontrado em ${file}. Rode scripts/bcb-sync/sync-bcb-snapshot.cjs.`
    );
  }
  db = new DatabaseSync(file, { readOnly: true });
  return db;
}

/** Usado só por testes, para forçar reabertura após trocar o arquivo de banco. */
export function __resetBcbDbForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};

// ── Vínculo de identidade ────────────────────────────────────────────
//
// Não existe tabela física de vínculo ticker→instituição BCB na fonte —
// cada linha de bcb_prudencial_*/bcb_financeiro_* já carrega cd_cvm,
// ticker, cod_inst, tipo_instituicao, fonte. Este tipo é a PROJEÇÃO
// desses campos, não uma tabela nova.

export interface BcbEntityLink {
  cdCvm: string;
  ticker: string;
  /** CNPJ da companhia listada (fonte: empresas.cnpj, CVM). NULL se ausente. */
  cnpjCompanhia: string | null;
  nomeCompanhia: string;
  /** Código do conglomerado no BCB (prudencial e financeiro têm códigos DIFERENTES). */
  codInst: number;
  /** 1004/1009 (prudencial) ou 1005 (financeiro). */
  tipoInstituicao: number | null;
  perimetro: 'prudencial' | 'financeiro';
  /** Só existe no lado financeiro na fonte atual; NULL no prudencial (não inventado). */
  tipoConsolidacao: string | null;
  /**
   * CNPJ do líder do conglomerado e nome da entidade BCB: a fonte atual
   * não tem essas colunas como CNPJ real (só `cod_lider_bcb`, que o
   * schema-fonte documenta explicitamente como "código interno do BCB,
   * NÃO é CNPJ", e `nome_bcb`, presente só em bcb_prudencial_capital).
   * Ficam NULL/pendentes aqui — nunca adivinhados.
   */
  cnpjLiderBcb: string | null;
  nomeEntidadeBcb: string | null;
  fonte: string | null;
}

/**
 * Vínculo ticker → empresa/CNPJ → instituição/conglomerado BCB, derivado
 * via query (não é tabela física). Uma linha por (ticker, perímetro,
 * cod_inst) distintos observados nas tabelas *_resumo de cada família.
 */
export function getBcbEntityLinks(ticker?: string): BcbEntityLink[] {
  const d = getDb();
  const results: BcbEntityLink[] = [];

  const empresaWhere = ticker ? 'WHERE e.ticker = ?' : '';
  const empresaParams = ticker ? [ticker.toUpperCase()] : [];

  const prudRows = d
    .prepare(
      `SELECT DISTINCT p.cd_cvm, p.ticker, p.cod_inst, p.tipo_instituicao, p.fonte,
              e.cnpj, e.nome, c.nome_bcb, c.cod_lider_bcb
         FROM bcb_prudencial_resumo p
         JOIN empresas e ON e.cd_cvm = p.cd_cvm
         LEFT JOIN bcb_prudencial_capital c ON c.cd_cvm = p.cd_cvm AND c.data_base = p.data_base
         ${empresaWhere.replace('e.ticker', 'p.ticker')}`
    )
    .all(...empresaParams) as Record<string, unknown>[];

  for (const r of prudRows) {
    results.push({
      cdCvm: String(r.cd_cvm),
      ticker: String(r.ticker),
      cnpjCompanhia: str(r.cnpj),
      nomeCompanhia: String(r.nome),
      codInst: Number(r.cod_inst),
      tipoInstituicao: int(r.tipo_instituicao),
      perimetro: 'prudencial',
      tipoConsolidacao: null, // não existe no lado prudencial na fonte
      cnpjLiderBcb: null, // cod_lider_bcb NÃO é CNPJ (documentado no schema-fonte) — não reaproveitado como CNPJ
      nomeEntidadeBcb: str(r.nome_bcb),
      fonte: str(r.fonte),
    });
  }

  const finRows = d
    .prepare(
      `SELECT DISTINCT f.cd_cvm, f.ticker, f.cod_inst, f.tipo_instituicao, f.tipo_consolidacao, f.fonte,
              e.cnpj, e.nome
         FROM bcb_financeiro_resumo f
         JOIN empresas e ON e.cd_cvm = f.cd_cvm
         ${empresaWhere.replace('e.ticker', 'f.ticker')}`
    )
    .all(...empresaParams) as Record<string, unknown>[];

  for (const r of finRows) {
    results.push({
      cdCvm: String(r.cd_cvm),
      ticker: String(r.ticker),
      cnpjCompanhia: str(r.cnpj),
      nomeCompanhia: String(r.nome),
      codInst: Number(r.cod_inst),
      tipoInstituicao: int(r.tipo_instituicao),
      perimetro: 'financeiro',
      tipoConsolidacao: str(r.tipo_consolidacao),
      cnpjLiderBcb: null,
      nomeEntidadeBcb: null,
      fonte: str(r.fonte),
    });
  }

  return results;
}

// ── Dados prudenciais (1004/1009) ────────────────────────────────────

export interface BcbPrudencialCapitalRow {
  ticker: string;
  cdCvm: string;
  codInst: number;
  dataBase: number;
  ano: number;
  trimestre: number;
  tcb: string | null;
  td: string | null;
  segmentoSr: string | null;
  capitalPrincipalBrl: number | null;
  capitalNivelIBrl: number | null;
  patrimonioReferenciaBrl: number | null;
  rwaTotalBrl: number | null;
  indiceCapitalPrincipalPct: number | null;
  indiceCapitalNivelIPct: number | null;
  indiceBasileiaPct: number | null;
  razaoAlavancagemPct: number | null;
}

/** Dados prudenciais de capital/Basileia (tipo_instituicao 1004/1009) para um ticker. */
export function getBcbPrudencialCapital(ticker: string): BcbPrudencialCapitalRow[] {
  const rows = getDb()
    .prepare(
      `SELECT ticker, cd_cvm, cod_inst, data_base, ano, trimestre, tcb, td, segmento_sr,
              capital_principal_brl, capital_nivel_i_brl, patrimonio_referencia_brl, rwa_total_brl,
              indice_capital_principal_pct, indice_capital_nivel_i_pct, indice_basileia_pct, razao_alavancagem_pct
         FROM bcb_prudencial_capital WHERE ticker = ? ORDER BY data_base`
    )
    .all(ticker.toUpperCase()) as Record<string, unknown>[];
  return rows.map((r) => ({
    ticker: String(r.ticker),
    cdCvm: String(r.cd_cvm),
    codInst: Number(r.cod_inst),
    dataBase: Number(r.data_base),
    ano: Number(r.ano),
    trimestre: Number(r.trimestre),
    tcb: str(r.tcb),
    td: str(r.td),
    segmentoSr: str(r.segmento_sr),
    capitalPrincipalBrl: num(r.capital_principal_brl),
    capitalNivelIBrl: num(r.capital_nivel_i_brl),
    patrimonioReferenciaBrl: num(r.patrimonio_referencia_brl),
    rwaTotalBrl: num(r.rwa_total_brl),
    indiceCapitalPrincipalPct: num(r.indice_capital_principal_pct),
    indiceCapitalNivelIPct: num(r.indice_capital_nivel_i_pct),
    indiceBasileiaPct: num(r.indice_basileia_pct),
    razaoAlavancagemPct: num(r.razao_alavancagem_pct),
  }));
}

export interface BcbRotuloRow {
  ticker: string;
  cdCvm: string;
  codInst: number;
  dataBase: number;
  ano: number;
  trimestre: number;
  tipoInstituicao: number | null;
  grupo: string;
  rotulo: string;
  rotuloOriginal: string | null;
  valor: number | null;
  unidade: string | null;
  fonte: string | null;
}

function mapRotuloRow(r: Record<string, unknown>): BcbRotuloRow {
  return {
    ticker: String(r.ticker),
    cdCvm: String(r.cd_cvm),
    codInst: Number(r.cod_inst),
    dataBase: Number(r.data_base),
    ano: Number(r.ano),
    trimestre: Number(r.trimestre),
    tipoInstituicao: int(r.tipo_instituicao),
    grupo: String(r.grupo ?? ''),
    rotulo: String(r.rotulo),
    rotuloOriginal: str(r.rotulo_original),
    valor: num(r.valor),
    unidade: str(r.unidade),
    fonte: str(r.fonte),
  };
}

/** Resumo prudencial (EAV: rótulo/grupo/valor) — tipo_instituicao 1004/1009. */
export function getBcbPrudencialResumo(ticker: string): BcbRotuloRow[] {
  const rows = getDb()
    .prepare(
      `SELECT ticker, cd_cvm, cod_inst, data_base, ano, trimestre, tipo_instituicao,
              grupo, rotulo, rotulo_original, valor, unidade, fonte
         FROM bcb_prudencial_resumo WHERE ticker = ? ORDER BY data_base, grupo, rotulo`
    )
    .all(ticker.toUpperCase()) as Record<string, unknown>[];
  return rows.map(mapRotuloRow);
}

// ── Dados financeiros (1005) ─────────────────────────────────────────

/** Resumo financeiro (EAV: rótulo/grupo/valor) — tipo_instituicao 1005. */
export function getBcbFinanceiroResumo(ticker: string): BcbRotuloRow[] {
  const rows = getDb()
    .prepare(
      `SELECT ticker, cd_cvm, cod_inst, data_base, ano, trimestre, tipo_instituicao,
              grupo, rotulo, rotulo_original, valor, unidade, fonte
         FROM bcb_financeiro_resumo WHERE ticker = ? ORDER BY data_base, grupo, rotulo`
    )
    .all(ticker.toUpperCase()) as Record<string, unknown>[];
  return rows.map(mapRotuloRow);
}

export interface BcbFinanceiroCapitalRow {
  ticker: string;
  cdCvm: string;
  codInst: number;
  dataBase: number;
  ano: number;
  trimestre: number;
  tipoConsolidacao: string | null;
}

/** Ativo total (tipo_instituicao 1005) — rótulo publicado 'Ativo Total' (confirmado na fonte). */
export function getBcbFinanceiroAtivoTotal(ticker: string): BcbRotuloRow[] {
  const rows = getDb()
    .prepare(
      `SELECT ticker, cd_cvm, cod_inst, data_base, ano, trimestre, tipo_instituicao,
              grupo, rotulo, rotulo_original, valor, unidade, fonte
         FROM bcb_financeiro_ativo WHERE ticker = ? AND rotulo = 'Ativo Total' ORDER BY data_base`
    )
    .all(ticker.toUpperCase()) as Record<string, unknown>[];
  return rows.map(mapRotuloRow);
}

// ── Cobertura ─────────────────────────────────────────────────────────

export interface BcbCoverageRow {
  ticker: string;
  cdCvm: string;
  prudencial: { presente: boolean; primeiraDataBase: number | null; ultimaDataBase: number | null; trimestres: number };
  financeiro: { presente: boolean; primeiraDataBase: number | null; ultimaDataBase: number | null; trimestres: number };
}

const COVERAGE_TICKERS = [
  'ABCB4', 'BBAS3', 'BBDC4', 'BEES3', 'BMGB4', 'BPAC11', 'BRSR6', 'ITUB4', 'PINE4', 'SANB11',
] as const;

/**
 * Cobertura por banco/data/perímetro para os 10 tickers de referência
 * (ou o subconjunto passado). Nunca "inventa" cobertura: um ticker sem
 * linhas numa tabela aparece com presente=false, não com dado zerado.
 */
export function getBcbCoverage(tickers: readonly string[] = COVERAGE_TICKERS): BcbCoverageRow[] {
  const d = getDb();
  const out: BcbCoverageRow[] = [];
  for (const ticker of tickers) {
    const t = ticker.toUpperCase();
    const cdCvmRow = d.prepare('SELECT cd_cvm FROM empresas WHERE ticker = ?').get(t) as
      | { cd_cvm: string }
      | undefined;

    const prud = d
      .prepare(
        `SELECT MIN(data_base) AS minDb, MAX(data_base) AS maxDb, COUNT(DISTINCT data_base) AS n
           FROM bcb_prudencial_resumo WHERE ticker = ?`
      )
      .get(t) as { minDb: number | null; maxDb: number | null; n: number };
    const fin = d
      .prepare(
        `SELECT MIN(data_base) AS minDb, MAX(data_base) AS maxDb, COUNT(DISTINCT data_base) AS n
           FROM bcb_financeiro_resumo WHERE ticker = ?`
      )
      .get(t) as { minDb: number | null; maxDb: number | null; n: number };

    out.push({
      ticker: t,
      cdCvm: cdCvmRow ? String(cdCvmRow.cd_cvm) : '',
      prudencial: {
        presente: prud.n > 0,
        primeiraDataBase: int(prud.minDb),
        ultimaDataBase: int(prud.maxDb),
        trimestres: prud.n,
      },
      financeiro: {
        presente: fin.n > 0,
        primeiraDataBase: int(fin.minDb),
        ultimaDataBase: int(fin.maxDb),
        trimestres: fin.n,
      },
    });
  }
  return out;
}

export const BCB_COVERAGE_TICKERS = COVERAGE_TICKERS;
