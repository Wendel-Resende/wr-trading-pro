/**
 * Ranking de Saúde Financeira — contratos da UI.
 *
 * Espelham `GET /api/cvm/financial-health`. Nada é importado do servidor:
 * mesma disciplina de `src/components/ranking/types.ts` — o componente conhece
 * o formato do JSON, não os módulos que o produzem.
 */

export type PillarKey = 'alavancagem' | 'liquidez' | 'juros' | 'lucro' | 'caixa';

export const PILLAR_ORDER: readonly PillarKey[] = [
  'alavancagem',
  'liquidez',
  'juros',
  'lucro',
  'caixa',
];

export const PILLAR_LABELS: Readonly<Record<PillarKey, string>> = {
  alavancagem: 'Alavancagem',
  liquidez: 'Liquidez',
  juros: 'Juros',
  lucro: 'Lucro',
  caixa: 'Caixa',
};

export interface PillarRate {
  readonly aprovados: number;
  readonly medidos: number;
  readonly taxa: number | null;
}

export interface HealthRow {
  readonly cdCvm: string;
  readonly ticker: string;
  readonly nome: string;
  readonly setorCvm: string | null;
  readonly score: number;
  readonly trimestres: number;
  readonly pilares: Readonly<Record<PillarKey, PillarRate>>;
  readonly recente: { readonly score: number | null; readonly trimestres: number };
}

export interface ExcludedCompany {
  readonly ticker: string;
  readonly nome: string;
  readonly motivo: 'SETOR_FINANCEIRO' | 'HISTORICO_INSUFICIENTE';
  readonly detalhe: string;
}

export interface HealthResponse {
  readonly geradoEm: string;
  readonly asOf: string;
  readonly universo: {
    readonly total: number;
    readonly ranqueadas: number;
    readonly excluidas: readonly ExcludedCompany[];
  };
  readonly criterios: {
    readonly limiares: {
      readonly maxDividaBrutaPl: number;
      readonly minLiquidezCorrente: number;
      readonly minIcj: number;
    };
    readonly minTrimestres: number;
    readonly janelaRecente: number;
    readonly regraPrazoLegal: string;
  };
  readonly rows: readonly HealthRow[];
}

/** Percentual legível; `null` vira travessão, nunca 0%. */
export const pct = (v: number | null | undefined, casas = 0): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(casas)}%`;

/**
 * Divergência relevante entre histórico e recente: a empresa que era boa e
 * piorou. 15 p.p. é o corte para exibir o alerta.
 */
export const DECLINIO_PP = 0.15;

export const emDeclinio = (r: HealthRow): boolean =>
  r.recente.score !== null && r.score - r.recente.score >= DECLINIO_PP;

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}
