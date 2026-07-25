const { rmSync, mkdtempSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const os = require('node:os');

const root = join(__dirname, '..', '..');

const run = (command, args, env, shell = false) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell, env: env ?? process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? 'unknown status'}`);
};

let tempDir = null;
try {
  tempDir = mkdtempSync(join(os.tmpdir(), 'wr-directional-test-'));
  const databaseUrl = `file:${join(tempDir, 'test.db').replace(/\\/g, '/')}`;
  const testEnv = { ...process.env, DATABASE_URL: databaseUrl, WR_ADMIN_USER_IDS: 'guardiao-admin' };
  
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], testEnv);
  run('cmd.exe', ['/d', '/c', 'scripts\\directional\\run-tests.cmd'], testEnv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
}
