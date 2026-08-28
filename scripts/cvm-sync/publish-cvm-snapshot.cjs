#!/usr/bin/env node
/**
 * Publica um snapshot CVM candidato em `data/cvm/cvm_fundamentos.db`, com
 * gates ANTES da substituição e troca atômica.
 *
 * Fonte típica: `\\wsl.localhost\<distro>\root\.hermes\workspace\cvm_fundamentos\data\cvm_fundamentos.db`
 * (a linhagem canônica mantida pelo Guardião_Hermes).
 *
 * Por que existe: até aqui a publicação era uma cópia de arquivo — manual ou
 * pelo `merge_2t26_preserve_history.py` do WSL — sem nada conferindo o que
 * entrava. O banco vivo perdeu `fundamental_indicators` duas vezes assim
 * (2026-08-15 e 2026-08-21) e ficou com `empresas.setor_cvm` vazio em 11
 * tickers, o que colocou BBAS3/BBDC4/ITUB4 no ranking da indústria.
 *
 * Ordem, sempre:
 *   1. Copia a fonte para um temporário LOCAL, dentro de `data/cvm/`
 *      (mesmo volume do destino — é o que torna o rename atômico; e
 *      node:sqlite não abre bem em modo read-only sobre o UNC do WSL).
 *   2. Recusa fonte com `-wal`/`-shm` pendente ao lado.
 *   3. Roda TODOS os gates de `cvm-publish-gates.cjs` no candidato,
 *      comparando com o destino atual. Qualquer falha aborta antes de
 *      qualquer escrita no destino.
 *   4. Backup datado do destino em `data/cvm/backups/`.
 *   5. `fs.renameSync(tmp, destino)` — troca atômica: nunca existe um
 *      instante em que o destino esteja pela metade.
 *
 * Uso:
 *   node scripts/cvm-sync/publish-cvm-snapshot.cjs --source <path> [--distro Ubuntu] [--dry-run]
 *
 * `--dry-run` roda os gates e relata, sem tocar no destino.
 */

const fs = require('node:fs');
const path = require('node:path');
const { runGates } = require('./cvm-publish-gates.cjs');

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

function rmWithSidecars(file) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const f = `${file}${suffix}`;
    if (fs.existsSync(f)) fs.rmSync(f, { force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.source)) {
    console.error(`Fonte não encontrada: ${args.source}`);
    console.error('Verifique se o WSL está rodando (wsl.exe -l -v) e a distro (--distro).');
    process.exitCode = 1;
    return;
  }
  if (fs.existsSync(`${args.source}-wal`) || fs.existsSync(`${args.source}-shm`)) {
    console.error(
      'Fonte tem -wal/-shm pendente ao lado do .db — rode PRAGMA wal_checkpoint na origem antes de publicar (o .db principal pode estar incompleto).',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Fonte  : ${args.source}`);
  console.log(`Destino: ${DEST_FILE}`);

  fs.mkdirSync(DEST_DIR, { recursive: true });
  const tmp = path.join(DEST_DIR, `.cvm_fundamentos.db.publish-tmp-${process.pid}`);
  fs.copyFileSync(args.source, tmp);

  const destExiste = fs.existsSync(DEST_FILE);
  let veredito;
  try {
    veredito = runGates(tmp, destExiste ? DEST_FILE : null);
  } catch (err) {
    rmWithSidecars(tmp);
    console.error(`Falha ao avaliar os gates: ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
    return;
  }

  if (!veredito.ok) {
    rmWithSidecars(tmp);
    console.error(`\nPUBLICAÇÃO ABORTADA — ${veredito.falhas.length} gate(s) reprovado(s):`);
    for (const f of veredito.falhas) console.error(`  [${f.gate}] ${f.detalhe}`);
    console.error('\nDestino NÃO foi tocado.');
    process.exitCode = 1;
    return;
  }
  console.log('Todos os gates aprovados.');

  if (args.dryRun) {
    rmWithSidecars(tmp);
    console.log('--dry-run: nenhuma escrita realizada.');
    return;
  }

  if (destExiste) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backupPath = path.join(BACKUP_DIR, `cvm_fundamentos_pre_publish_${timestamp()}.db`);
    fs.copyFileSync(DEST_FILE, backupPath);
    console.log(`Backup do destino: ${backupPath}`);
  }

  // Sidecars do destino antigo não podem sobreviver ao rename: pertencem ao
  // arquivo que está sendo substituído e confundiriam o SQLite.
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const f = `${DEST_FILE}${suffix}`;
    if (fs.existsSync(f)) fs.rmSync(f, { force: true });
  }
  fs.renameSync(tmp, DEST_FILE); // atômico: mesmo diretório, mesmo volume

  console.log('Publicação concluída (troca atômica).');
}

main();
