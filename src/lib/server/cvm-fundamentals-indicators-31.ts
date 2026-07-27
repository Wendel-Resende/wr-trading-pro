/**
 * Cálculos puros dos indicadores da Ficha Fundamentalista que faltam em
 * `fundamental_indicators` (pipeline do Guardião). Espelha 1:1 as seções de
 * `docs/fundamentals-indicators-formulas-31.md`. Mantido separado de
 * `cvm-fundamentals-derive.ts` (toolkit já testado da ficha existente — bandas
 * de valuation, DuPont, conversão de caixa) para não misturar dois assuntos no
 * mesmo módulo. Sem I/O: quem busca dados em disco/Prisma é
 * `cvm-fundamentals-sheet.ts`.
 */

export interface IndicatorResult {
  value: number | null;
  note?: string;
}

/** Os 4 trimestres calendário terminando em (ano,trimestre), em ordem cronológica. */
export function last4Quarters(ano: number, trimestre: number): { ano: number; trimestre: number }[] {
  const out: { ano: number; trimestre: number }[] = [];
  let a = ano;
  let t = trimestre;
  for (let i = 0; i < 4; i++) {
    out.push({ ano: a, trimestre: t });
    t -= 1;
    if (t === 0) {
      t = 4;
      a -= 1;
    }
  }
  return out.reverse();
}

/**
 * Soma 12 meses rolling (trailing 12M) sobre uma série trimestral. Calendar-
 * aware, não por adjacência de array: calcula os 4 (ano,trimestre) exatos e
 * busca cada um por chave — um buraco real no meio (ex. ITUB4 2012T2/T3) não
 * vira soma parcial, vira `null` + motivo. Nunca fabrica.
 */
export function ttm12m(
  valuesByPeriod: ReadonlyMap<string, number | null>,
  ano: number,
  trimestre: number,
): { value: number | null; note?: 'HISTORICO_INSUFICIENTE' } {
  const quarters = last4Quarters(ano, trimestre);
  let sum = 0;
  for (const q of quarters) {
    const v = valuesByPeriod.get(`${q.ano}T${q.trimestre}`);
    if (v === undefined || v === null || !Number.isFinite(v)) {
      return { value: null, note: 'HISTORICO_INSUFICIENTE' };
    }
    sum += v;
  }
  return { value: sum };
}

export interface ShareCountRow {
  ano: number;
  trimestre: number;
  qtTotal: number | null;
  acoesTotal: number | null;
}

/**
 * Contagem de ações point-in-time: linha mais recente de `capital_social` com
 * (ano,trimestre) <= alvo (a tabela é esparsa — só tem linha quando o capital
 * muda). Prefere `qtTotal` (schema novo), cai para `acoesTotal` (schema
 * antigo — verificado que tickers legados só têm essa coluna preenchida).
 * Sem linha ou valor <= 0 -> null.
 */
export function resolveShareCount(
  rows: readonly ShareCountRow[],
  ano: number,
  trimestre: number,
): { value: number | null; asOfPeriod: { ano: number; trimestre: number } | null; note?: 'CONTAGEM_ACOES_INDISPONIVEL' } {
  const targetKey = ano * 10 + trimestre;
  let best: ShareCountRow | null = null;
  for (const r of rows) {
    const key = r.ano * 10 + r.trimestre;
    if (key <= targetKey && (!best || key > best.ano * 10 + best.trimestre)) {
      best = r;
    }
  }
  const value = best ? best.qtTotal ?? best.acoesTotal ?? null : null;
  if (best === null || value === null || value <= 0) {
    return { value: null, asOfPeriod: null, note: 'CONTAGEM_ACOES_INDISPONIVEL' };
  }
  return { value, asOfPeriod: { ano: best.ano, trimestre: best.trimestre } };
}

/**
 * Proventos pagos (dividendos + JCP) de um trimestre, para uso em `ttm12m`.
 * Soma abs()+abs() — NUNCA soma-depois-abs: `jcp_pagos` não segue um sinal de
 * saída de caixa consistente na fonte (verificado: ~38% dos pares não-nulos
 * têm sinais opostos entre `dividendos_pagos` e `jcp_pagos`), então somar
 * direto cancelaria valores e subestimaria o indicador silenciosamente.
 * Ambos ausentes -> null (nunca vira zero).
 */
