/**
 * Testes do bloco de Saúde Financeira de BANCOS (dados BCB/IFData).
 *
 * Dois blocos: regras PURAS (limiares na fronteira exata, dado ausente,
 * piso de história, perímetros não fundidos) e prova de fumaça sobre o
 * banco real. O ponto sensível é o mesmo da aba da indústria: pilar sem
 * dado NÃO reprova — e aqui isso tem alvo concreto, a razão de
 * alavancagem, que o BCB só passou a publicar em 2017.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  BANK_PILLAR_KEYS,
  BANK_THRESHOLDS,
  BANK_MIN_QUARTERS,
  BANK_RECENT_QUARTERS,
  evaluateBankQuarter,
  scoreBank,
  rankBanks,
  type BankQuarterInput,
  type BankHealth,
} from '../../src/lib/server/bcb-financial-health-rules';
import { getBankHealthRanking } from '../../src/lib/server/bcb-financial-health';

function assertLog(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  console.log(`ok: ${msg}`);
}

const BASE = { ticker: 'TEST4', cdCvm: '000001', codInst: 1, nomeBcb: 'BANCO TESTE', segmento: 'S1' };

function q(over: Partial<BankQuarterInput> = {}): BankQuarterInput {
  return {
    ano: 2020,
    trimestre: 1,
    dataBase: 202003,
    basileiaPct: 15,
    capitalNivelIPct: 13,
    alavancagemPct: 6,
    imobilizacaoPct: 20,
    lucroLiquidoBrl: 1000,
    ...over,
  };
}

function serie(n: number, over: Partial<BankQuarterInput> = {}): BankQuarterInput[] {
  return Array.from({ length: n }, (_, i) =>
    q({ ano: 2010 + Math.floor(i / 4), trimestre: (i % 4) + 1, dataBase: 201000 + i, ...over }),
  );
}

function main(): void {
  // Limiares regulatórios, não calibrados por distribuição
  assertLog(BANK_THRESHOLDS.minBasileiaPct === 10.5, 'Basileia mínima 10,5% = 8% regulatório + 2,5% de conservação');
  assertLog(BANK_THRESHOLDS.minCapitalNivelIPct === 8.5, 'Capital Nível I mínimo 8,5% = 6% + 2,5% de conservação');
  assertLog(BANK_THRESHOLDS.minAlavancagemPct === 3, 'Razão de alavancagem mínima 3% (Basileia III)');
  assertLog(BANK_THRESHOLDS.maxImobilizacaoPct === 50, 'Imobilização máxima 50% (limite BCB)');
  assertLog(BANK_PILLAR_KEYS.length === 5, 'cinco pilares bancários');

  // Fronteira exata: valor igual ao limiar aprova
  assertLog(evaluateBankQuarter(q({ basileiaPct: 10.5 })).pillars.basileia === true, 'Basileia exatamente 10,5% aprova');
  assertLog(evaluateBankQuarter(q({ basileiaPct: 10.49 })).pillars.basileia === false, 'Basileia 10,49% reprova');
  assertLog(evaluateBankQuarter(q({ capitalNivelIPct: 8.5 })).pillars.capitalNivelI === true, 'Capital Nível I exatamente 8,5% aprova');
  assertLog(evaluateBankQuarter(q({ alavancagemPct: 3 })).pillars.alavancagem === true, 'alavancagem exatamente 3% aprova');
  assertLog(evaluateBankQuarter(q({ imobilizacaoPct: 50 })).pillars.imobilizacao === true, 'imobilização exatamente 50% aprova (é teto, não piso)');
  assertLog(evaluateBankQuarter(q({ imobilizacaoPct: 50.01 })).pillars.imobilizacao === false, 'imobilização 50,01% reprova');
  assertLog(evaluateBankQuarter(q({ lucroLiquidoBrl: 0 })).pillars.lucro === false, 'lucro zero reprova (não é maior que zero)');
  assertLog(evaluateBankQuarter(q({ lucroLiquidoBrl: -1 })).pillars.lucro === false, 'prejuízo reprova');

  // Dado ausente: não aprova e NÃO reprova
  const semAlav = evaluateBankQuarter(q({ alavancagemPct: null }));
  assertLog(semAlav.pillars.alavancagem === null, 'alavancagem ausente (pré-2017) vira null, não false');
  assertLog(semAlav.medidos === 4, 'trimestre sem alavancagem mede 4 pilares, não 5');
  assertLog(semAlav.nota === 1, 'trimestre sem alavancagem com os outros 4 aprovados tem nota 1, não 0,8');

  const nada = evaluateBankQuarter(q({
    basileiaPct: null, capitalNivelIPct: null, alavancagemPct: null,
    imobilizacaoPct: null, lucroLiquidoBrl: null,
  }));
  assertLog(nada.medidos === 0 && nada.nota === null, 'trimestre sem nenhum dado tem nota null, nunca 0');

  assertLog(evaluateBankQuarter(q({ basileiaPct: Number.NaN })).pillars.basileia === null, 'NaN é tratado como ausente, não comparado');
  assertLog(evaluateBankQuarter(q({ basileiaPct: Number.POSITIVE_INFINITY })).pillars.basileia === null, 'Infinity é tratado como ausente');

  // Piso de história
  assertLog(BANK_MIN_QUARTERS === 20, 'piso de 20 trimestres, igual ao da aba da indústria');
  assertLog(scoreBank(BASE, serie(BANK_MIN_QUARTERS - 1)) === null, 'banco com 19 trimestres fica fora do ranking');
  assertLog(scoreBank(BASE, serie(BANK_MIN_QUARTERS)) !== null, 'banco com exatamente 20 trimestres entra');

  const soSemDado = serie(30, {
    basileiaPct: null, capitalNivelIPct: null, alavancagemPct: null,
    imobilizacaoPct: null, lucroLiquidoBrl: null,
  });
  assertLog(scoreBank(BASE, soSemDado) === null, '30 trimestres sem dado nenhum não passam do piso (conta MEDIDOS, não linhas)');

  // Janela recente separada do escore histórico
  assertLog(BANK_RECENT_QUARTERS === 8, 'janela recente de 8 trimestres');
  const declinio = [...serie(24), ...serie(8, { lucroLiquidoBrl: -5, basileiaPct: 9 })];
  const d = scoreBank(BASE, declinio);
  assert.ok(d);
  assertLog(d.recente.score !== null && d.recente.score < d.score, 'banco que piorou tem recente ABAIXO do histórico — a divergência é a informação');
  assertLog(d.recente.trimestres === 8, 'janela recente usa a cauda de 8 trimestres');

  // Taxa por pilar
  const meio = [...serie(20, { imobilizacaoPct: 10 }), ...serie(20, { imobilizacaoPct: 90 })];
  const m = scoreBank(BASE, meio);
  assert.ok(m);
  assertLog(m.pilares.imobilizacao.taxa === 0.5, 'taxa por pilar é aprovados/medidos (20 de 40 = 0,5)');
  const semAlavSempre = scoreBank(BASE, serie(24, { alavancagemPct: null }));
  assert.ok(semAlavSempre);
  assertLog(semAlavSempre.pilares.alavancagem.taxa === null, 'pilar que nunca teve dado tem taxa null, não 0');
  assertLog(semAlavSempre.pilares.alavancagem.medidos === 0, 'pilar nunca medido tem medidos 0');

  // Valores atuais — descritivos, ao lado do escore e nunca dentro dele
  const comAtual = scoreBank(BASE, [...serie(24), q({ dataBase: 202512, basileiaPct: 17.7 })]);
  assert.ok(comAtual);
  assertLog(comAtual.atual.dataBase === 202512, 'valores atuais vêm da última data-base');
  assertLog(comAtual.atual.basileiaPct === 17.7, 'Basileia atual é o valor publicado, não uma nota');
  assertLog(comAtual.score === 1, 'valores atuais não alteram o escore');

  const ultimoVazio = scoreBank(BASE, [
    ...serie(24),
    q({ dataBase: 202509, basileiaPct: 12.3 }),
    q({
      dataBase: 202512, basileiaPct: null, capitalNivelIPct: null,
      alavancagemPct: null, imobilizacaoPct: null, lucroLiquidoBrl: null,
    }),
  ]);
  assert.ok(ultimoVazio);
  assertLog(
    ultimoVazio.atual.dataBase === 202509 && ultimoVazio.atual.basileiaPct === 12.3,
    'trimestre final sem dado nenhum não vira "valor atual" vazio — usa o último efetivamente publicado',
  );

  // Ordenação determinística
  const a = scoreBank({ ...BASE, ticker: 'ZZZZ4' }, serie(20));
  const b = scoreBank({ ...BASE, ticker: 'AAAA4' }, serie(40));
  assert.ok(a && b);
  const ord = rankBanks([a, b] as readonly BankHealth[]);
  assertLog(ord[0].ticker === 'AAAA4', 'empate de escore: mais trimestres primeiro (mais evidência ganha)');

  // Prova de fumaça sobre o banco real
  const dbPath = path.join(process.cwd(), 'data', 'cvm', 'cvm_fundamentos.db');
  if (!existsSync(dbPath)) {
    console.log('aviso: banco real ausente — prova de fumaça pulada');
    console.log('bcb-financial-health: TODOS OS TESTES PASSARAM');
    return;
  }

  const rank = getBankHealthRanking();
  assertLog(rank.bancos.length === 10, `os 10 bancos B3 aparecem no ranking (obtido: ${rank.bancos.length})`);
  assertLog(rank.excluidos.length === 0, 'nenhum banco excluído por falta de história (todos têm 45 trimestres)');

  for (const banco of rank.bancos) {
    assertLog(banco.trimestres >= BANK_MIN_QUARTERS, `${banco.ticker}: ${banco.trimestres} trimestres avaliados`);
    assertLog(banco.score >= 0 && banco.score <= 1, `${banco.ticker}: escore em [0,1] (${banco.score.toFixed(3)})`);
  }

  const alavParcial = rank.bancos.filter((x) => x.pilares.alavancagem.medidos < x.trimestres);
  assertLog(alavParcial.length === 10, 'todos os 10 têm alavancagem medida em MENOS trimestres que o total — o pré-2017 não virou reprovação');

  // Perímetros NÃO fundidos
  assertLog(rank.bancos.every((x) => x.codInst > 0), 'todo banco carrega o cod_inst prudencial de onde o escore veio');
  const comInad = rank.bancos.filter((x) => x.inadimplencia !== null);
  assertLog(comInad.length > 0, 'inadimplência do perímetro financeiro é lida para ao menos um banco');
  assertLog(
    comInad.every((x) => x.inadimplencia !== null && x.inadimplencia.codInst !== x.codInst),
    'cod_inst financeiro é DIFERENTE do prudencial — perímetros distintos, jamais somados',
  );
  assertLog(
    comInad.every((x) => x.inadimplencia !== null && x.inadimplencia.pct >= 0 && x.inadimplencia.pct <= 100),
    'inadimplência é percentual em [0,100]',
  );
  assertLog(
    !Object.keys(rank.bancos[0].pilares).includes('inadimplencia'),
    'inadimplência NÃO é pilar — fica fora do escore prudencial',
  );

  // O escore contra régua regulatória quase não discrimina — é por isso que os
  // valores atuais existem. Este teste trava a razão: se um dia o escore passar
  // a variar sozinho, ótimo; enquanto não passar, a coluna que informa é esta.
  const escoresDistintos = new Set(rank.bancos.map((x) => x.score.toFixed(3))).size;
  const basileiasDistintas = new Set(
    rank.bancos.map((x) => x.atual.basileiaPct).filter((v) => v !== null),
  ).size;
  assertLog(
    basileiasDistintas > escoresDistintos,
    `Basileia atual discrimina mais que o escore (${basileiasDistintas} valores distintos contra ${escoresDistintos} escores)`,
  );
  assertLog(
    rank.bancos.every((x) => x.atual.dataBase === x.dataBaseFim),
    'valor atual de cada banco vem da sua própria última data-base avaliada',
  );

  assertLog(typeof rank.provenance.source === 'string' && rank.provenance.source.length > 0, 'proveniência declarada na resposta');
  assertLog(rank.asOfPrudencial > 0 && rank.asOfFinanceiro > 0, 'data-base de cada perímetro declarada separadamente');

  console.log('bcb-financial-health: TODOS OS TESTES PASSARAM');
}

main();
