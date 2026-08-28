/**
 * Testes dos gates de publicação do snapshot CVM.
 *
 * O método é injetar UM defeito de cada vez num banco-fixture que passa em
 * tudo, e exigir que o gate correspondente — e só ele — reprove. Um teste que
 * só confirmasse o caminho feliz não teria pego nenhuma das duas regressões
 * reais que motivaram esses gates.
 *
 * Os dois defeitos históricos têm caso próprio aqui:
 *   - `fundamental_indicators` ausente (2026-08-15 e 2026-08-21)
 *   - `empresas.setor_cvm` vazio em banco listado (2026-08-28)
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { runGates, FI_COLUMNS } = require('./cvm-publish-gates.cjs') as {
  runGates: (novo: string, atual?: string | null) => { ok: boolean; falhas: { gate: string; detalhe: string }[] };
  FI_COLUMNS: readonly string[];
};

function assertLog(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  console.log(`ok: ${msg}`);
}

const DIR = mkdtempSync(path.join(tmpdir(), 'wr-cvm-gates-'));
let seq = 0;

/** Banco-fixture mínimo que passa em TODOS os gates. */
function fixture(mutate?: (db: DatabaseSync) => void): string {
  const file = path.join(DIR, `fix-${seq++}.db`);
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE empresas (
    cd_cvm TEXT PRIMARY KEY, ticker TEXT, nome TEXT, setor_cvm TEXT
  )`);
  db.exec(`CREATE TABLE dre_trimestral (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cd_cvm TEXT, ano INTEGER, trimestre INTEGER, lucro_liquido REAL
  )`);
  db.exec(`CREATE TABLE fundamental_indicators (
    ${FI_COLUMNS.map((c) =>
      c === 'id' ? 'id INTEGER PRIMARY KEY AUTOINCREMENT' : `${c} ${['cd_cvm', 'data_ref', 'fonte', 'criado_em'].includes(c) ? 'TEXT' : c === 'ano' || c === 'trimestre' ? 'INTEGER' : 'REAL'}`,
    ).join(', ')}
  )`);
  const emp = db.prepare('INSERT INTO empresas (cd_cvm, ticker, nome, setor_cvm) VALUES (?,?,?,?)');
  const dre = db.prepare('INSERT INTO dre_trimestral (cd_cvm, ano, trimestre, lucro_liquido) VALUES (?,?,?,?)');
  const fi = db.prepare('INSERT INTO fundamental_indicators (cd_cvm, ano, trimestre, divida_bruta_pl, icj) VALUES (?,?,?,?,?)');
  for (let i = 1; i <= 10; i++) {
    const cd = String(i).padStart(6, '0');
    emp.run(cd, `AAA${i}`, `Empresa ${i}`, 'Alimentos');
    for (const [ano, tri] of [[2026, 1], [2026, 2]] as const) {
      dre.run(cd, ano, tri, 100);
      fi.run(cd, ano, tri, 0.5, 3.0);
    }
  }
  if (mutate) mutate(db);
  db.close();
  return file;
}

function falhas(file: string, atual?: string | null): string[] {
  return runGates(file, atual ?? null).falhas.map((f) => f.gate);
}

function main(): void {
  // --- caminho feliz ---
  const bom = fixture();
  assertLog(runGates(bom, null).ok, 'fixture íntegro passa em todos os gates');

  // --- FUNDAMENTAL_INDICATORS: a regressão de 15/08 e 21/08 ---
  const semFi = fixture((db) => db.exec('DROP TABLE fundamental_indicators'));
  assertLog(
    falhas(semFi).includes('FUNDAMENTAL_INDICATORS'),
    'tabela `fundamental_indicators` ausente reprova (regressão de 2026-08-15 e 2026-08-21)',
  );

  const fiVazia = fixture((db) => db.exec('DELETE FROM fundamental_indicators'));
  assertLog(falhas(fiVazia).includes('FUNDAMENTAL_INDICATORS'), '`fundamental_indicators` vazia reprova');

  const fiCurta = fixture((db) => {
    db.exec('DROP TABLE fundamental_indicators');
    db.exec('CREATE TABLE fundamental_indicators (id INTEGER PRIMARY KEY, cd_cvm TEXT, ano INTEGER, trimestre INTEGER)');
    db.exec("INSERT INTO fundamental_indicators (cd_cvm, ano, trimestre) VALUES ('000001', 2026, 2)");
  });
  assertLog(
    falhas(fiCurta).includes('FUNDAMENTAL_INDICATORS'),
    'esquema sem as colunas dos pilares (divida_bruta_pl/icj) reprova',
  );

  // --- COBERTURA_TRIMESTRE: dre com trimestre que os indicadores não têm ---
  const semCobertura = fixture((db) =>
    db.exec('DELETE FROM fundamental_indicators WHERE ano = 2026 AND trimestre = 2'),
  );
  const fSemCob = falhas(semCobertura);
  assertLog(
    fSemCob.includes('COBERTURA_TRIMESTRE'),
    'trimestre mais recente da `dre` ausente nos indicadores reprova (o caso do 2T26)',
  );
  assertLog(
    !fSemCob.includes('FUNDAMENTAL_INDICATORS'),
    'cobertura incompleta NÃO é confundida com tabela ausente — gates distintos',
  );

  const coberturaParcialOk = fixture((db) =>
    db.exec("DELETE FROM fundamental_indicators WHERE ano = 2026 AND trimestre = 2 AND cd_cvm = '000001'"),
  );
  assertLog(
    !falhas(coberturaParcialOk).includes('COBERTURA_TRIMESTRE'),
    '9 de 10 empresas cobertas (90%) ainda passa — lacuna esperada do pipeline não vira bloqueio',
  );

  // --- SEM_DUPLICIDADES ---
  const dupFi = fixture((db) =>
    db.exec("INSERT INTO fundamental_indicators (cd_cvm, ano, trimestre) VALUES ('000001', 2026, 2)"),
  );
  assertLog(falhas(dupFi).includes('SEM_DUPLICIDADES'), 'chave (cd_cvm, ano, trimestre) repetida reprova');

  const dupTicker = fixture((db) =>
    db.exec("INSERT INTO empresas (cd_cvm, ticker, nome, setor_cvm) VALUES ('999999', 'AAA1', 'Clone', 'Alimentos')"),
  );
  assertLog(falhas(dupTicker).includes('SEM_DUPLICIDADES'), 'ticker duplicado em `empresas` reprova');

  // --- SETORES_VALIDOS: a regressão de 28/08 ---
  const semSetor = fixture((db) => db.exec("UPDATE empresas SET setor_cvm = NULL WHERE ticker = 'AAA1'"));
  assertLog(
    falhas(semSetor).includes('SETORES_VALIDOS'),
    '`setor_cvm` NULL reprova — é o campo que tira banco do ranking da indústria (caso BBAS3/BBDC4/ITUB4)',
  );
  const setorBranco = fixture((db) => db.exec("UPDATE empresas SET setor_cvm = '   ' WHERE ticker = 'AAA2'"));
  assertLog(falhas(setorBranco).includes('SETORES_VALIDOS'), '`setor_cvm` só com espaços também reprova');

  // --- SEM_REGRESSAO: comparação com o destino atual ---
  const menor = fixture((db) => db.exec("DELETE FROM dre_trimestral WHERE cd_cvm = '000010'"));
  assertLog(
    falhas(menor, bom).includes('SEM_REGRESSAO'),
    'candidato com menos linhas que o destino atual reprova',
  );
  assertLog(!falhas(menor, null).includes('SEM_REGRESSAO'), 'sem destino atual não há regressão a apurar');
  assertLog(
    falhas(semFi, bom).includes('SEM_REGRESSAO'),
    'tabela que DESAPARECE em relação ao destino reprova também por regressão',
  );

  const maior = fixture((db) =>
    db.exec("INSERT INTO dre_trimestral (cd_cvm, ano, trimestre, lucro_liquido) VALUES ('000001', 2025, 4, 10)"),
  );
  assertLog(!falhas(maior, bom).includes('SEM_REGRESSAO'), 'candidato com MAIS linhas passa (crescer é o normal)');

  // --- todos os gates são avaliados, não só até a primeira falha ---
  const multi = fixture((db) => {
    db.exec('DROP TABLE fundamental_indicators');
    db.exec("UPDATE empresas SET setor_cvm = NULL WHERE ticker = 'AAA1'");
  });
  const fMulti = falhas(multi);
  assertLog(
    fMulti.includes('FUNDAMENTAL_INDICATORS') && fMulti.includes('SETORES_VALIDOS'),
    'dois defeitos simultâneos são relatados juntos, não um de cada vez',
  );

  // --- prova de fumaça sobre o banco real ---
  const vivo = path.join(process.cwd(), 'data', 'cvm', 'cvm_fundamentos.db');
  if (existsSync(vivo)) {
    const v = runGates(vivo, null);
    assertLog(
      v.ok,
      `banco vivo passa em todos os gates${v.ok ? '' : ` — falhas: ${v.falhas.map((f) => `${f.gate}: ${f.detalhe}`).join(' | ')}`}`,
    );
  } else {
    console.log('ok: prova de fumaça pulada (banco CVM ausente no ambiente)');
  }

  console.log('gates de publicação CVM: TODOS OS TESTES PASSARAM');
}

try {
  main();
} finally {
  rmSync(DIR, { recursive: true, force: true });
}
