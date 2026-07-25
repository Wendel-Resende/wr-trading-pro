const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const r = spawnSync(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'scripts/cvm-fundamentals/cvm-fundamentals-test.ts'],
  { cwd: root, stdio: 'inherit' },
);
if (r.error) {
  console.error(r.error);
  process.exitCode = 1;
} else {
  process.exitCode = r.status ?? 1;
}
