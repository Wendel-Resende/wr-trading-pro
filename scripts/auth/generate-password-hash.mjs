/**
 * Gerador de credenciais locais — WR Trading Pro (Fase 0, Item 9)
 *
 * Uso:
 *   node scripts/auth/generate-password-hash.mjs
 *
 * Pede a senha no terminal (input oculto), imprime o hash scrypt para
 * WR_AUTH_PASSWORD_HASH e um secret aleatório para WR_AUTH_SESSION_SECRET.
 * Nada é gravado em disco — copie os valores para o seu .env local.
 */

import { randomBytes, scryptSync } from 'node:crypto';
import readline from 'node:readline';

// Mesmos parâmetros de src/lib/auth/password.ts
const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64, saltBytes: 16 };

function hashPassword(password) {
  const { N, r, p, keyLength, saltBytes } = SCRYPT;
  const salt = randomBytes(saltBytes);
  const derived = scryptSync(password, salt, keyLength, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (str) => {
      // Ecoa apenas a pergunta e quebras de linha; oculta os caracteres digitados
      if (str.includes(question) || str === '\r\n' || str === '\n') write(str);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const password = await askHidden('Nova senha local (input oculto): ');
if (!password || password.length < 8) {
  console.error('Senha muito curta: use no mínimo 8 caracteres.');
  process.exit(1);
}
const confirm = await askHidden('Confirme a senha: ');
if (password !== confirm) {
  console.error('As senhas não conferem.');
  process.exit(1);
}

console.log('\nAdicione ao seu .env (NUNCA commitar):\n');
console.log(`WR_AUTH_PASSWORD_HASH="${hashPassword(password)}"`);
console.log(`WR_AUTH_SESSION_SECRET="${randomBytes(32).toString('hex')}"`);
console.log('\nDefina também WR_AUTH_USERNAME. Detalhes em docs/AUTH_SETUP.md.');
