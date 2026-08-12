import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  evaluateQuarter,
  scoreCompany,
  rankCompanies,
  HEALTH_THRESHOLDS,
  MIN_QUARTERS,
  RECENT_QUARTERS,
  PILLAR_KEYS,
  type QuarterInput,
  type CompanyBase,
  type CompanyHealth,
} from '../../src/lib/server/cvm-financial-health-rules';
import {
  financialHealthRanking,
  FINANCIAL_SECTOR_BUCKETS,
} from '../../src/lib/server/cvm-financial-health';

function assertLog(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  console.log(`ok: ${msg}`);
}

const BASE: CompanyBase = {
  cdCvm: '000001',
  ticker: 'TEST3',
  nome: 'Teste S.A.',
  setorCvm: 'Alimentos',
};

function q(over: Partial<QuarterInput> = {}, i = 1): QuarterInput {
  return {
    ano: 2020,
    trimestre: ((i - 1) % 4) + 1,
    knowledgeDate: '2020-05-15',
    dividaBrutaPl: 0.5,
    liquidezCorrente: 2,
    icj: 5,
    lucroLiquido: 100,
    fco: 100,
    ...over,
  };
}

function serie(n: number, over: Partial<QuarterInput> = {}): QuarterInput[] {
  return Array.from({ length: n }, (_, i) => q(over, i + 1));
}

