/**
 * Saúde Financeira de BANCOS — REGRAS PURAS (sem I/O).
 *
 * Irmã de `cvm-financial-health-rules.ts`, com a mesma natureza DESCRITIVA:
 * conta o que já foi publicado, não prevê nada, não tem gate nem modelo e não
 * pode reprovar por dado ausente.
 *
 * A diferença que justifica um módulo separado não é o assunto, é a RÉGUA. A
 * régua da indústria (dívida/PL <= 1, liquidez corrente >= 1) descreve doença
 * num banco porque num banco o passivo circulante é o depósito do cliente e
 * alavancagem alta é o modelo de negócio — foi exatamente por isso que os 18
 * financeiros ficaram fora daquela aba. Aqui os limiares NÃO são calibrados
 * pela distribuição observada: são os mínimos que o próprio regulador publica
 * e cobra. Não há escolha de limiar a defender, e é isso que torna esta
 * contagem honesta.
 *
 * Fonte dos limiares: Basileia III / Resoluções BCB — requisito mínimo de PR
 * (8%) e de Capital Nível I (6%), ambos somados ao Adicional de Conservação de
 * Capital Principal (2,5%); Razão de Alavancagem mínima de 3%; limite de
 * imobilização de 50% do PR ajustado.
 */

export type BankPillarKey =
  | 'basileia'
  | 'capitalNivelI'
  | 'alavancagem'
  | 'imobilizacao'
  | 'lucro';

export const BANK_PILLAR_KEYS: readonly BankPillarKey[] = Object.freeze([
  'basileia',
  'capitalNivelI',
  'alavancagem',
  'imobilizacao',
  'lucro',
] as const);

export const BANK_PILLAR_LABELS: Readonly<Record<BankPillarKey, string>> = Object.freeze({
  basileia: 'Basileia',
  capitalNivelI: 'Capital Nível I',
  alavancagem: 'Alavancagem',
  imobilizacao: 'Imobilização',
  lucro: 'Lucro',
});

/** Explicação exibível de cada pilar — a régua tem que estar na tela, não só no código. */
export const BANK_PILLAR_DESCRIPTIONS: Readonly<Record<BankPillarKey, string>> = Object.freeze({
  basileia: 'Índice de Basileia ≥ 10,5% (mínimo de 8% + adicional de conservação de 2,5%)',
  capitalNivelI: 'Índice de Capital Nível I ≥ 8,5% (mínimo de 6% + adicional de conservação de 2,5%)',
  alavancagem: 'Razão de Alavancagem ≥ 3% (mínimo de Basileia III; o BCB só publica a partir de 2017)',
  imobilizacao: 'Índice de Imobilização ≤ 50% do patrimônio de referência (limite BCB)',
  lucro: 'Lucro líquido do trimestre acima de zero',
});

export const BANK_THRESHOLDS = Object.freeze({
  minBasileiaPct: 10.5,
  minCapitalNivelIPct: 8.5,
  minAlavancagemPct: 3.0,
  maxImobilizacaoPct: 50.0,
});

/** Piso de história, igual ao da aba da indústria: "100% saudável" em 11 trimestres seria barato. */
export const BANK_MIN_QUARTERS = 20;

/** Janela recente — denuncia o banco que era sólido e piorou. */
export const BANK_RECENT_QUARTERS = 8;

export interface BankQuarterInput {
  readonly ano: number;
  readonly trimestre: number;
  /** Data-base BCB no formato AAAAMM (ex.: 202603). */
  readonly dataBase: number;
  readonly basileiaPct: number | null;
  readonly capitalNivelIPct: number | null;
  /** `null` antes de 2017 — o BCB não publicava. Ausência, não fraqueza. */
  readonly alavancagemPct: number | null;
  readonly imobilizacaoPct: number | null;
  readonly lucroLiquidoBrl: number | null;
}

export interface BankQuarterResult {
  readonly ano: number;
  readonly trimestre: number;
  readonly dataBase: number;
  /** `null` = pilar sem dado: não aprova e NÃO reprova. */
  readonly pillars: Readonly<Record<BankPillarKey, boolean | null>>;
  readonly medidos: number;
  readonly aprovados: number;
  /** aprovados/medidos, ou `null` quando nada foi medido. */
  readonly nota: number | null;
}

export interface BankBase {
  readonly ticker: string;
  readonly cdCvm: string;
  /** Código do conglomerado PRUDENCIAL. Não é o mesmo do perímetro financeiro. */
  readonly codInst: number;
  readonly nomeBcb: string | null;
  /** Segmentação prudencial S1..S5 — S1 é sistemicamente relevante. */
  readonly segmento: string | null;
}

export interface BankPillarRate {
  readonly aprovados: number;
  readonly medidos: number;
  /** `null` quando o pilar nunca teve dado. */
  readonly taxa: number | null;
}

/**
 * Inadimplência do perímetro FINANCEIRO (1005), carregada junto mas mantida
 * fora do escore de propósito: vem de outro conglomerado, com outro cod_inst e
 * outra data-base. Somar os dois perímetros produziria um número que o BCB
 * nunca publicou.
 */
export interface BankDelinquency {
  readonly codInst: number;
  readonly dataBase: number;
  /** Carteira nos níveis D a H sobre o total classificado, em [0,100]. */
  readonly pct: number;
}

