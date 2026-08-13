/**
 * Bloco de bancos (BCB/IFData) — contratos da UI.
 *
 * Espelham `GET /api/bcb/financial-health`. Nada é importado do servidor:
 * mesma disciplina de `types.ts` ao lado — o componente conhece o formato do
 * JSON, não os módulos que o produzem.
 */

export type BankPillarKey =
  | 'basileia'
  | 'capitalNivelI'
  | 'alavancagem'
  | 'imobilizacao'
  | 'lucro';

export const BANK_PILLAR_ORDER: readonly BankPillarKey[] = [
  'basileia',
  'capitalNivelI',
  'alavancagem',
  'imobilizacao',
  'lucro',
];

export const BANK_PILLAR_LABELS: Readonly<Record<BankPillarKey, string>> = {
  basileia: 'Basileia',
  capitalNivelI: 'Nível I',
  alavancagem: 'Alavancagem',
  imobilizacao: 'Imobilização',
  lucro: 'Lucro',
};

export interface BankPillarRate {
  readonly aprovados: number;
  readonly medidos: number;
  readonly taxa: number | null;
}

export interface BankCurrentValues {
  readonly dataBase: number;
  readonly basileiaPct: number | null;
  readonly capitalNivelIPct: number | null;
  readonly alavancagemPct: number | null;
  readonly imobilizacaoPct: number | null;
}

/** Perímetro financeiro (1005) — outro conglomerado, outra data-base. */
export interface BankDelinquency {
  readonly codInst: number;
  readonly dataBase: number;
  readonly pct: number;
}

export interface BankRow {
  readonly ticker: string;
  readonly cdCvm: string;
  readonly codInst: number;
  readonly nomeBcb: string | null;
  readonly segmento: string | null;
  readonly score: number;
  readonly trimestres: number;
  readonly pilares: Readonly<Record<BankPillarKey, BankPillarRate>>;
  readonly recente: { readonly score: number | null; readonly trimestres: number };
  readonly dataBaseInicio: number;
  readonly dataBaseFim: number;
  readonly atual: BankCurrentValues;
  readonly inadimplencia: BankDelinquency | null;
}

export interface BankExclusion {
  readonly ticker: string;
  readonly nomeBcb: string | null;
  readonly razao: string;
}

export interface BankHealthResponse {
  readonly bancos: readonly BankRow[];
  readonly excluidos: readonly BankExclusion[];
  readonly asOf: { readonly prudencial: number; readonly financeiro: number };
  readonly criterios: {
    readonly limiares: {
      readonly minBasileiaPct: number;
      readonly minCapitalNivelIPct: number;
      readonly minAlavancagemPct: number;
      readonly maxImobilizacaoPct: number;
    };
    readonly minTrimestres: number;
    readonly janelaRecente: number;
    readonly pilares: readonly { key: BankPillarKey; label: string; descricao: string }[];
  };
  readonly provenance: { readonly source: string; readonly note: string };
}

/** AAAAMM → "1T26". Data-base BCB é trimestre, não dia. */
export function formatDataBase(db: number): string {
  const ano = Math.floor(db / 100);
  const mes = db % 100;
  const tri = Math.ceil(mes / 3);
  return `${tri}T${String(ano).slice(-2)}`;
}

export function pctValor(v: number | null, casas = 1): string {
  return v === null || !Number.isFinite(v) ? '—' : `${v.toFixed(casas)}%`;
}

export function pctTaxa(v: number | null): string {
  return v === null || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`;
}

/** Mesmo critério da aba da indústria: 15 p.p. de queda entre histórico e recente. */
export function bancoEmDeclinio(r: BankRow): boolean {
  return r.recente.score !== null && r.score - r.recente.score >= 0.15;
}
