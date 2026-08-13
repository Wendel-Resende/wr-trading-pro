/**
 * Saúde Financeira de BANCOS — leitura do banco e montagem do ranking.
 *
 * Camada de I/O do bloco de bancos: lê `data/cvm/cvm_fundamentos.db`
 * (read-only, node:sqlite), monta os trimestres e delega TODO o julgamento a
 * `bcb-financial-health-rules.ts`, que é puro. Nenhum limiar mora aqui.
 *
 * Espelha `cvm-financial-health.ts`, com uma diferença de fundo: aqui há dois
 * perímetros regulatórios distintos. O escore sai INTEIRO do perímetro
 * prudencial (1004/1009, `bcb_prudencial_capital` + `bcb_prudencial_resumo`).
 * A inadimplência vem do perímetro financeiro (1005) e viaja ao lado, com o
 * próprio cod_inst e a própria data-base — nunca somada nem fundida ao escore.
 * Os dois conglomerados são entidades diferentes; um número que os misturasse
 * seria um número que o BCB nunca publicou.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  scoreBank,
  rankBanks,
  BANK_MIN_QUARTERS,
  type BankQuarterInput,
  type BankHealth,
  type BankDelinquency,
} from './bcb-financial-health-rules';
import { BCB_PROVENANCE } from './bcb-legacy-db';

/** Níveis de risco BCB considerados inadimplência (atraso acima de 90 dias). */
const NIVEIS_INADIMPLENTES = ['D', 'E', 'F', 'G', 'H'] as const;

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  const file = path.join(process.cwd(), 'data', 'cvm', 'cvm_fundamentos.db');
  if (!existsSync(file)) {
    throw new Error(
      `Banco de fundamentos CVM/BCB não encontrado em ${file}. Rode scripts/bcb-sync/sync-bcb-snapshot.cjs.`,
    );
  }
  db = new DatabaseSync(file, { readOnly: true });
  return db;
}

/** Usado só por testes, para forçar reabertura após trocar o arquivo de banco. */
export function __resetBankHealthDbForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Banco que existe na fonte mas não pôde ser avaliado — aparece NA TELA, nunca por omissão. */
export interface BankExclusion {
  readonly ticker: string;
  readonly nomeBcb: string | null;
  readonly razao: string;
}

export interface BankHealthRanking {
  readonly bancos: readonly BankHealth[];
  readonly excluidos: readonly BankExclusion[];
  /** Última data-base prudencial (1004/1009) observada no conjunto. */
  readonly asOfPrudencial: number;
  /** Última data-base financeira (1005) observada — normalmente DIFERENTE da prudencial. */
  readonly asOfFinanceiro: number;
  readonly provenance: typeof BCB_PROVENANCE;
}

/**
 * Trimestres prudenciais por ticker. O lucro líquido não está em
 * `bcb_prudencial_capital` (que traz só capital/RWA/índices), então vem de
 * `bcb_prudencial_resumo` pelo rótulo publicado 'Lucro Líquido', casado por
 * (cd_cvm, data_base) — nunca por ticker isolado.
 */
function loadPrudencialQuarters(): Map<string, BankQuarterInput[]> {
  const rows = getDb()
    .prepare(
      `SELECT c.ticker, c.data_base, c.ano, c.trimestre,
              c.indice_basileia_pct, c.indice_capital_nivel_i_pct,
              c.razao_alavancagem_pct, c.indice_imobilizacao_pct,
              (SELECT r.valor
                 FROM bcb_prudencial_resumo r
                WHERE r.cd_cvm = c.cd_cvm
                  AND r.data_base = c.data_base
                  AND r.rotulo = 'Lucro Líquido'
                LIMIT 1) AS lucro_liquido
         FROM bcb_prudencial_capital c
        ORDER BY c.ticker, c.data_base`,
    )
    .all() as Record<string, unknown>[];

  const byTicker = new Map<string, BankQuarterInput[]>();
  for (const r of rows) {
    const ticker = String(r.ticker);
    const list = byTicker.get(ticker) ?? [];
    list.push({
      ano: Number(r.ano),
      trimestre: Number(r.trimestre),
      dataBase: Number(r.data_base),
      basileiaPct: num(r.indice_basileia_pct),
      capitalNivelIPct: num(r.indice_capital_nivel_i_pct),
      alavancagemPct: num(r.razao_alavancagem_pct),
      imobilizacaoPct: num(r.indice_imobilizacao_pct),
      lucroLiquidoBrl: num(r.lucro_liquido),
    });
    byTicker.set(ticker, list);
  }
  return byTicker;
}

/** Identidade prudencial por ticker: cod_inst, nome e segmento da última data-base. */
function loadPrudencialIdentity(): Map<
  string,
  { cdCvm: string; codInst: number; nomeBcb: string | null; segmento: string | null }
