/**
 * Smoke test determinístico do token WS efêmero — WR Trading Pro (Fase 0, Item 10)
 *
 * Roda direto no Node >= 22.6 (type stripping nativo):
 *   npm run smoke:ws-token
 *   (ou: node scripts/auth/ws-token-smoke-test.mts)
 *
 * Cobre: criação/verificação, adulteração de payload/assinatura, expiração
 * com clock skew, audience errada, TTL acima do teto e formato versionado.
 * O fixture cross-language é validado por python/tests/test_ws_token.py.
 */

import {
  createWsToken,
  verifyWsToken,
  WS_TOKEN_AUDIENCE,
  WS_TOKEN_CLOCK_SKEW_SECONDS,
  WS_TOKEN_MAX_TTL_SECONDS,
} from '../../src/lib/auth/ws-token.ts';

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

const SECRET = 'w'.repeat(48);
const OTHER_SECRET = 'z'.repeat(48);
const SHORT_SECRET = 'curto';
const NOW = 1_800_000_000; // instante fixo para determinismo
const JTI = 'jti-fixo-para-teste-0001';

console.log('\n[1] Token WS — criar/verificar');
{
  const token = await createWsToken(SECRET, 'wr_local', 30, NOW, JTI);
  const payload = await verifyWsToken(SECRET, token, NOW + 5);
  check('token válido verifica', payload !== null);
  check('payload.sub correto', payload?.sub === 'wr_local');
  check('payload.aud = mt5-ws', payload?.aud === WS_TOKEN_AUDIENCE);
  check('payload.exp = iat + ttl', payload?.exp === NOW + 30);
  check('payload.jti preservado', payload?.jti === JTI);
  check('formato wst1.<payload>.<sig>', token.split('.').length === 3 && token.startsWith('wst1.'));

  const auto1 = await createWsToken(SECRET, 'wr_local');
  const auto2 = await createWsToken(SECRET, 'wr_local');
  const jti1 = (await verifyWsToken(SECRET, auto1))?.jti;
  const jti2 = (await verifyWsToken(SECRET, auto2))?.jti;
  check('jti aleatório presente', typeof jti1 === 'string' && jti1.length >= 16);
  check('jti único por token', jti1 !== jti2);
}

console.log('\n[2] Token WS — adulteração');
{
  const token = await createWsToken(SECRET, 'wr_local', 30, NOW, JTI);
  const [v, payloadB64, sigB64] = token.split('.');

  const forgedPayload = Buffer.from(
    JSON.stringify({ sub: 'admin', aud: WS_TOKEN_AUDIENCE, iat: NOW, exp: NOW + 30, jti: JTI })
  ).toString('base64url');
  check('payload adulterado rejeitado', (await verifyWsToken(SECRET, `${v}.${forgedPayload}.${sigB64}`, NOW)) === null);

  const flipped = (sigB64[0] === 'A' ? 'B' : 'A') + sigB64.slice(1);
  check('assinatura adulterada rejeitada', (await verifyWsToken(SECRET, `${v}.${payloadB64}.${flipped}`, NOW)) === null);

  check('secret errado rejeitado', (await verifyWsToken(OTHER_SECRET, token, NOW)) === null);
  check('token vazio rejeitado', (await verifyWsToken(SECRET, '', NOW)) === null);
  check('lixo rejeitado', (await verifyWsToken(SECRET, 'abc.def.ghi', NOW)) === null);
  check('versão desconhecida rejeitada', (await verifyWsToken(SECRET, `wst9.${payloadB64}.${sigB64}`, NOW)) === null);
  check('token de sessão v1 rejeitado', (await verifyWsToken(SECRET, `v1.${payloadB64}.${sigB64}`, NOW)) === null);
  check('secret vazio rejeitado (fail-closed)', (await verifyWsToken('', token, NOW)) === null);
  check('secret curto rejeitado (fail-closed)', (await verifyWsToken(SHORT_SECRET, token, NOW)) === null);
}

