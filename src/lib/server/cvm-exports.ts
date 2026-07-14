/**
 * Acesso read-only aos exports analíticos do lab CVM — WR Trading Pro
 *
 * Fonte: data/cvm/exports/*.csv (snapshot 2026-07-14 do pipeline do lab no
 * WSL; ver data/cvm/README.md e o inventário no vault). Dados DERIVADOS,
 * sem point-in-time — mesma proveniência do banco cvm_fundamentos.db.
 *
 * Parser CSV próprio (RFC 4180: aspas, vírgulas em campos, CRLF) + cache em
 * memória por arquivo. Nenhuma escrita.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const EXPORTS_DIR = () => path.join(process.cwd(), 'data', 'cvm', 'exports');

// ---------------------------------------------------------------------------
// Parser CSV (RFC 4180)
// ---------------------------------------------------------------------------

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

type CsvRecord = Record<string, string>;

const fileCache = new Map<string, CsvRecord[]>();

function loadCsv(fileName: string): CsvRecord[] {
  const cached = fileCache.get(fileName);
  if (cached) return cached;

  const file = path.join(EXPORTS_DIR(), fileName);
  if (!existsSync(file)) {
    throw new Error(`Export CVM não encontrado: ${file}. Ver data/cvm/README.md.`);
  }
  const rows = parseCsv(readFileSync(file, 'utf8'));
  if (rows.length === 0) return [];
  const header = rows[0];
  const records = rows.slice(1).map((r) => {
    const rec: CsvRecord = {};
    for (let i = 0; i < header.length; i++) rec[header[i]] = r[i] ?? '';
    return rec;
  });
  fileCache.set(fileName, records);
  return records;
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: string | undefined): string | null => (v ? v : null);

// ---------------------------------------------------------------------------
// Score de qualidade de dividendos (138 empresas)
// ---------------------------------------------------------------------------

export interface DividendQuality {
  ticker: string;
  score: number | null;
  classe: string | null;
  scoreRecorrencia: number | null;
  scoreCrescimento: number | null;
  scorePayout: number | null;
  scoreCoberturaCaixa: number | null;
  scoreSaudeFinanceira: number | null;
  scoreResiliencia: number | null;
  scoreYieldPreco: number | null;
  alertas: string | null;
  dadosInsuficientes: boolean;
}

export function getDividendQualityRanking(): DividendQuality[] {
  return loadCsv('dividend_quality_score.csv')
    .map((r) => ({
      ticker: r.ticker,
      score: num(r.score_qualidade_dividendos),
      classe: str(r.classe_qualidade_dividendos),
      scoreRecorrencia: num(r.score_recorrencia),
      scoreCrescimento: num(r.score_crescimento),
      scorePayout: num(r.score_payout),
      scoreCoberturaCaixa: num(r.score_cobertura_caixa),
      scoreSaudeFinanceira: num(r.score_saude_financeira),
      scoreResiliencia: num(r.score_resiliencia),
      scoreYieldPreco: num(r.score_yield_preco),
      alertas: str(r.alertas_dividendos),
      dadosInsuficientes: r.dados_insuficientes_flag === '1',
    }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

// ---------------------------------------------------------------------------
// Carteira 12 dividendos/JCP
// ---------------------------------------------------------------------------

export interface PortfolioPosition {
  ticker: string;
  nome: string | null;
  macroSetor: string | null;
  gateMonteCarlo: string | null;
  scoreQualidade: number | null;
  scoreFinal: number | null;
  saudeFinanceira: number | null;
  pesoSugeridoPct: number | null;
  racional: string | null;
}

export function getPortfolio12(): PortfolioPosition[] {
  return loadCsv('portfolio_12_dividendos_jcp.csv')
    .map((r) => ({
      ticker: r.ticker,
      nome: str(r.nome),
      macroSetor: str(r.macro_setor),
      gateMonteCarlo: str(r.gate_monte_carlo),
      scoreQualidade: num(r.score_qualidade_dividendos),
      scoreFinal: num(r.score_final),
      saudeFinanceira: num(r.financial_health_score),
      pesoSugeridoPct: num(r.peso_sugerido_pct),
      racional: str(r.racional_resumido),
    }))
    .sort((a, b) => (b.scoreQualidade ?? -1) - (a.scoreQualidade ?? -1));
}

// ---------------------------------------------------------------------------
// Saúde financeira — último período por ticker (arquivo grande, 1 passada)
// ---------------------------------------------------------------------------

export interface FinancialHealth {
  ticker: string;
  periodo: string;
  score: number | null;
  classificacao: string | null;
}

let healthCache: Map<string, FinancialHealth> | null = null;

export function getFinancialHealthLatest(): Map<string, FinancialHealth> {
  if (healthCache) return healthCache;
  const byTicker = new Map<string, { ord: number; fh: FinancialHealth }>();
  for (const r of loadCsv('financial_health_scores.csv')) {
    const ord = num(r.periodo_ord) ?? 0;
    const prev = byTicker.get(r.ticker);
    if (prev && prev.ord >= ord) continue;
    byTicker.set(r.ticker, {
      ord,
      fh: {
        ticker: r.ticker,
        periodo: `${r.ano}T${r.trimestre}`,
        score: num(r.financial_health_score),
        classificacao: str(r.financial_health_classification),
      },
    });
  }
  healthCache = new Map(Array.from(byTicker.entries()).map(([t, v]) => [t, v.fh]));
  // O arquivo bruto (11 MB) não precisa ficar em cache — só o resumo.
  fileCache.delete('financial_health_scores.csv');
  return healthCache;
}

// ---------------------------------------------------------------------------
// Monte Carlo (carteira)
// ---------------------------------------------------------------------------

export interface MonteCarloResult {
  ticker: string;
  probSustentavel: number | null;
  probDistress: number | null;
  classificacao: string | null;
}

export function getMonteCarloByTicker(): Map<string, MonteCarloResult> {
  const map = new Map<string, MonteCarloResult>();
  for (const r of loadCsv('monte_carlo_sustainability.csv')) {
    map.set(r.ticker, {
      ticker: r.ticker,
      probSustentavel: num(r.mc_prob_sustainable),
      probDistress: num(r.mc_prob_distress),
      classificacao: str(r.mc_classificacao),
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Dividendos/JCP por empresa
// ---------------------------------------------------------------------------

export interface DividendQuarter {
  ano: number;
  trimestre: number;
  dataRef: string | null;
  dividendosPagos: number | null;
  jcpPagos: number | null;
  proventosSaidaCaixa: number | null;
}

export function getDividendQuarters(ticker: string): DividendQuarter[] {
  return loadCsv('dividendos_jcp_por_trimestre.csv')
    .filter((r) => r.ticker === ticker)
    .map((r) => ({
      ano: num(r.ano) ?? 0,
      trimestre: num(r.trimestre) ?? 0,
      dataRef: str(r.data_ref),
      dividendosPagos: num(r.dividendos_pagos),
      jcpPagos: num(r.jcp_pagos),
      proventosSaidaCaixa: num(r.proventos_saida_caixa),
    }))
    .sort((a, b) => a.ano - b.ano || a.trimestre - b.trimestre);
}

export interface DividendSummary {
  ticker: string;
  primeiroAno: number | null;
  ultimoAno: number | null;
  totalProventosSaidaCaixa: number | null;
}

export function getDividendSummary(ticker: string): DividendSummary | null {
  const r = loadCsv('dividendos_jcp_resumo_por_empresa.csv').find((x) => x.ticker === ticker);
  if (!r) return null;
  return {
    ticker: r.ticker,
    primeiroAno: num(r.primeiro_ano),
    ultimoAno: num(r.ultimo_ano),
    totalProventosSaidaCaixa: num(r.total_proventos_saida_caixa),
  };
}
