/**
 * Contexto de dados para os agentes da WR Trading Pro.
 *
 * Injeta dados reais da plataforma (fundamentos CVM, dividendos,
 * carteira vigente) nos prompts dos agentes, substituindo respostas
 * genéricas por análises sobre os dados do usuário.
 */
import {
  listCompanies,
  getQuarters,
  getShareCapital,
  getCompany,
  CVM_LEGACY_PROVENANCE,
  type CvmCompany,
  type CvmQuarter,
} from './server/cvm-legacy-db';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

let _db: DatabaseSync | null = null;
function getDb(): DatabaseSync {
  if (_db) return _db;
  const file = path.join(process.cwd(), 'data', 'cvm', 'cvm_fundamentos.db');
  _db = new DatabaseSync(file, { readOnly: true });
  return _db;
}

// ── Tipos ──────────────────────────────────────────────────────────

export interface AgentDataContext {
  /** Data de referência dos dados (knowledgeTime). */
  asOf: string;
  /** Resumo do mercado/portfólio em formato textual para o prompt. */
  portfolioSummary: string;
  /** Fundamentos dos tickers relevantes (compacto). */
  fundamentals: string;
  /** Histórico de dividendos/JCP. */
  dividends: string;
  /** Metadados de proveniência. */
  provenance: typeof CVM_LEGACY_PROVENANCE;
}

// ── Helpers ────────────────────────────────────────────────────────

const BRL = (v: number | null, scale: 'mi' | 'bi' = 'mi'): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'N/D';
  const d = scale === 'bi' ? 1e9 : 1e6;
  const s = scale === 'bi' ? 'bi' : 'mi';
  return `R$ ${(v / d).toFixed(1)} ${s}`;
};

const PCT = (v: number | null): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'N/D';
  return `${(v * 100).toFixed(1)}%`;
};

/** Último trimestre disponível nos dados. */
function latestQuarter(quarters: CvmQuarter[]): CvmQuarter | null {
  if (quarters.length === 0) return null;
  return quarters.reduce((a, b) =>
    a.ano > b.ano || (a.ano === b.ano && a.trimestre > b.trimestre) ? a : b
  );
}

/** Soma dos últimos 4 trimestres (12 meses). */
function trailing12m(quarters: CvmQuarter[], field: keyof CvmQuarter): number | null {
  const sorted = [...quarters].sort(
    (a, b) => b.ano - a.ano || b.trimestre - a.trimestre
  );
  const t4 = sorted.slice(0, 4);
  if (t4.length < 4) return null;
  let sum = 0;
  for (const q of t4) {
    const v = q[field];
    if (v === null || v === undefined || !Number.isFinite(v as number)) return null;
    sum += v as number;
  }
  return sum;
}

// ── Tickers da carteira 12 vigente ─────────────────────────────────

const PORTFOLIO_TICKERS = [
  'VIVA3', 'CXSE3', 'BBSE3', 'ENGI11', 'LAVV3', 'TRIS3',
  'LEVE3', 'GRND3', 'ALUP11', 'SHUL4', 'VIVT3', 'INTB3',
];

// ── Queries de dividendos e score ──────────────────────────────────

interface DividendRow {
  ano: number;
  trimestre: number;
  dividendos: number | null;
  jcp: number | null;
}

