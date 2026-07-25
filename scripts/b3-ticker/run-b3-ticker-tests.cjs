const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const result = spawnSync(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'scripts/b3-ticker/b3-ticker-test.ts'],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) {
  console.error(result.error);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
