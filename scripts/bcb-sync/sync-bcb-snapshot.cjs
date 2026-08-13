#!/usr/bin/env node
/**
 * Sincroniza SOMENTE as tabelas bcb_* do snapshot SQLite da fonte canônica
 * (WSL, mantida pelo Guardião_Hermes) para o destino da aplicação WR Trading
 * Pro, sem tocar nas tabelas CVM pré-existentes no destino.
 *
 * Fonte : \\wsl.localhost\<distro>\root\.hermes\workspace\cvm_fundamentos\data\cvm_fundamentos.db
 *         (equivalente, dentro do WSL, a /root/.hermes/workspace/cvm_fundamentos/data/cvm_fundamentos.db)
 * Destino: data/cvm/cvm_fundamentos.db (neste repositório)
 *
 * Por que tabela-a-tabela e não sobrescrever o arquivo inteiro: o destino
 * já recebeu atualizações CVM (ex.: dividendos_jcp_dmpl) mais recentes que
 * o snapshot atual da fonte BCB. Sobrescrever o arquivo inteiro REGREDIRIA
 * essas tabelas CVM — proibido pelo critério de aceitação "tabelas CVM
 * pré-existentes permanecem presentes e com contagens não reduzidas".
 * Em vez disso, cada tabela bcb_* é recriada (DROP + CREATE a partir do SQL
 * de origem, incluindo índices) e populada via ATTACH DATABASE, deixando
 * toda tabela não-bcb_* do destino intocada.
 *
 * Passos, sempre nesta ordem:
 *   1. Cópia local da fonte (bytes) para inspeção — node:sqlite não abre
 *      bem em modo somente-leitura sobre o caminho UNC \\wsl.localhost\...
 *      (erro "database is locked", aparentemente do driver 9p do WSL).
 *   2. PRAGMA integrity_check na cópia local da fonte.
 *   3. Backup datado do destino atual (se existir) em data/cvm/backups/.
 *   4. Para cada uma das 26 tabelas bcb_*: recria o schema exato (via
 *      sqlite_master da fonte) e substitui o conteúdo via ATTACH DATABASE.
 *      Nenhuma tabela CVM é tocada.
 *   5. PRAGMA integrity_check no destino final — se falhar, restaura o
 *      backup automaticamente e sai com erro.
 *   6. Relatório de contagem de linhas por tabela bcb_* (fonte vs destino)
 *      e confirmação de que as tabelas CVM não regrediram.
 *
 * Não lê nem grava nada fora de data/cvm/**. Não usa credenciais.
 *
 * Uso:
 *   node scripts/bcb-sync/sync-bcb-snapshot.cjs [--source <path>] [--distro <nome>] [--dry-run]
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DEST_DIR = path.join(ROOT, 'data', 'cvm');
const DEST_FILE = path.join(DEST_DIR, 'cvm_fundamentos.db');
const BACKUP_DIR = path.join(DEST_DIR, 'backups');

function parseArgs(argv) {
  const args = { distro: 'Ubuntu', dryRun: false, source: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') args.source = argv[++i];
    else if (a === '--distro') args.distro = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
  }
  if (!args.source) {
    args.source = `\\\\wsl.localhost\\${args.distro}\\root\\.hermes\\workspace\\cvm_fundamentos\\data\\cvm_fundamentos.db`;
  }
  return args;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function integrityCheck(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare('PRAGMA integrity_check').get();
    const value = row && (row.integrity_check ?? Object.values(row)[0]);
    return value === 'ok';
  } finally {
    db.close();
  }
}

const BCB_TABLES = [
  'bcb_prudencial_capital', 'bcb_prudencial_ativo', 'bcb_prudencial_passivo',
  'bcb_prudencial_dre', 'bcb_prudencial_resumo', 'bcb_prudencial_segmentacao',
  'bcb_prudencial_carteira_indexador', 'bcb_prudencial_carteira_regiao',
  'bcb_prudencial_carteira_instrumentos', 'bcb_prudencial_carteira_clientes',
  'bcb_prudencial_carteira_pf_modalidade', 'bcb_prudencial_carteira_pj_modalidade',
  'bcb_prudencial_carteira_pj_cnae', 'bcb_prudencial_carteira_pj_porte',
  'bcb_financeiro_carteira_clientes', 'bcb_financeiro_carteira_indexador',
  'bcb_financeiro_carteira_nivel_risco', 'bcb_financeiro_carteira_pf_modalidade',
  'bcb_financeiro_carteira_pj_cnae', 'bcb_financeiro_carteira_pj_modalidade',
  'bcb_financeiro_carteira_pj_porte', 'bcb_financeiro_carteira_regiao',
  'bcb_financeiro_ativo', 'bcb_financeiro_passivo', 'bcb_financeiro_dre',
  'bcb_financeiro_resumo', 'bcb_financeiro_capital',
];

const CVM_TABLES = [
  'empresas', 'indicadores', 'bpa_trimestral', 'bpp_trimestral', 'capital_social',
  'dfc_trimestral', 'dividendos_jcp_dmpl', 'dra_trimestral', 'dre_trimestral',
  'dva_trimestral',
];

function countRows(file, tables) {
  const db = new DatabaseSync(file, { readOnly: true });
  const counts = {};
  try {
    for (const t of tables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get();
        counts[t] = Number(row.n);
      } catch {
        counts[t] = null; // tabela ausente
      }
    }
  } finally {
    db.close();
  }
  return counts;
}

function sum(obj) {
  return Object.values(obj).reduce((a, b) => a + (b ?? 0), 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.source)) {
    console.error(`Fonte não encontrada: ${args.source}`);
    console.error('Verifique se o WSL está rodando (wsl.exe -l -v) e o caminho da distro (--distro).');
    process.exitCode = 1;
    return;
  }

  // Recusa copiar arquivos -wal/-shm como se fossem o banco principal:
  // confirma que não há sidecar de WAL pendente ao lado da fonte.
  const sourceWal = `${args.source}-wal`;
  const sourceShm = `${args.source}-shm`;
  if (fs.existsSync(sourceWal) || fs.existsSync(sourceShm)) {
    console.error(
      'Fonte tem -wal/-shm pendente ao lado do .db — rode PRAGMA wal_checkpoint na origem antes de sincronizar (dados podem estar incompletos no .db principal).'
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Fonte : ${args.source}`);
  console.log(`Destino: ${DEST_FILE}`);

  fs.mkdirSync(DEST_DIR, { recursive: true });
  // node:sqlite via DatabaseSync não abre bem em modo readOnly sobre o
  // caminho UNC \\wsl.localhost\... ("database is locked", provavelmente
  // do driver 9p do WSL) — copiamos bytes para um arquivo LOCAL temporário
  // primeiro (fs.copyFileSync não usa locking SQLite) e inspecionamos essa
  // cópia local, que também é a fonte usada pelo ATTACH DATABASE abaixo.
  const tmpSourceLocal = path.join(DEST_DIR, `.cvm_fundamentos.db.source-tmp-${process.pid}`);
  fs.copyFileSync(args.source, tmpSourceLocal);

  const rmWithSidecars = (file) => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const f = `${file}${suffix}`;
      if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    }
  };
  const cleanupSourceTmp = () => rmWithSidecars(tmpSourceLocal);

  if (!integrityCheck(tmpSourceLocal)) {
    cleanupSourceTmp();
    console.error('PRAGMA integrity_check da FONTE não retornou "ok" — abortando.');
    process.exitCode = 1;
    return;
  }
  console.log('Fonte: PRAGMA integrity_check = ok');

  const sourceBcbCounts = countRows(tmpSourceLocal, BCB_TABLES);
  const sourceBcbTotal = sum(sourceBcbCounts);
  console.log(`Fonte: soma de linhas bcb_* = ${sourceBcbTotal}`);

  if (args.dryRun) {
    cleanupSourceTmp();
    console.log('--dry-run: nenhuma escrita realizada.');
    console.log(JSON.stringify({ sourceBcbCounts, sourceBcbTotal }, null, 2));
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  let backupPath = null;
  let destCvmCountsBefore = null;
  const destExisted = fs.existsSync(DEST_FILE);
  if (destExisted) {
    destCvmCountsBefore = countRows(DEST_FILE, CVM_TABLES);
    backupPath = path.join(BACKUP_DIR, `cvm_fundamentos_pre_bcb_sync_${timestamp()}.db`);
    fs.copyFileSync(DEST_FILE, backupPath);
    console.log(`Backup do destino: ${backupPath}`);
  } else {
    console.log('Destino ainda não existe — criando do zero (sem CVM pré-existente a preservar).');
    // Sem tabelas CVM no destino ainda: base o arquivo novo na cópia da
    // fonte inteira (contém CVM + BCB), depois seguimos o mesmo caminho
    // de recriação tabela-a-tabela abaixo (idempotente e sem efeito extra).
    fs.copyFileSync(tmpSourceLocal, DEST_FILE);
  }

  try {
    const db = new DatabaseSync(DEST_FILE);
    try {
      db.exec(`ATTACH DATABASE '${tmpSourceLocal.replace(/'/g, "''")}' AS src`);

      const getCreateSql = (table) => {
        const row = db
          .prepare(`SELECT sql FROM src.sqlite_master WHERE type = 'table' AND name = ?`)
          .get(table);
        return row ? row.sql : null;
      };
      const getIndexSqls = (table) => {
        const rows = db
          .prepare(
            `SELECT sql FROM src.sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`
          )
          .all(table);
        return rows.map((r) => r.sql);
      };

      db.exec('BEGIN');
      for (const t of BCB_TABLES) {
        const createSql = getCreateSql(t);
        if (!createSql) {
          throw new Error(`Tabela ${t} não encontrada na fonte (sqlite_master) — abortando.`);
        }
        const indexSqls = getIndexSqls(t);
        db.exec(`DROP TABLE IF EXISTS main."${t}"`);
        db.exec(createSql);
        db.exec(`INSERT INTO main."${t}" SELECT * FROM src."${t}"`);
        for (const idxSql of indexSqls) {
          db.exec(idxSql);
        }
      }
      db.exec('COMMIT');
      db.exec('DETACH DATABASE src');
    } finally {
      db.close();
    }
  } catch (err) {
    if (backupPath && fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, DEST_FILE);
      console.error(`Falha na sincronização — destino restaurado a partir do backup ${backupPath}.`);
    }
    cleanupSourceTmp();
    console.error(err.message || err);
    process.exitCode = 1;
    return;
  }

  cleanupSourceTmp();

  const finalOk = integrityCheck(DEST_FILE);
  console.log(`Destino final: PRAGMA integrity_check = ${finalOk ? 'ok' : 'FALHOU'}`);
  if (!finalOk) {
    if (backupPath && fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, DEST_FILE);
      console.error(`Destino restaurado a partir do backup ${backupPath}.`);
    }
    process.exitCode = 1;
    return;
  }

  // Confirma que nenhuma tabela CVM pré-existente regrediu em contagem.
  if (destCvmCountsBefore) {
    const destCvmCountsAfter = countRows(DEST_FILE, CVM_TABLES);
    let regressed = false;
    for (const t of CVM_TABLES) {
      const before = destCvmCountsBefore[t] ?? 0;
      const after = destCvmCountsAfter[t] ?? 0;
      if (after < before) {
        regressed = true;
        console.error(`  REGRESSÃO em tabela CVM "${t}": ${before} -> ${after}`);
      }
    }
    if (regressed) {
      if (backupPath && fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, DEST_FILE);
        console.error(`Destino restaurado a partir do backup ${backupPath} (regressão CVM detectada pós-sync).`);
      }
      process.exitCode = 1;
      return;
    }
    console.log('Tabelas CVM pré-existentes: nenhuma regressão de contagem.');
  }

  const destBcbCounts = countRows(DEST_FILE, BCB_TABLES);
  const destBcbTotal = sum(destBcbCounts);
  console.log(`Destino: soma de linhas bcb_* = ${destBcbTotal} (fonte: ${sourceBcbTotal})`);

  let mismatch = false;
  for (const t of BCB_TABLES) {
    if (sourceBcbCounts[t] !== destBcbCounts[t]) {
      mismatch = true;
      console.warn(`  divergência em ${t}: fonte=${sourceBcbCounts[t]} destino=${destBcbCounts[t]}`);
    }
  }
  if (!mismatch) console.log('Todas as 26 tabelas bcb_* reproduzidas com contagem idêntica à fonte.');

  const destCvmCounts = countRows(DEST_FILE, CVM_TABLES);
  console.log('Tabelas CVM no destino final:');
  for (const t of CVM_TABLES) {
    console.log(`  ${t}: ${destCvmCounts[t]}`);
  }

  console.log('Sincronização concluída com sucesso.');
}

main();
