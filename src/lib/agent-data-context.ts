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
  CVM_LEGACY_PROVENANCE,
  type CvmCompany,
  type CvmQuarter,
} from './server/cvm-legacy-db';
import { getDividendQuarters, getPortfolio12 } from './server/cvm-exports';

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

// ATENÇÃO: os indicadores do banco (roe, margens, divida_pl, endividamento)
// JÁ ESTÃO em percentual (ex.: roe=8.9 significa 8,9%). Não multiplicar por
// 100 — esse bug injetava "ROE de 890%" nos prompts e contaminava as análises.
const PCT = (v: number | null): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'N/D';
  return `${v.toFixed(1)}%`;
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

// Fallback apenas para quando o export da carteira não estiver disponível;
// a fonte primária é o CSV vigente (getPortfolio12), que acompanha as
// regenerações do pipeline sem exigir mudança de código.
const PORTFOLIO_TICKERS_FALLBACK = [
  'VIVA3', 'CXSE3', 'BBSE3', 'ENGI11', 'LAVV3', 'TRIS3',
  'LEVE3', 'GRND3', 'ALUP11', 'SHUL4', 'VIVT3', 'INTB3',
];

function portfolioTickers(): string[] {
  try {
    const tickers = getPortfolio12().map((p) => p.ticker);
    return tickers.length > 0 ? tickers : PORTFOLIO_TICKERS_FALLBACK;
  } catch {
    return PORTFOLIO_TICKERS_FALLBACK;
  }
}

// ── Proventos (fonte validada: série trimestral da DFC nos exports) ─

interface DividendRow {
  ano: number;
  trimestre: number;
  /** Saída de caixa com dividendos+JCP no trimestre (valor positivo). */
  proventos: number | null;
}

// A tabela dividendos_jcp_dmpl do banco tem apenas 1 registro/ano com
// valores inconsistentes de escala — usar a série trimestral validada
// (mesma fonte da aba Fundamentos CVM), indexada por ticker.
function getDividends(ticker: string): DividendRow[] {
  try {
    return getDividendQuarters(ticker).map((q) => ({
      ano: q.ano,
      trimestre: q.trimestre,
      proventos: q.proventosSaidaCaixa,
    }));
  } catch {
    return [];
  }
}

// ── Construção do contexto ─────────────────────────────────────────

