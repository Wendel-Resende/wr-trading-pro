/**
 * Smoke test determinístico da autenticação local — WR Trading Pro
 *
 * Roda direto no Node >= 22.6 (type stripping nativo; padrão no Node 23+):
 *   npm run smoke:auth
 *   (ou: node scripts/auth/auth-smoke-test.mts)
 *
 * Cobre: criação/verificação/adulteração/expiração do token de sessão,
 * verificação de senha scrypt e classificação de rotas do middleware.
 */

import { createSessionToken, verifySessionToken } from '../../src/lib/auth/session.ts';
import { hashPassword, verifyPassword, safeEqualStrings } from '../../src/lib/auth/password.ts';
import { classifyPath } from '../../src/lib/auth/routes.ts';
import { getAuthConfig } from '../../src/lib/auth/config.ts';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}`);
  }
}

const SECRET = 's'.repeat(48);
const OTHER_SECRET = 'x'.repeat(48);
const NOW = 1_800_000_000; // instante fixo para determinismo

console.log('\n[1] Token de sessão — criar/verificar');
{
  const token = await createSessionToken(SECRET, 'wr_local', 3600, NOW);
  const payload = await verifySessionToken(SECRET, token, NOW + 10);
  check('token válido verifica', payload !== null);
  check('payload.sub correto', payload?.sub === 'wr_local');
  check('payload.exp = iat + ttl', payload?.exp === NOW + 3600);
  check('formato v1.<payload>.<sig>', token.split('.').length === 3 && token.startsWith('v1.'));
}

console.log('\n[2] Token de sessão — adulteração');
{
  const token = await createSessionToken(SECRET, 'wr_local', 3600, NOW);
  const [v, payloadB64, sigB64] = token.split('.');

  const forgedPayload = Buffer.from(JSON.stringify({ sub: 'admin', iat: NOW, exp: NOW + 999999 }))
    .toString('base64url');
  check('payload adulterado rejeitado', (await verifySessionToken(SECRET, `${v}.${forgedPayload}.${sigB64}`, NOW)) === null);

  const flipped = (sigB64[0] === 'A' ? 'B' : 'A') + sigB64.slice(1);
  check('assinatura adulterada rejeitada', (await verifySessionToken(SECRET, `${v}.${payloadB64}.${flipped}`, NOW)) === null);

  check('secret errado rejeitado', (await verifySessionToken(OTHER_SECRET, token, NOW)) === null);
  check('token vazio rejeitado', (await verifySessionToken(SECRET, '', NOW)) === null);
  check('lixo rejeitado', (await verifySessionToken(SECRET, 'abc.def.ghi', NOW)) === null);
  check('versão desconhecida rejeitada', (await verifySessionToken(SECRET, `v9.${payloadB64}.${sigB64}`, NOW)) === null);
  check('secret vazio rejeitado (fail-closed)', (await verifySessionToken('', token, NOW)) === null);
}

console.log('\n[3] Token de sessão — expiração');
{
  const token = await createSessionToken(SECRET, 'wr_local', 3600, NOW);
  check('válido antes de expirar', (await verifySessionToken(SECRET, token, NOW + 3599)) !== null);
  check('rejeitado exatamente no exp', (await verifySessionToken(SECRET, token, NOW + 3600)) === null);
  check('rejeitado depois do exp', (await verifySessionToken(SECRET, token, NOW + 7200)) === null);
}

console.log('\n[4] Senha — scrypt');
{
  const hash = hashPassword('senha-correta-123');
  check('hash tem formato scrypt$...', hash.startsWith('scrypt$16384$8$1$'));
  check('senha correta verifica', verifyPassword('senha-correta-123', hash));
  check('senha errada falha', !verifyPassword('senha-errada', hash));
  check('hash malformado falha', !verifyPassword('qualquer', 'nao-e-um-hash'));
  check('hash vazio falha', !verifyPassword('qualquer', ''));
  check('safeEqualStrings igual', safeEqualStrings('wr_local', 'wr_local'));
  check('safeEqualStrings diferente', !safeEqualStrings('wr_local', 'outro'));
}

console.log('\n[5] Classificação de rotas do middleware');
{
  // Públicas
  check('/login é public', classifyPath('/login') === 'public');
  check('/login/ é public', classifyPath('/login/') === 'public');
  check('/api/auth/login é public', classifyPath('/api/auth/login') === 'public');
  check('/api/auth/session é public', classifyPath('/api/auth/session') === 'public');
  check('/api/auth/logout é public', classifyPath('/api/auth/logout') === 'public');

  // Assets
  check('/_next/static/x.js é asset', classifyPath('/_next/static/chunks/x.js') === 'asset');
  check('/favicon.ico é asset', classifyPath('/favicon.ico') === 'asset');
  check('/icon.png é asset', classifyPath('/icon.png') === 'asset');

  // Páginas protegidas
  for (const page of ['/', '/admin', '/ml', '/settings', '/qualquer-rota-nova']) {
    check(`${page} é protected-page`, classifyPath(page) === 'protected-page');
  }

  // Todos os 22 grupos de rotas API existentes são protegidos
  const apiRoutes = [
    '/api/metrics',
    '/api/logs',
    '/api/dividend-map',
    '/api/dividend-map/1',
    '/api/stock-monitoring',
    '/api/stock-monitoring/1',
    '/api/stock-monitoring/1/price',
    '/api/stock-monitoring/summary',
    '/api/stock-monitoring/import-positions',
    '/api/stock-monitoring/sync-prices',
    '/api/stock-alerts',
    '/api/stock-alerts/1',
    '/api/stock-reports',
    '/api/stock-reports/1',
    '/api/assets',
    '/api/volatility',
    '/api/spread-orders',
    '/api/spread-orders/1',
    '/api/admin/services-status',
    '/api/historical-candles',
    '/api/llm/chat',
    '/api/agents',
  ];
  for (const route of apiRoutes) {
    check(`${route} é protected-api`, classifyPath(route) === 'protected-api');
  }
  check('/api novo qualquer é protected-api', classifyPath('/api/nova-rota-futura') === 'protected-api');
  // Tentativa de bypass com sufixo de asset em rota API continua protegida
  check('/api/logs/x.json continua protected-api', classifyPath('/api/logs/x.json') === 'protected-api');
}

console.log('\n[6] Configuração — fail-closed completo');
{
  const previous = {
    username: process.env.WR_AUTH_USERNAME,
    hash: process.env.WR_AUTH_PASSWORD_HASH,
    secret: process.env.WR_AUTH_SESSION_SECRET,
  };
  try {
    process.env.WR_AUTH_USERNAME = 'wr_local';
    process.env.WR_AUTH_PASSWORD_HASH = hashPassword('senha-correta-123');
    process.env.WR_AUTH_SESSION_SECRET = 'a'.repeat(64);
    check('configuração completa é aceita', getAuthConfig() !== null);

    delete process.env.WR_AUTH_USERNAME;
    check('sem username rejeita toda a configuração', getAuthConfig() === null);
    process.env.WR_AUTH_USERNAME = 'wr_local';

    delete process.env.WR_AUTH_PASSWORD_HASH;
    check('sem password hash rejeita toda a configuração', getAuthConfig() === null);
    process.env.WR_AUTH_PASSWORD_HASH = hashPassword('senha-correta-123');

    delete process.env.WR_AUTH_SESSION_SECRET;
    check('sem session secret rejeita toda a configuração', getAuthConfig() === null);
  } finally {
    if (previous.username === undefined) delete process.env.WR_AUTH_USERNAME;
    else process.env.WR_AUTH_USERNAME = previous.username;
    if (previous.hash === undefined) delete process.env.WR_AUTH_PASSWORD_HASH;
    else process.env.WR_AUTH_PASSWORD_HASH = previous.hash;
    if (previous.secret === undefined) delete process.env.WR_AUTH_SESSION_SECRET;
    else process.env.WR_AUTH_SESSION_SECRET = previous.secret;
  }
}

console.log(`\nResultado: ${passed} PASS, ${failed} FAIL`);
if (failed > 0) process.exit(1);
