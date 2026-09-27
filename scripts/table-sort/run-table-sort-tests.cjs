const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const root = join(__dirname, '..', '..');
const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/table-sort/table-sort-test.ts'], { cwd: root, stdio: 'inherit' });
process.exitCode = result.error ? 1 : (result.status ?? 1);