> {
  const rows = getDb()
    .prepare(
      `SELECT c.ticker, c.cd_cvm, c.cod_inst, c.nome_bcb, c.segmento_sr, c.data_base
         FROM bcb_prudencial_capital c
         JOIN (SELECT ticker AS t, MAX(data_base) AS mx
                 FROM bcb_prudencial_capital GROUP BY ticker) m
           ON m.t = c.ticker AND m.mx = c.data_base`,
    )
    .all() as Record<string, unknown>[];

  const map = new Map<
    string,
    { cdCvm: string; codInst: number; nomeBcb: string | null; segmento: string | null }
  >();
  for (const r of rows) {
    map.set(String(r.ticker), {
      cdCvm: String(r.cd_cvm),
      codInst: Number(r.cod_inst),
      nomeBcb: str(r.nome_bcb),
      segmento: str(r.segmento_sr),
    });
  }
  return map;
}

/**
 * Inadimplência do perímetro FINANCEIRO na última data-base de cada ticker:
 * carteira classificada nos níveis D a H sobre o total.
 *
 * Devolve `null` para o ticker cujo total é ausente ou não-positivo — divisão
 * por zero viraria um percentual fabricado, que é exatamente o defeito que
 * esta integração existe para não repetir.
 */
function loadInadimplencia(): Map<string, BankDelinquency> {
  const rows = getDb()
    .prepare(
      `SELECT n.ticker, n.cod_inst, n.data_base, n.rotulo, n.valor
         FROM bcb_financeiro_carteira_nivel_risco n
         JOIN (SELECT ticker AS t, MAX(data_base) AS mx
                 FROM bcb_financeiro_carteira_nivel_risco GROUP BY ticker) m
           ON m.t = n.ticker AND m.mx = n.data_base`,
    )
    .all() as Record<string, unknown>[];

  const acc = new Map<
    string,
    { codInst: number; dataBase: number; ruim: number; total: number | null }
  >();

  for (const r of rows) {
    const ticker = String(r.ticker);
    const rotulo = String(r.rotulo);
    const valor = num(r.valor);
    const cur = acc.get(ticker) ?? {
      codInst: Number(r.cod_inst),
      dataBase: Number(r.data_base),
      ruim: 0,
      total: null,
    };

    if (rotulo === 'Total Geral') {
      cur.total = valor;
    } else if ((NIVEIS_INADIMPLENTES as readonly string[]).includes(rotulo) && valor !== null) {
      cur.ruim += valor;
    }
    acc.set(ticker, cur);
  }

  const out = new Map<string, BankDelinquency>();
  for (const [ticker, v] of acc) {
    if (v.total === null || v.total <= 0) continue; // ausência fica ausente, nunca vira 0%
    out.set(ticker, {
      codInst: v.codInst,
      dataBase: v.dataBase,
      pct: (v.ruim / v.total) * 100,
    });
  }
  return out;
}

/**
 * Monta o ranking descritivo dos bancos. Quem não atinge o piso de história
 * sai da lista principal e entra em `excluidos` com a razão — a exclusão é
 * informação, não silêncio.
 */
export function getBankHealthRanking(): BankHealthRanking {
  const quartersByTicker = loadPrudencialQuarters();
  const identity = loadPrudencialIdentity();
  const inadimplencia = loadInadimplencia();

  const bancos: BankHealth[] = [];
  const excluidos: BankExclusion[] = [];
  let asOfPrudencial = 0;
  let asOfFinanceiro = 0;

  for (const [ticker, quarters] of quartersByTicker) {
    const id = identity.get(ticker);
    if (!id) {
      excluidos.push({
        ticker,
        nomeBcb: null,
        razao: 'Sem identidade prudencial (cod_inst) na fonte BCB — não avaliado.',
      });
      continue;
    }

    for (const q of quarters) {
      if (q.dataBase > asOfPrudencial) asOfPrudencial = q.dataBase;
    }

    const inad = inadimplencia.get(ticker) ?? null;
    if (inad && inad.dataBase > asOfFinanceiro) asOfFinanceiro = inad.dataBase;

    const health = scoreBank(
      { ticker, cdCvm: id.cdCvm, codInst: id.codInst, nomeBcb: id.nomeBcb, segmento: id.segmento },
      quarters,
      inad,
    );

    if (health === null) {
      const medidos = quarters.filter(
        (q) =>
          q.basileiaPct !== null ||
          q.capitalNivelIPct !== null ||
          q.alavancagemPct !== null ||
          q.imobilizacaoPct !== null ||
          q.lucroLiquidoBrl !== null,
      ).length;
      excluidos.push({
        ticker,
        nomeBcb: id.nomeBcb,
        razao: `História insuficiente: ${medidos} trimestres com dado, mínimo de ${BANK_MIN_QUARTERS}.`,
      });
      continue;
    }

    bancos.push(health);
  }

  return {
    bancos: rankBanks(bancos),
    excluidos,
    asOfPrudencial,
    asOfFinanceiro,
    provenance: BCB_PROVENANCE,
  };
}