/**
 * Valores da ÚLTIMA data-base avaliada, exibidos ao lado do escore.
 *
 * Existem porque o escore sozinho não discrimina: contra limiares
 * regulatórios, quase todo banco listado aprova quase sempre, e uma coluna de
 * "100%" repetida dez vezes não informa. A saída honesta não é apertar a régua
 * até aparecer variação — isso seria inventar um critério para produzir um
 * ranking — e sim mostrar o número que de fato varia. Um banco com Basileia de
 * 19% e outro com 11% ambos cumprem o mínimo; a distância até ele é a
 * informação, e é descritiva, não uma nota.
 */
export interface BankCurrentValues {
  readonly dataBase: number;
  readonly basileiaPct: number | null;
  readonly capitalNivelIPct: number | null;
  readonly alavancagemPct: number | null;
  readonly imobilizacaoPct: number | null;
}

export interface BankHealth extends BankBase {
  /** Média das notas trimestrais, em [0,1]. */
  readonly score: number;
  /** Trimestres com ao menos um pilar medido. */
  readonly trimestres: number;
  readonly pilares: Readonly<Record<BankPillarKey, BankPillarRate>>;
  /** Janela recente, SEMPRE separada do score histórico. */
  readonly recente: { readonly score: number | null; readonly trimestres: number };
  /** Primeira e última data-base prudencial efetivamente avaliadas. */
  readonly dataBaseInicio: number;
  readonly dataBaseFim: number;
  /** Valores da última data-base — descritivos, nunca somados ao escore. */
  readonly atual: BankCurrentValues;
  /** Perímetro financeiro, nunca fundido ao escore. `null` quando indisponível. */
  readonly inadimplencia: BankDelinquency | null;
}

const finito = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * Avalia um trimestre. Cada pilar vira `true`, `false` ou `null` (sem dado).
 * `null` jamais conta como reprovação: um banco não fica doente por o BCB não
 * ter publicado a razão de alavancagem em 2015.
 */
export function evaluateBankQuarter(q: BankQuarterInput): BankQuarterResult {
  const t = BANK_THRESHOLDS;
  const pillars: Record<BankPillarKey, boolean | null> = {
    basileia: finito(q.basileiaPct) ? q.basileiaPct >= t.minBasileiaPct : null,
    capitalNivelI: finito(q.capitalNivelIPct) ? q.capitalNivelIPct >= t.minCapitalNivelIPct : null,
    alavancagem: finito(q.alavancagemPct) ? q.alavancagemPct >= t.minAlavancagemPct : null,
    imobilizacao: finito(q.imobilizacaoPct) ? q.imobilizacaoPct <= t.maxImobilizacaoPct : null,
    lucro: finito(q.lucroLiquidoBrl) ? q.lucroLiquidoBrl > 0 : null,
  };

  let medidos = 0;
  let aprovados = 0;
  for (const k of BANK_PILLAR_KEYS) {
    const v = pillars[k];
    if (v === null) continue;
    medidos += 1;
    if (v) aprovados += 1;
  }

  return {
    ano: q.ano,
    trimestre: q.trimestre,
    dataBase: q.dataBase,
    pillars: Object.freeze(pillars),
    medidos,
    aprovados,
    nota: medidos > 0 ? aprovados / medidos : null,
  };
}

/**
 * Agrega a história de um banco. Devolve `null` quando ele não atinge o piso
 * de trimestres MEDIDOS — quem não pode ser avaliado não entra no bloco, e é
 * listado à parte pelo chamador, com a razão na tela.
 *
 * `quarters` deve vir ordenado por data-base crescente; a janela recente usa a
 * cauda da lista.
 */
export function scoreBank(
  base: BankBase,
  quarters: readonly BankQuarterInput[],
  inadimplencia: BankDelinquency | null = null,
): BankHealth | null {
  // Input e resultado andam em par para que `atual` saia do último trimestre
  // efetivamente AVALIADO, não do último da lista — se o trimestre mais recente
  // vier sem dado nenhum, exibi-lo como "valor atual" mostraria uma linha vazia
  // no lugar do último número que o BCB realmente publicou.
  const pares = quarters
    .map((input) => ({ input, res: evaluateBankQuarter(input) }))
    .filter((p) => p.res.nota !== null);
  const avaliados = pares.map((p) => p.res);
  if (avaliados.length < BANK_MIN_QUARTERS) return null;

  const ultimo = pares[pares.length - 1].input;

  const score = avaliados.reduce((acc, r) => acc + (r.nota as number), 0) / avaliados.length;

  const pilares = {} as Record<BankPillarKey, BankPillarRate>;
  for (const k of BANK_PILLAR_KEYS) {
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

  const cauda = avaliados.slice(-BANK_RECENT_QUARTERS);
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
    dataBaseInicio: avaliados[0].dataBase,
    dataBaseFim: avaliados[avaliados.length - 1].dataBase,
    atual: Object.freeze({
      dataBase: ultimo.dataBase,
      basileiaPct: finito(ultimo.basileiaPct) ? ultimo.basileiaPct : null,
      capitalNivelIPct: finito(ultimo.capitalNivelIPct) ? ultimo.capitalNivelIPct : null,
      alavancagemPct: finito(ultimo.alavancagemPct) ? ultimo.alavancagemPct : null,
      imobilizacaoPct: finito(ultimo.imobilizacaoPct) ? ultimo.imobilizacaoPct : null,
    }),
    inadimplencia,
  };
}

/**
 * Ordenação determinística: escore desc, mais trimestres primeiro (mais
 * evidência ganha), depois ticker. Sem isso, duas cargas da mesma aba
 * poderiam mostrar listas diferentes.
 */
export function rankBanks(rows: readonly BankHealth[]): BankHealth[] {
  return [...rows].sort(
    (a, b) =>
      b.score - a.score || b.trimestres - a.trimestres || a.ticker.localeCompare(b.ticker),
  );
}