function getDividends(cdCvm: string): DividendRow[] {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT ano, trimestre, dividendos_mil, jcp_mil
       FROM dividendos_jcp_dmpl
       WHERE cd_cvm = ?
       ORDER BY ano, trimestre`
    )
    .all(cdCvm) as Record<string, unknown>[];
  return rows.map((r) => ({
    ano: Number(r.ano),
    trimestre: Number(r.trimestre),
    dividendos: typeof r.dividendos_mil === 'number' ? (r.dividendos_mil as number) * 1000 : null,
    jcp: typeof r.jcp_mil === 'number' ? (r.jcp_mil as number) * 1000 : null,
  }));
}

// ── Construção do contexto ─────────────────────────────────────────

function buildTickerContext(ticker: string, company: CvmCompany): string {
  const quarters = getQuarters(company.cdCvm);
  const latest = latestQuarter(quarters);
  const dividends = getDividends(company.cdCvm);
  const capital = getShareCapital(company.cdCvm);

  if (!latest) return `  ${ticker} (${company.nome}): sem dados disponíveis.`;

  const t12_receita = trailing12m(quarters, 'receitaLiquida');
  const t12_lucro = trailing12m(quarters, 'lucroLiquido');

  // Últimos 4 trimestres de dividendos
  const recentDivs = dividends.slice(-4);
  const totalDiv12m = recentDivs.reduce(
    (sum, d) => sum + (d.dividendos ?? 0) + (d.jcp ?? 0),
    0
  );

  let block = `  **${ticker}** — ${company.nome} (${company.setor ?? 'setor não informado'})\n`;
  block += `    Último trimestre: ${latest.ano}T${latest.trimestre}\n`;
  block += `    Receita Líquida 12m: ${BRL(t12_receita, 'bi')} | Lucro Líquido 12m: ${BRL(t12_lucro, 'bi')}\n`;
  block += `    Margem Líquida: ${PCT(latest.margemLiquida)} | ROE: ${PCT(latest.roe)}\n`;
  if (latest.ebitda) {
    block += `    EBITDA: ${BRL(latest.ebitda, 'bi')} | Margem EBITDA: ${PCT(latest.margemEbitda)}\n`;
    block += `    Dívida/PL: ${latest.dividaPl !== null ? (latest.dividaPl).toFixed(2) : 'N/D'}\n`;
  }
  if (totalDiv12m > 0) {
    block += `    Dividendos+JCP 12m: ${BRL(totalDiv12m)}`;
    if (latest.lucroLiquido) {
      const payout = t12_lucro ? (totalDiv12m / t12_lucro * 100).toFixed(0) : 'N/D';
      block += ` | Payout: ~${payout}%`;
    }
    block += '\n';
  }
  // Capital social (quantidade de ações)
  const lastCap = capital.length > 0 ? capital[capital.length - 1] : null;
  if (lastCap?.acoesTotal) {
    block += `    Ações: ${(lastCap.acoesTotal / 1e6).toFixed(0)} mi`;
    if (lastCap.acoesOn) block += ` (ON: ${(lastCap.acoesOn / 1e6).toFixed(0)} mi)`;
    if (lastCap.acoesPn) block += ` (PN: ${(lastCap.acoesPn / 1e6).toFixed(0)} mi)`;
    block += '\n';
  }

  return block;
}

// ── Export principal ───────────────────────────────────────────────

/**
 * Constrói o contexto de dados da plataforma para injeção nos prompts
 * dos agentes. Inclui carteira vigente, fundamentos CVM, dividendos e
 * scores de qualidade.
 */
export function buildAgentContext(): AgentDataContext {
  const companies = listCompanies();
  const portfolio = companies.filter((c) => PORTFOLIO_TICKERS.includes(c.ticker));
  const others = companies.filter((c) => !PORTFOLIO_TICKERS.includes(c.ticker));

  // Resumo da carteira
  let portfolioSummary = '## Carteira 12 Dividendos/JCP (vigente)\n';
  portfolioSummary += 'Carteira atual da WR Trading Pro (12 ativos, peso ~8,3% cada):\n\n';
  for (const c of portfolio) {
    portfolioSummary += `- ${c.ticker} — ${c.nome} (${c.setor ?? 'setor não informado'})\n`;
  }
  portfolioSummary += `\nTotal: ${portfolio.length} ativos em ${new Set(portfolio.map(c => c.setor)).size} setores.\n`;

  // Fundamentos da carteira (detalhado)
  let fundamentals = '## Fundamentos CVM — Carteira Vigente\n';
  for (const c of portfolio) {
    fundamentals += buildTickerContext(c.ticker, c) + '\n';
  }

  // Dividendos
  let dividends = '## Proventos (Dividendos + JCP)\n';
  dividends += 'Fonte: DMPL/DFC — CVM. Valores declarados, não necessariamente pagos no trimestre.\n\n';
  for (const c of portfolio) {
    const divs = getDividends(c.cdCvm);
    if (divs.length === 0) continue;
    const last4 = divs.slice(-4);
    const total = last4.reduce((s, d) => s + (d.dividendos ?? 0) + (d.jcp ?? 0), 0);
    if (total > 0) {
      dividends += `- ${c.ticker}: ${BRL(total)} nos últimos 4 trimestres\n`;
    }
  }

  // Período
  const allQuarters = portfolio.flatMap((c) => getQuarters(c.cdCvm));
  const maxQuarter = allQuarters.length > 0
    ? allQuarters.reduce((a, b) =>
        a.ano > b.ano || (a.ano === b.ano && a.trimestre > b.trimestre) ? a : b
      )
    : null;

  return {
    asOf: maxQuarter?.dataRef ?? new Date().toISOString().slice(0, 10),
    portfolioSummary,
    fundamentals,
    dividends,
    provenance: CVM_LEGACY_PROVENANCE,
  };
}

/**
 * Constrói o contexto para UM ticker específico (não necessariamente
 * da carteira). Útil para runs de RESEARCH com ticker no input.
 */
export function buildSingleTickerContext(ticker: string): {
  context: string;
  company: CvmCompany | null;
} {
  const companies = listCompanies();
  const company = companies.find(
    (c) => c.ticker.toUpperCase() === ticker.toUpperCase()
  );
  if (!company) return { context: `Ticker ${ticker} não encontrado na base CVM.`, company: null };

  let ctx = `## Dados CVM para ${company.ticker} — ${company.nome}\n`;
  ctx += `Setor: ${company.setor ?? 'não informado'}\n\n`;
  ctx += buildTickerContext(company.ticker, company);

  return { context: ctx, company };
}

/**
 * Constrói um contexto textual compacto para injeção no prompt do
 * agente. Este é o ponto de entrada usado pelo runtime.
 *
 * @param ticker Opcional — se fornecido, inclui dados detalhados
 *   desse ticker específico. Se omitido, usa o contexto da carteira.
 */
export function buildPromptContext(ticker?: string): string {
  const base = buildAgentContext();
  let text = '';

  if (ticker) {
    const single = buildSingleTickerContext(ticker);
    if (single.company) {
      text += single.context + '\n';
    }
  }

  text += base.portfolioSummary + '\n';
  text += base.fundamentals + '\n';
  text += base.dividends + '\n';
  text += `---\n`;
  text += `Dados em: ${base.asOf}. `;
  text += `Fonte: ${base.provenance.source}. `;
  text += `${base.provenance.note}\n`;

  return text;
}
