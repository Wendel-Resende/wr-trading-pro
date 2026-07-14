/**
 * Persistência das credenciais locais no .env — WR Trading Pro
 *
 * Usado apenas pelo fluxo de primeiro acesso (/api/auth/setup) em runtime
 * Node. Reescreve somente as linhas WR_AUTH_*, preservando o restante do
 * arquivo. Os "$" do hash scrypt são gravados escapados como "\$" porque o
 * dotenv-expand do Next trata "$..." como variável de ambiente (mesmo entre
 * aspas) e corromperia o hash — ver docs/AUTH_SETUP.md.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const MANAGED_KEYS = ['WR_AUTH_USERNAME', 'WR_AUTH_PASSWORD_HASH', 'WR_AUTH_SESSION_SECRET'];

function envFilePath(): string {
  return path.join(process.cwd(), '.env');
}

function escapeDollarsForDotenv(value: string): string {
  return value.replace(/\$/g, '\\$');
}

export interface LocalAuthCredentials {
  username: string;
  passwordHash: string;
  sessionSecret: string;
}

/**
 * Grava as credenciais no .env (cria o arquivo se não existir) e atualiza
 * process.env do processo atual com os valores crus, para que o login
 * funcione sem reiniciar o servidor.
 */
export function persistLocalAuthCredentials(creds: LocalAuthCredentials): void {
  const file = envFilePath();
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';

  const managedPattern = new RegExp(`^\\s*(${MANAGED_KEYS.join('|')})\\s*=`);
  const kept = existing
    .split(/\r?\n/)
    .filter((line) => !managedPattern.test(line));

  const block = [
    '# Autenticação local — gerada pelo primeiro acesso (não commitar)',
    `WR_AUTH_USERNAME="${creds.username}"`,
    `WR_AUTH_PASSWORD_HASH="${escapeDollarsForDotenv(creds.passwordHash)}"`,
    `WR_AUTH_SESSION_SECRET="${creds.sessionSecret}"`,
  ];

  const body = kept.join('\n').trimEnd();
  const content = (body ? `${body}\n\n` : '') + block.join('\n') + '\n';
  writeFileSync(file, content, 'utf8');

  // Valores crus (sem escape) para o processo atual
  process.env.WR_AUTH_USERNAME = creds.username;
  process.env.WR_AUTH_PASSWORD_HASH = creds.passwordHash;
  process.env.WR_AUTH_SESSION_SECRET = creds.sessionSecret;
}
