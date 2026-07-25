/**
 * Derivações puras da Ficha Fundamentalista (sem acesso a banco — testáveis
 * isoladamente). Spec: docs/architecture/2026-07-25-ficha-fundamentalista-cvm-design.md
 */

export const LEGAL_LAG_RULE =
  'Carimbo de conhecimento derivado do prazo legal CVM (ITR T1/T2/T3: +45 dias; DFP T4: +90 dias a partir do fim do período). Estimado — o snapshot não tem data de publicação real.';

/**
 * Conversão de lucro em caixa = FCO / lucro líquido. Determinística e testada.
 * Nunca fabrica um número: lucro não-positivo e dado ausente viram `null` com
 * motivo explícito (o quociente perde sentido econômico com lucro <= 0).
 */
export function cashConversion(
  fco: number | null,
  lucroLiquido: number | null,
): { value: number | null; note?: 'DADO_AUSENTE' | 'LUCRO_NAO_POSITIVO' } {
  if (fco === null || lucroLiquido === null) return { value: null, note: 'DADO_AUSENTE' };
  if (lucroLiquido <= 0) return { value: null, note: 'LUCRO_NAO_POSITIVO' };
  return { value: fco / lucroLiquido };
}

export interface DupontFactors {
  /** Lucratividade — margem líquida (passthrough do pipeline). */
  margemLiquida: number | null;
  /** Eficiência — giro do ativo (receita/ativo, passthrough do pipeline). */
  giroAtivo: number | null;
  /** Alavancagem financeira = Ativo/PL = 1/pl_ativos (derivado no WR). */
  alavancagem: number | null;
  /** ROE reconstruído pelo produto dos três fatores (derivado no WR). */
  roeReconstruido: number | null;
  /** true/false se o produto bate com o ROE do pipeline dentro da tolerância;
   *  null quando não há ROE do pipeline para comparar (não fabrica veredito). */
  consistente: boolean | null;
}

/**
 * Decomposição DuPont do ROE: ROE = margem líquida × giro do ativo ×
 * alavancagem financeira (Ativo/PL = 1/pl_ativos). Os fatores vêm do pipeline;
 * a alavancagem e o produto são derivados no WR. A checagem `consistente`
 * compara o produto com o ROE reportado pelo pipeline (identidade contábil) —
 * honesta: sinaliza divergência em vez de esconder, e fica `null` sem base de
 * comparação. Nunca fabrica: fator ausente ou `pl_ativos` não-positivo → null.
 */
export function dupontFactors(
  margemLiquida: number | null,
  giroAtivos: number | null,
  plAtivos: number | null,
  roePipeline: number | null,
): DupontFactors {
  const alavancagem = plAtivos !== null && plAtivos > 0 ? 1 / plAtivos : null;
  const roeReconstruido =
    margemLiquida !== null && giroAtivos !== null && alavancagem !== null
      ? margemLiquida * giroAtivos * alavancagem
      : null;
  let consistente: boolean | null = null;
  if (roeReconstruido !== null && roePipeline !== null) {
    const tol = Math.max(0.01, 0.05 * Math.abs(roePipeline));
    consistente = Math.abs(roeReconstruido - roePipeline) <= tol;
  }
  return { margemLiquida, giroAtivo: giroAtivos, alavancagem, roeReconstruido, consistente };
}

/** Fim do período civil (UTC): T1→31/03, T2→30/06, T3→30/09, T4→31/12. */
function endOfCivilQuarter(ano: number, trimestre: number): Date {
  const endMonthDay: Record<number, [number, number]> = {
    1: [2, 31],
    2: [5, 30],
    3: [8, 30],
    4: [11, 31],
  };
  const [m, d] = endMonthDay[trimestre] ?? [11, 31];
  return new Date(Date.UTC(ano, m, d));
}

/**
 * Instante conservador em que um fato trimestral CVM já era, no máximo,
 * público: fim do período (data_ref, ou fim civil quando ausente) + prazo legal
 * de entrega. ITR (T1/T2/T3) = +45 dias; DFP (T4/anual) = +90 dias. Sempre
 * marcado como estimado nesta v1 — o snapshot não carrega data real de
 * publicação. Espelha a defasagem legal já aplicada em `python/ml`.
 */
export function knowledgeDateFor(
  dataRef: string | null,
  ano: number,
  trimestre: number,
): { iso: string; estimadoPorPrazoLegal: boolean } {
  const base = dataRef ? new Date(`${dataRef}T00:00:00.000Z`) : endOfCivilQuarter(ano, trimestre);
  const lagDays = trimestre === 4 ? 90 : 45;
  const known = new Date(base.getTime() + lagDays * 24 * 60 * 60 * 1000);
  return { iso: known.toISOString().slice(0, 10), estimadoPorPrazoLegal: true };
}