console.log('\n[3] Token WS — expiração e clock skew');
{
  const token = await createWsToken(SECRET, 'wr_local', 30, NOW, JTI);
  check('válido antes de expirar', (await verifyWsToken(SECRET, token, NOW + 29)) !== null);
  check('válido dentro do skew após exp', (await verifyWsToken(SECRET, token, NOW + 30 + WS_TOKEN_CLOCK_SKEW_SECONDS - 1)) !== null);
  check('rejeitado no limite exp+skew', (await verifyWsToken(SECRET, token, NOW + 30 + WS_TOKEN_CLOCK_SKEW_SECONDS)) === null);
  check('rejeitado bem depois do exp', (await verifyWsToken(SECRET, token, NOW + 3600)) === null);
  check('iat no futuro além do skew rejeitado', (await verifyWsToken(SECRET, token, NOW - WS_TOKEN_CLOCK_SKEW_SECONDS - 1)) === null);
}

console.log('\n[4] Token WS — audience e claims');
{
  // Token com aud errada, assinado com o secret correto (forja de claims)
  const badAudPayload = Buffer.from(
    JSON.stringify({ sub: 'wr_local', aud: 'outra-aud', iat: NOW, exp: NOW + 30, jti: JTI })
  ).toString('base64url');
  const signedPart = `wst1.${badAudPayload}`;
  const cryptoNode = await import('node:crypto');
  const sig = cryptoNode
    .createHmac('sha256', SECRET)
    .update(signedPart)
    .digest('base64url');
  check('aud errada rejeitada mesmo com assinatura válida', (await verifyWsToken(SECRET, `${signedPart}.${sig}`, NOW)) === null);

  const sign = (payload: object) => {
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const s = cryptoNode.createHmac('sha256', SECRET).update(`wst1.${b64}`).digest('base64url');
    return `wst1.${b64}.${s}`;
  };
  check('sem jti rejeitado', (await verifyWsToken(SECRET, sign({ sub: 'wr_local', aud: WS_TOKEN_AUDIENCE, iat: NOW, exp: NOW + 30 }), NOW)) === null);
  check('sub vazio rejeitado', (await verifyWsToken(SECRET, sign({ sub: '', aud: WS_TOKEN_AUDIENCE, iat: NOW, exp: NOW + 30, jti: JTI }), NOW)) === null);
  check('TTL acima do teto rejeitado', (await verifyWsToken(SECRET, sign({ sub: 'wr_local', aud: WS_TOKEN_AUDIENCE, iat: NOW, exp: NOW + WS_TOKEN_MAX_TTL_SECONDS + 1, jti: JTI }), NOW)) === null);
  check('exp <= iat rejeitado', (await verifyWsToken(SECRET, sign({ sub: 'wr_local', aud: WS_TOKEN_AUDIENCE, iat: NOW, exp: NOW, jti: JTI }), NOW)) === null);
}

console.log('\n[5] Token WS — teto de TTL na criação');
{
  const token = await createWsToken(SECRET, 'wr_local', 9999, NOW, JTI);
  const payload = await verifyWsToken(SECRET, token, NOW);
  check('TTL pedido acima do teto é limitado a 60s', payload !== null && payload.exp - payload.iat === WS_TOKEN_MAX_TTL_SECONDS);

  let threw = false;
  try {
    await createWsToken(SHORT_SECRET, 'wr_local', 30, NOW, JTI);
  } catch {
    threw = true;
  }
  check('criação com secret curto lança erro (fail-closed)', threw);
}

console.log('\n[6] Fixture cross-language (validado também em python/tests/test_ws_token.py)');
{
  // Mesmos valores do teste Python — se este token mudar, atualizar lá.
  const FIXTURE_SECRET = 'cross-language-fixture-secret-0123456789abcdef';
  const token = await createWsToken(FIXTURE_SECRET, 'wr_local', 30, NOW, 'fixture-jti-0001');
  console.log(`  token: ${token}`);
  const payload = await verifyWsToken(FIXTURE_SECRET, token, NOW + 5);
  check('fixture verifica em TS', payload !== null && payload.sub === 'wr_local');
}

console.log(`\nResultado: ${passed} PASS, ${failed} FAIL`);
if (failed > 0) process.exit(1);
