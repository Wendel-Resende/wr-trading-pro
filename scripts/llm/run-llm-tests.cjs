const { rmSync, mkdtempSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const os = require('node:os');

const root = join(__dirname, '..', '..');
const dist = join(__dirname, '.dist');

const run = (command, args, env) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false, env: env ?? process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? 'unknown status'}`);
};

// Ambiente determinístico: nenhuma chave/endpoint de LLM herdada do shell do
// desenvolvedor deve vazar para os testes de fallback/allowlist/persistência
// — cada teste que precisa de uma env var específica a define explicitamente.
const LLM_ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_DEFAULT_MODEL',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_DEFAULT_MODEL',
  'QWEN_API_KEY',
  'GROQ_API_KEY',
  'MANUS_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_DEFAULT_MODEL',
  'OPENROUTER_APP_TITLE',
  'OPENROUTER_HTTP_REFERER',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_DEFAULT_MODEL',
  'LM_STUDIO_ENDPOINT',
  'LM_STUDIO_DEFAULT_MODEL',
  'LM_STUDIO_API_KEY',
  'OLLAMA_ENDPOINT',
  'OLLAMA_DEFAULT_MODEL',
  'WR_LLM_CONFIG_ENCRYPTION_KEY',
];

let tempDir = null;
try {
  rmSync(dist, { recursive: true, force: true });
  run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'scripts/llm/tsconfig.json']);

  // Banco SQLite descartável fora do repositório — nunca toca prisma/dev.db.
  tempDir = mkdtempSync(join(os.tmpdir(), 'wr-llm-test-'));
  const databaseUrl = `file:${join(tempDir, 'test.db').replace(/\\/g, '/')}`;

  const testEnv = { ...process.env, DATABASE_URL: databaseUrl };
  for (const key of LLM_ENV_KEYS) delete testEnv[key];

  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], testEnv);
  run(process.execPath, ['-r', './scripts/llm/register-paths.cjs', 'scripts/llm/.dist/scripts/llm/llm-test.js'], testEnv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(dist, { recursive: true, force: true });
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
}
