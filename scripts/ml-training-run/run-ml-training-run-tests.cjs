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
  tempDir = mkdtempSync(join(os.tmpdir(), 'wr-ml-training-run-test-'));
  const databaseUrl = `file:${join(tempDir, 'test.db').replace(/\\/g, '/')}`;
  
  // Build env with Python in PATH (npm strips it from process.env.PATH)
  const testEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    WR_ADMIN_USER_IDS: 'guardiao-admin',
    WR_ML_TRAINING_POLL_INTERVAL_MS: '30',
    WR_AUTH_USERNAME: 'ml-training-run-test-user',
    WR_AUTH_PASSWORD_HASH: 'scrypt$N=16384,r=8,p=1$dGVzdHNhbHQ$dGVzdGhhc2g',
    WR_AUTH_SESSION_SECRET: 'a'.repeat(48),
    Path: `${process.env.Path || process.env.PATH || ''};C:\\Users\\rwres\\AppData\\Local\\Programs\\Python\\Python313;C:\\Users\\rwres\\AppData\\Local\\Programs\\Python\\Python313\\Scripts`,
    PATH: `${process.env.PATH || process.env.Path || ''};C:\\Users\\rwres\\AppData\\Local\\Programs\\Python\\Python313;C:\\Users\\rwres\\AppData\\Local\\Programs\\Python\\Python313\\Scripts`,
  };
  
  // Run Prisma migrations on the temp DB
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], testEnv);
  
  // Run the test file via a .cmd wrapper that sets PATH with Python
  run('cmd.exe', ['/d', '/c', 'scripts\\ml-training-run\\run-tests.cmd'], testEnv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
}