function main(): void {
  // --- limiares na fronteira ---
  assertLog(evaluateQuarter(q({ liquidezCorrente: 1.0 })).pillars.liquidez === true, 'liquidez 1,00 aprova');
  assertLog(evaluateQuarter(q({ liquidezCorrente: 0.99 })).pillars.liquidez === false, 'liquidez 0,99 reprova');
  assertLog(evaluateQuarter(q({ dividaBrutaPl: 1.0 })).pillars.alavancagem === true, 'dívida/PL 1,00 aprova');
  assertLog(evaluateQuarter(q({ dividaBrutaPl: 1.01 })).pillars.alavancagem === false, 'dívida/PL 1,01 reprova');
  assertLog(evaluateQuarter(q({ icj: 2.0 })).pillars.juros === true, 'icj 2,00 aprova');
  assertLog(evaluateQuarter(q({ icj: 1.99 })).pillars.juros === false, 'icj 1,99 reprova');
  assertLog(evaluateQuarter(q({ lucroLiquido: 0 })).pillars.lucro === false, 'lucro 0 reprova');
  assertLog(evaluateQuarter(q({ lucroLiquido: 0.01 })).pillars.lucro === true, 'lucro 0,01 aprova');
  assertLog(evaluateQuarter(q({ fco: 0 })).pillars.caixa === false, 'FCO 0 reprova');
  assertLog(evaluateQuarter(q({ fco: 0.01 })).pillars.caixa === true, 'FCO 0,01 aprova');
  assertLog(
    HEALTH_THRESHOLDS.minIcj === 2 && HEALTH_THRESHOLDS.maxDividaBrutaPl === 1,
    'limiares da spec preservados',
  );

  // --- dado ausente não aprova nem reprova ---
  const semIcj = evaluateQuarter(q({ icj: null }));
  assertLog(semIcj.pillars.juros === null, 'pilar sem dado fica null');
  assertLog(semIcj.medidos === 4 && semIcj.aprovados === 4, 'trimestre conta só os pilares medidos');
  assertLog(semIcj.nota === 1, '4 de 4 medidos vale 1,0 — não 0,8');
  const naN = evaluateQuarter(q({ icj: Number.NaN }));
  assertLog(naN.pillars.juros === null, 'NaN é tratado como dado ausente');

  // --- trimestre sem nenhum pilar medido é descartado ---
  const semNada: Partial<QuarterInput> = {
    dividaBrutaPl: null,
    liquidezCorrente: null,
    icj: null,
    lucroLiquido: null,
    fco: null,
  };
  const vazio = evaluateQuarter(q(semNada));
  assertLog(vazio.medidos === 0 && vazio.nota === null, 'trimestre sem dado tem nota null, nunca 0');
  const comVazios = scoreCompany(BASE, [...serie(MIN_QUARTERS), ...serie(5, semNada)]);
  assertLog(comVazios !== null && comVazios.trimestres === MIN_QUARTERS, 'trimestres sem dado não entram na contagem');
  assertLog(comVazios !== null && comVazios.score === 1, 'trimestres sem dado não puxam o escore para baixo');

  // --- piso de história ---
  assertLog(scoreCompany(BASE, serie(MIN_QUARTERS - 1)) === null, `${MIN_QUARTERS - 1} trimestres: fora do ranking`);
  assertLog(scoreCompany(BASE, serie(MIN_QUARTERS)) !== null, `${MIN_QUARTERS} trimestres: entra`);

  // --- escore e taxas por pilar ---
  const metade = scoreCompany(BASE, [...serie(10), ...serie(10, { icj: 0 })]);
  assertLog(metade !== null && Math.abs(metade.score - 0.9) < 1e-9, '10 trimestres perfeitos + 10 com 4/5 → escore 0,9');
  assertLog(metade !== null && metade.pilares.juros.taxa === 0.5, 'taxa do pilar juros = 50%');
  assertLog(metade !== null && metade.pilares.lucro.taxa === 1, 'taxa do pilar lucro = 100%');
  assertLog(
    metade !== null && PILLAR_KEYS.every((k) => metade.pilares[k].medidos === 20),
    'todos os pilares medidos em 20 trimestres',
  );

  // --- janela recente separada do histórico ---
  const piorou = scoreCompany(BASE, [...serie(20), ...serie(RECENT_QUARTERS, { icj: 0, lucroLiquido: -1 })]);
  assertLog(piorou !== null && piorou.recente.trimestres === RECENT_QUARTERS, 'janela recente usa os últimos 8');
  assertLog(piorou !== null && Math.abs((piorou.recente.score as number) - 0.6) < 1e-9, 'recente = 3/5 aprovados = 0,6');
  assertLog(
    piorou !== null && piorou.score > (piorou.recente.score as number),
    'histórico alto convive com recente baixo',
  );
  const curta = scoreCompany(BASE, serie(MIN_QUARTERS));
  assertLog(curta !== null && curta.recente.trimestres === RECENT_QUARTERS, 'empresa no piso ainda tem 8 recentes');

  // --- ordenação determinística ---
  const vazioPilar = { aprovados: 0, medidos: 0, taxa: null };
  const mk = (ticker: string, score: number, trimestres: number): CompanyHealth => ({
    ...BASE,
    ticker,
    score,
    trimestres,
    pilares: {
      alavancagem: vazioPilar,
      liquidez: vazioPilar,
      juros: vazioPilar,
      lucro: vazioPilar,
      caixa: vazioPilar,
    },
    recente: { score: null, trimestres: 0 },
  });
  const ord = rankCompanies([mk('BBB3', 0.5, 60), mk('AAA3', 0.9, 30), mk('CCC3', 0.9, 60), mk('AAA4', 0.9, 30)]);
  assertLog(
    ord.map((r) => r.ticker).join(',') === 'CCC3,AAA3,AAA4,BBB3',
    'ordem: escore desc, trimestres desc, ticker asc',
  );

  // --- prova de fumaça sobre o banco real ---
  const dbFile = path.join(process.cwd(), 'data', 'cvm', 'cvm_fundamentos.db');
  if (existsSync(dbFile)) {
    const rk = financialHealthRanking();
    assertLog(rk.rows.length > 0, `ranking real devolve ${rk.rows.length} empresas`);
    assertLog(
      rk.rows.every((r) => r.setorCvm === null || !FINANCIAL_SECTOR_BUCKETS.includes(r.setorCvm)),
      'nenhum ticker de bucket financeiro no ranking',
    );
    assertLog(
      rk.universo.ranqueadas + rk.universo.excluidas.length === rk.universo.total,
      'ranqueadas + excluídas = universo',
    );
    assertLog(rk.rows.every((r) => r.score >= 0 && r.score <= 1), 'todo escore dentro de [0,1]');
    assertLog(
      rk.rows.every((r) => r.trimestres >= MIN_QUARTERS),
      'toda empresa ranqueada atinge o piso de história',
    );
    assertLog(
      rk.universo.excluidas.filter((e) => e.motivo === 'SETOR_FINANCEIRO').length === 18,
      '18 empresas excluídas pelo setor financeiro',
    );
    assertLog(
      rk.rows.every((r) => r.recente.trimestres <= RECENT_QUARTERS),
      'janela recente nunca excede 8 trimestres',
    );
    const passado = financialHealthRanking('2018-01-01');
    assertLog(passado.rows.length <= rk.rows.length, 'as-of de 2018 ranqueia no máximo o que hoje ranqueia');
    console.log(
      `   universo ${rk.universo.total} · ranqueadas ${rk.universo.ranqueadas} · excluídas ${rk.universo.excluidas.length}`,
    );
  } else {
    console.log('ok: prova de fumaça pulada (banco CVM ausente no ambiente)');
  }

  console.log('saúde financeira: TODOS OS TESTES PASSARAM');
}

main();
