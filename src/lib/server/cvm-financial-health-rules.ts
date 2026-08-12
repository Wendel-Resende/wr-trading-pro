/**
 * Ranking de Saúde Financeira — REGRAS PURAS (sem I/O).
 *
 * Avalia cinco pilares por trimestre e agrega a consistência histórica.
 * Não lê banco, não faz rede: é o único ponto onde os limiares e a agregação
 * vivem, e é puro justamente para que um sinal invertido apareça no teste em
 * vez de virar um ranking plausível e falso.
 *
 * Spec: docs/superpowers/specs/2026-08-12-ranking-saude-financeira-design.md
 */

export type PillarKey = 'alavancagem' | 'liquidez' | 'juros' | 'lucro' | 'caixa';

export const PILLAR_KEYS: readonly PillarKey[] = Object.freeze([
  'alavancagem',
  'liquidez',
  'juros',
  'lucro',
  'caixa',
] as const);

export const PILLAR_LABELS: Readonly<Record<PillarKey, string>> = Object.freeze({
  alavancagem: 'Alavancagem',
  liquidez: 'Liquidez',
  juros: 'Juros',
  lucro: 'Lucro',
  caixa: 'Caixa',
});

/**
 * Limiares calibrados contra a distribuição real do banco (ver spec):
 * liquidez >= 1 aprova ~78% dos trimestres, divida_bruta_pl <= 1 aprova ~72%,
 * icj >= 2 aprova ~50% (a mediana do mercado é 2,09).
 */
export const HEALTH_THRESHOLDS = Object.freeze({
  maxDividaBrutaPl: 1.0,
  minLiquidezCorrente: 1.0,
  minIcj: 2.0,
});

/** Piso de história: sem isso, "100% saudável" em 11 trimestres seria barato. */
export const MIN_QUARTERS = 20;

/** Janela recente — denuncia a empresa que era boa e piorou. */
export const RECENT_QUARTERS = 8;

export interface QuarterInput {
  readonly ano: number;
  readonly trimestre: number;
  /** Carimbo de conhecimento (prazo legal), ISO YYYY-MM-DD. */
  readonly knowledgeDate: string;
  readonly dividaBrutaPl: number | null;
  readonly liquidezCorrente: number | null;
  readonly icj: number | null;
  readonly lucroLiquido: number | null;
  readonly fco: number | null;
}

export interface QuarterResult {
  readonly ano: number;
  readonly trimestre: number;
  readonly knowledgeDate: string;
  /** `null` = pilar sem dado: não aprova e NÃO reprova. */
  readonly pillars: Readonly<Record<PillarKey, boolean | null>>;
  readonly medidos: number;
  readonly aprovados: number;
  /** aprovados/medidos, ou `null` quando nada foi medido. */
  readonly nota: number | null;
}

export interface CompanyBase {
  readonly cdCvm: string;
  readonly ticker: string;
  readonly nome: string;
  readonly setorCvm: string | null;
}

export interface PillarRate {
  readonly aprovados: number;
  readonly medidos: number;
  /** `null` quando o pilar nunca teve dado. */
  readonly taxa: number | null;
}

export interface CompanyHealth extends CompanyBase {
  /** Média das notas trimestrais, em [0,1]. */
  readonly score: number;
  /** Trimestres com ao menos um pilar medido. */
  readonly trimestres: number;
  readonly pilares: Readonly<Record<PillarKey, PillarRate>>;
  /** Janela recente, SEMPRE separada do score histórico. */
  readonly recente: { readonly score: number | null; readonly trimestres: number };
}

const finito = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * Avalia um trimestre. Cada pilar vira `true`, `false` ou `null` (sem dado).
 * `null` jamais conta como reprovação: fingir doença por dado ausente seria o
 * mesmo defeito de exibir zero como cotação.
 */
export function evaluateQuarter(q: QuarterInput): QuarterResult {
  const t = HEALTH_THRESHOLDS;
  const pillars: Record<PillarKey, boolean | null> = {
    alavancagem: finito(q.dividaBrutaPl) ? q.dividaBrutaPl <= t.maxDividaBrutaPl : null,
    liquidez: finito(q.liquidezCorrente) ? q.liquidezCorrente >= t.minLiquidezCorrente : null,
    juros: finito(q.icj) ? q.icj >= t.minIcj : null,
    lucro: finito(q.lucroLiquido) ? q.lucroLiquido > 0 : null,
    caixa: finito(q.fco) ? q.fco > 0 : null,
  };

  let medidos = 0;
  let aprovados = 0;
  for (const k of PILLAR_KEYS) {
    const v = pillars[k];
    if (v === null) continue;
    medidos += 1;
    if (v) aprovados += 1;
  }

  return {
    ano: q.ano,
    trimestre: q.trimestre,
    knowledgeDate: q.knowledgeDate,
    pillars: Object.freeze(pillars),
    medidos,
    aprovados,
    nota: medidos > 0 ? aprovados / medidos : null,
  };
}

/**
 * Agrega a história de uma empresa. Devolve `null` quando ela não atinge o
 * piso de trimestres MEDIDOS — quem não pode ser avaliada não entra no
 * ranking, e é listada à parte pelo chamador.
 *
 * `quarters` deve vir ordenado por período crescente; a janela recente usa a
 * cauda da lista.
 */
export function scoreCompany(
  base: CompanyBase,
  quarters: readonly QuarterInput[],
): CompanyHealth | null {
  const avaliados = quarters.map(evaluateQuarter).filter((r) => r.nota !== null);
  if (avaliados.length < MIN_QUARTERS) return null;

  const score = avaliados.reduce((acc, r) => acc + (r.nota as number), 0) / avaliados.length;

  const pilares = {} as Record<PillarKey, PillarRate>;
  for (const k of PILLAR_KEYS) {
    let medidos = 0;
    let aprovados = 0;
    for (const r of avaliados) {
      const v = r.pillars[k];
      if (v === null) continue;
      medidos += 1;
      if (v) aprovados += 1;
    }
    pilares[k] = { aprovados, medidos, taxa: medidos > 0 ? aprovados / medidos : null };
  }

  const cauda = avaliados.slice(-RECENT_QUARTERS);
  const recente = {
    score:
      cauda.length > 0
        ? cauda.reduce((acc, r) => acc + (r.nota as number), 0) / cauda.length
        : null,
    trimestres: cauda.length,
  };

  return {
    ...base,
    score,
    trimestres: avaliados.length,
    pilares: Object.freeze(pilares),
    recente,
  };
}

/**
 * Ordenação determinística: escore desc, mais trimestres primeiro (mais
 * evidência ganha), depois ticker. Sem isso, duas cargas da mesma aba
 * poderiam mostrar listas diferentes.
 */
export function rankCompanies(rows: readonly CompanyHealth[]): CompanyHealth[] {
  return [...rows].sort(
    (a, b) =>
      b.score - a.score || b.trimestres - a.trimestres || a.ticker.localeCompare(b.ticker),
  );
}
