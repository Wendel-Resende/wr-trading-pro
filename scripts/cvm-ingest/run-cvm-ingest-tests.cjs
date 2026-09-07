const { rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const dist = join(__dirname, '.dist');

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? 'unknown status'}`);
};

try {
  rmSync(dist, { recursive: true, force: true });
  run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'scripts/cvm-ingest/tsconfig.json']);
  // O parser é PURO: nenhum banco, nenhuma rede. O teste não precisa de
  // DATABASE_URL nem de migrations.
  run(process.execPath, ['scripts/cvm-ingest/.dist/scripts/cvm-ingest/cvm-ingest-test.js']);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(dist, { recursive: true, force: true });
}