function buildTickerContext(ticker: string, company: CvmCompany): string {
  const quarters = getQuarters(company.cdCvm);
  const latest = latestQuarter(quarters);
  const dividends = getDividends(ticker);
  const capital = getShareCapital(company.cdCvm);

  if (!latest) return `  ${ticker} (${company.nome}): sem dados disponíveis.`;

  const t12_receita = trailing12m(quarters, 'receitaLiquida');
  const t12_lucro = trailing12m(quarters, 'lucroLiquido');

  // Últimos 4 trimestres de proventos (saída de caixa real, fonte DFC)
  const recentDivs = dividends.slice(-4);
  const totalDiv12m = recentDivs.reduce((sum, d) => sum + (d.proventos ?? 0), 0);

  let block = `  **${ticker}** — ${company.nome} (${company.setor ?? 'setor não informado'})\n`;
  block += `    Último trimestre: ${latest.ano}T${latest.trimestre}\n`;
  block += `    Receita Líquida 12m: ${BRL(t12_receita, 'bi')} | Lucro Líquido 12m: ${BRL(t12_lucro, 'bi')}\n`;
  block += `    Margem Líquida: ${PCT(latest.margemLiquida)} | ROE (trimestre): ${PCT(latest.roe)}\n`;
  if (latest.ebitda) {
    block += `    EBITDA: ${BRL(latest.ebitda, 'bi')} | Margem EBITDA: ${PCT(latest.margemEbitda)}\n`;
    block += `    Dívida/PL: ${PCT(latest.dividaPl)}\n`;
  }
  if (totalDiv12m > 0) {
    block += `    Dividendos+JCP 12m (saída de caixa): ${BRL(totalDiv12m)}`;
    if (t12_lucro && t12_lucro > 0) {
      block += ` | Payout 12m: ~${((totalDiv12m / t12_lucro) * 100).toFixed(0)}%`;
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
  const tickers = portfolioTickers();
  const portfolio = companies.filter((c) => tickers.includes(c.ticker));

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
  dividends += 'Fonte: DFC — CVM (saída de caixa efetiva por trimestre).\n\n';
  for (const c of portfolio) {
    const divs = getDividends(c.ticker);
    if (divs.length === 0) continue;
    const last4 = divs.slice(-4);
    const total = last4.reduce((s, d) => s + (d.proventos ?? 0), 0);
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

// ── Fatias de contexto por papel do comitê ─────────────────────────
//
// Cada papel do comitê recebe apenas a fatia de dados do seu mandato
// (spec 2026-07-15): prompt + fatia ≤ ~2–3 mil tokens para caber no
// num_ctx=8192 do Ollama local. O resumo da carteira inteira NÃO entra
// nos papéis focados — vira ruído e estoura contexto.

function findCompanyByTicker(ticker: string): CvmCompany | null {
  return (
    listCompanies().find((c) => c.ticker.toUpperCase() === ticker.toUpperCase()) ?? null
  );
}

function lastQuarters(quarters: CvmQuarter[], n: number): CvmQuarter[] {
  return [...quarters]
    .sort((a, b) => a.ano - b.ano || a.trimestre - b.trimestre)
    .slice(-n);
}

function fundamentalistaContext(ticker: string, company: CvmCompany): string {
  let ctx = buildSingleTickerContext(ticker).context;
  const q8 = lastQuarters(getQuarters(company.cdCvm), 8);
  ctx += '\n## Evolução trimestral (últimos 8 trimestres)\n';
  for (const q of q8) {
    ctx += `- ${q.ano}T${q.trimestre}: receita ${BRL(q.receitaLiquida, 'bi')} | lucro ${BRL(q.lucroLiquido, 'bi')} | margem líq. ${PCT(q.margemLiquida)} | ROE ${PCT(q.roe)}\n`;
  }
  return ctx;
}

function dividendosContext(ticker: string, company: CvmCompany): string {
  let ctx = `## Dados de proventos para ${company.ticker} — ${company.nome} (${company.setor ?? 'setor não informado'})\n\n`;
  const divs = getDividends(company.ticker);
  const last20 = divs.slice(-20); // ~5 anos
  ctx += '## Proventos por trimestre (saída de caixa, fonte DFC/CVM)\n';
  if (last20.length === 0) {
    ctx += '- Sem registros de proventos na base.\n';
  }
  for (const d of last20) {
    ctx += `- ${d.ano}T${d.trimestre}: ${BRL(d.proventos)}\n`;
  }
  const quarters = getQuarters(company.cdCvm);
  const t12lucro = trailing12m(quarters, 'lucroLiquido');
  const total4 = divs.slice(-4).reduce((s, d) => s + (d.proventos ?? 0), 0);
  if (total4 > 0) {
    ctx += `\nProventos 12m: ${BRL(total4)}`;
    if (t12lucro && t12lucro > 0) {
      ctx += ` | Lucro 12m: ${BRL(t12lucro, 'bi')} | Payout 12m: ~${((total4 / t12lucro) * 100).toFixed(0)}%`;
    }
    ctx += '\n';
  }
  const inPortfolio = portfolioTickers().includes(company.ticker);
  ctx += inPortfolio
    ? 'O ativo PERTENCE à carteira 12 dividendos/JCP vigente da plataforma.\n'
    : 'O ativo NÃO pertence à carteira 12 dividendos/JCP vigente da plataforma.\n';
  return ctx;
}

function riscoContext(ticker: string, company: CvmCompany): string {
  let ctx = `## Indicadores de risco para ${company.ticker} — ${company.nome} (${company.setor ?? 'setor não informado'})\n\n`;
  const quarters = getQuarters(company.cdCvm);
  const latest = latestQuarter(quarters);
  if (latest) {
    ctx += `Último trimestre: ${latest.ano}T${latest.trimestre}\n`;
    ctx += `Dívida/PL: ${PCT(latest.dividaPl)} | Endividamento: ${PCT(latest.endividamento)} | Liquidez corrente: ${latest.liquidezCorrente !== null && Number.isFinite(latest.liquidezCorrente) ? latest.liquidezCorrente.toFixed(2) : 'N/D'}\n`;
  }
  const q8 = lastQuarters(quarters, 8);
  ctx += '\n## Margens por trimestre (volatilidade — últimos 8 trimestres)\n';
  for (const q of q8) {
    ctx += `- ${q.ano}T${q.trimestre}: margem líq. ${PCT(q.margemLiquida)} | margem EBITDA ${PCT(q.margemEbitda)}\n`;
  }
  // Concentração setorial da carteira vigente
  const tickers = portfolioTickers();
  const companies = listCompanies();
  const sameSector = tickers.filter((t) => {
    const c = companies.find((x) => x.ticker === t);
    return c?.setor !== null && c?.setor !== undefined && c.setor === company.setor;
  });
  ctx += `\nSetor "${company.setor ?? 'não informado'}" na carteira 12 vigente: ${sameSector.length} de ${tickers.length} ativos`;
  ctx += sameSector.length > 0 ? ` (${sameSector.join(', ')})\n` : '\n';
  return ctx;
}

/**
 * Fatia de contexto de dados para um papel do comitê (spec 2026-07-15).
 * Papel desconhecido cai no contexto genérico (`buildPromptContext`) —
 * retrocompatível com roles antigos como `analista-pesquisa`.
 */
export function buildRoleContext(roleKey: string, ticker: string): string {
  const company = findCompanyByTicker(ticker);
  if (!company) return `Ticker ${ticker} não encontrado na base CVM (138 empresas).`;
  switch (roleKey) {
    case 'fundamentalista-cvm':
      return fundamentalistaContext(ticker, company);
    case 'dividendos':
      return dividendosContext(ticker, company);
    case 'risco':
      return riscoContext(ticker, company);
    case 'cetico':
      // O material principal do cético são os pareceres dos colegas (via
      // reads); aqui só o compacto do ticker para checar números citados.
      return buildSingleTickerContext(ticker).context;
    default:
      return buildPromptContext(ticker);
  }
}