export function combineProventos(dividendosPagos: number | null, jcpPagos: number | null): number | null {
  if (dividendosPagos === null && jcpPagos === null) return null;
  const d = dividendosPagos === null ? 0 : Math.abs(dividendosPagos);
  const j = jcpPagos === null ? 0 : Math.abs(jcpPagos);
  return d + j;
}

export interface DailyClose {
  time: Date;
  close: number;
}

/**
 * Último fechamento com `time <= target`, por busca binária, sobre uma série
 * já ordenada ascendente. Puro — quem busca os candles no Prisma é
 * `cvm-fundamentals-sheet.ts`. Sem candle antes do alvo (ou série vazia) -> null.
 */
export function closeAsOf(closes: readonly DailyClose[], target: Date): number | null {
  if (closes.length === 0) return null;
  const t = target.getTime();
  let lo = 0;
  let hi = closes.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (closes[mid].time.getTime() <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans === -1 ? null : closes[ans].close;
}

export type RatioRule = 'denominator-must-be-positive' | 'denominator-nonzero-any-sign';

/**
 * Divisão null-safe com duas regras nomeadas (não um boolean solto):
 * `denominator-must-be-positive` é o caso comum (denominador <= 0 -> null);
 * `denominator-nonzero-any-sign` só nula em denominador exatamente zero —
 * usada apenas pelo P/Ativo Circulante Líquido (1.9), que permite resultado
 * negativo por decisão explícita do doc-fonte.
 */
export function safeRatio(
  numerator: number | null,
  denominator: number | null,
  rule: RatioRule = 'denominator-must-be-positive',
): number | null {
  if (numerator === null || denominator === null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (rule === 'denominator-must-be-positive') {
    if (denominator <= 0) return null;
  } else if (denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

// --- 1.11 / 1.12 — por ação ------------------------------------------------

/** 1.11 LPA = Lucro Líquido (TTM) / nº de ações. Negativo permitido (prejuízo é válido mostrar). */
export function lucroPorAcao(lucroLiquidoTtm: number | null, shareCount: number | null): IndicatorResult {
  if (shareCount === null || shareCount <= 0) return { value: null, note: 'CONTAGEM_ACOES_INDISPONIVEL' };
  if (lucroLiquidoTtm === null) return { value: null, note: 'DADO_AUSENTE' };
  return { value: lucroLiquidoTtm / shareCount };
}

/** 1.12 VPA = Patrimônio Líquido / nº de ações. PL <= 0 -> null. */
export function valorPatrimonialPorAcao(patrimonioLiquido: number | null, shareCount: number | null): IndicatorResult {
  if (shareCount === null || shareCount <= 0) return { value: null, note: 'CONTAGEM_ACOES_INDISPONIVEL' };
  if (patrimonioLiquido === null) return { value: null, note: 'DADO_AUSENTE' };
  if (patrimonioLiquido <= 0) return { value: null, note: 'PL_NAO_POSITIVO' };
  return { value: patrimonioLiquido / shareCount };
}

// --- 1.1-1.3, 1.7-1.10 — múltiplos de preço --------------------------------

/** 1.1 P/L = Preço / LPA. LPA <= 0 (prejuízo) -> null. */
export function precoLucro(preco: number | null, lpa: number | null): IndicatorResult {
  if (preco === null || preco <= 0) return { value: null, note: 'PRECO_INDISPONIVEL' };
  if (lpa === null) return { value: null, note: 'DADO_AUSENTE' };
  if (lpa <= 0) return { value: null, note: 'LPA_NAO_POSITIVO' };
  return { value: preco / lpa };
}

/** 1.2 P/VP = Preço / VPA. VPA <= 0 -> null. */
export function precoValorPatrimonial(preco: number | null, vpa: number | null): IndicatorResult {
  if (preco === null || preco <= 0) return { value: null, note: 'PRECO_INDISPONIVEL' };
  if (vpa === null) return { value: null, note: 'DADO_AUSENTE' };
  if (vpa <= 0) return { value: null, note: 'VPA_NAO_POSITIVO' };
  return { value: preco / vpa };
}

/** 1.3 PSR = Preço / (Receita Líquida TTM / nº de ações). Receita <= 0 -> null. */
export function precoReceita(
  preco: number | null,
  receitaLiquidaTtm: number | null,
  shareCount: number | null,
): IndicatorResult {
  if (preco === null || preco <= 0) return { value: null, note: 'PRECO_INDISPONIVEL' };
  if (shareCount === null || shareCount <= 0) return { value: null, note: 'CONTAGEM_ACOES_INDISPONIVEL' };
  if (receitaLiquidaTtm === null) return { value: null, note: 'DADO_AUSENTE' };
  if (receitaLiquidaTtm <= 0) return { value: null, note: 'RECEITA_NAO_POSITIVA' };
  return { value: preco / (receitaLiquidaTtm / shareCount) };
}

/** 1.7 P/EBIT = Preço / (EBIT TTM / nº de ações). EBIT <= 0 -> null. */
export function precoEbit(preco: number | null, ebitTtm: number | null, shareCount: number | null): IndicatorResult {
  if (preco === null || preco <= 0) return { value: null, note: 'PRECO_INDISPONIVEL' };
  if (shareCount === null || shareCount <= 0) return { value: null, note: 'CONTAGEM_ACOES_INDISPONIVEL' };
  if (ebitTtm === null) return { value: null, note: 'DADO_AUSENTE' };
  if (ebitTtm <= 0) return { value: null, note: 'EBIT_NAO_POSITIVO' };
  return { value: preco / (ebitTtm / shareCount) };
}

/** 1.8 P/Ativo = Preço / (Ativo Total / nº de ações). Ativo <= 0 -> null. */
export function precoAtivo(preco: number | null, ativoTotal: number | null, shareCount: number | null): IndicatorResult {
  if (preco === null || preco <= 0) return { value: null, note: 'PRECO_INDISPONIVEL' };
  if (shareCount === null || shareCount <= 0) return { value: null, note: 'CONTAGEM_ACOES_INDISPONIVEL' };
  if (ativoTotal === null) return { value: null, note: 'DADO_AUSENTE' };
  if (ativoTotal <= 0) return { value: null, note: 'ATIVO_NAO_POSITIVO' };
  return { value: preco / (ativoTotal / shareCount) };
}

/**
 * 1.9 P/Ativo Circulante Líquido = Preço / (ACL / nº de ações), ACL = Ativo
 * Circulante - Passivo Circulante. EXCEÇÃO EXPLÍCITA DO DOC: ACL negativo é
 * PERMITIDO (resultado negativo, indica passivo circulante > ativo) — só nula
 * em ACL exatamente zero ou dado ausente. Ver `precoCapitalGiro` (1.10): MESMA
 * fórmula, regra de nulidade OPOSTA — a assimetria é intencional da spec-fonte
 * (Investidor10), não um bug; nunca "corrigir" as duas para ficarem iguais.
 */
export function precoAtivoCirculanteLiquido(
  preco: number | null,
  ativoCirculante: number | null,
  passivoCirculante: number | null,
  shareCount: number | null,
): IndicatorResult {
  if (preco === null || preco <= 0) return { value: null, note: 'PRECO_INDISPONIVEL' };
  if (shareCount === null || shareCount <= 0) return { value: null, note: 'CONTAGEM_ACOES_INDISPONIVEL' };
  if (ativoCirculante === null || passivoCirculante === null) return { value: null, note: 'DADO_AUSENTE' };
  const aclPorAcao = (ativoCirculante - passivoCirculante) / shareCount;
  const value = safeRatio(preco, aclPorAcao, 'denominator-nonzero-any-sign');
  return value === null ? { value: null, note: 'CAPITAL_GIRO_ZERO' } : { value };
}

/**
 * 1.10 P/Capital de Giro — MESMA fórmula de `precoAtivoCirculanteLiquido`
 * (1.9): Capital de Giro = Ativo Circulante - Passivo Circulante. Aqui, por
 * decisão explícita do doc, Capital de Giro <= 0 -> null (ao contrário de 1.9,
 * que permite negativo). Ver comentário em 1.9 — assimetria intencional.
 */
export function precoCapitalGiro(
  preco: number | null,
  ativoCirculante: number | null,
  passivoCirculante: number | null,
  shareCount: number | null,
): IndicatorResult {
  if (preco === null || preco <= 0) return { value: null, note: 'PRECO_INDISPONIVEL' };
  if (shareCount === null || shareCount <= 0) return { value: null, note: 'CONTAGEM_ACOES_INDISPONIVEL' };
  if (ativoCirculante === null || passivoCirculante === null) return { value: null, note: 'DADO_AUSENTE' };
  const capitalGiro = ativoCirculante - passivoCirculante;
  if (capitalGiro <= 0) return { value: null, note: 'CAPITAL_GIRO_NAO_POSITIVO' };
  return { value: preco / (capitalGiro / shareCount) };
}

// --- 4.1 — dividendos -------------------------------------------------------

/**
 * 4.1 DY = Proventos por ação (TTM) / Preço. `proventosPagosTtm` é o TOTAL
 * (R$) pago pela empresa em 12M (soma via `combineProventos`+`ttm12m`) —
 * dividido pelo nº de ações antes de dividir pelo preço, para não misturar
 * "total da empresa" com "preço por ação". Preço <= 0 -> null.
 */
export function dividendYield(
  proventosPagosTtm: number | null,
  shareCount: number | null,
  preco: number | null,
): IndicatorResult {
  if (preco === null || preco <= 0) return { value: null, note: 'PRECO_INDISPONIVEL' };
  if (shareCount === null || shareCount <= 0) return { value: null, note: 'CONTAGEM_ACOES_INDISPONIVEL' };
  if (proventosPagosTtm === null) return { value: null, note: 'DADO_AUSENTE' };
  return { value: proventosPagosTtm / shareCount / preco };
}

// --- 5.2-5.4, 5.7 — endividamento ------------------------------------------

/**
 * Dívida Líquida = Dívida Bruta (CP+LP) - Caixa. Não é um dos 31, mas alimenta
 * 5.3/5.4 (o pipeline só expõe a razão sobre EBITDA e a versão bruta/PL).
 * Pode ser NEGATIVA (posição de caixa líquido) — não é nulada por isso, só por
 * dado ausente.
 */
export function dividaLiquida(dividaCp: number | null, dividaLp: number | null, caixa: number | null): number | null {
  if (dividaCp === null || dividaLp === null || caixa === null) return null;
  return dividaCp + dividaLp - caixa;
}

/** 5.3 Dívida Líquida / EBIT. EBIT <= 0 -> null. Dívida líquida negativa (caixa líquido) é permitida. */
export function dividaLiquidaSobreEbit(dividaLiquidaValue: number | null, ebitTtm: number | null): IndicatorResult {
  if (dividaLiquidaValue === null || ebitTtm === null) return { value: null, note: 'DADO_AUSENTE' };
  if (ebitTtm <= 0) return { value: null, note: 'EBIT_NAO_POSITIVO' };
  return { value: dividaLiquidaValue / ebitTtm };
}

/** 5.4 Dívida Líquida / Patrimônio Líquido. PL <= 0 -> null. */
export function dividaLiquidaSobrePl(dividaLiquidaValue: number | null, patrimonioLiquido: number | null): IndicatorResult {
  if (dividaLiquidaValue === null || patrimonioLiquido === null) return { value: null, note: 'DADO_AUSENTE' };
  if (patrimonioLiquido <= 0) return { value: null, note: 'PL_NAO_POSITIVO' };
  return { value: dividaLiquidaValue / patrimonioLiquido };
}

/** 5.7 Passivo Total / Ativo Total. Não existe coluna `passivo_total` — soma circulante + não circulante. Ativo <= 0 -> null. */
export function passivoSobreAtivo(
  passivoCirculante: number | null,
  passivoNaoCirc: number | null,
  ativoTotal: number | null,
): IndicatorResult {
  if (passivoCirculante === null || passivoNaoCirc === null || ativoTotal === null) {
    return { value: null, note: 'DADO_AUSENTE' };
  }
  if (ativoTotal <= 0) return { value: null, note: 'ATIVO_NAO_POSITIVO' };
  return { value: (passivoCirculante + passivoNaoCirc) / ativoTotal };
}
