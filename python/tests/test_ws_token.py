"""
Testes unitários do token WS efêmero — WR Trading Pro (Fase 0, Item 10)

Rodar (conda env IA_Day_Trading):
    python python/tests/test_ws_token.py

Cobre: token válido, adulterado, expirado, aud errada, TTL acima do teto,
replay (jti de uso único), fail-closed sem secret e o fixture cross-language
gerado pela implementação TypeScript (scripts/auth/ws-token-smoke-test.mts).
"""

import base64
import hashlib
import hmac
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from ws_token import (  # noqa: E402
    AUDIENCE,
    CLOCK_SKEW_SECONDS,
    MAX_TTL_SECONDS,
    ReplayCache,
    get_ws_token_secret,
    verify_ws_token,
)

SECRET = 'w' * 48
OTHER_SECRET = 'z' * 48
NOW = 1_800_000_000  # instante fixo para determinismo
JTI = 'jti-fixo-para-teste-0001'

# Gerado por scripts/auth/ws-token-smoke-test.mts (seção [6]) com
# secret/instante/jti fixos — prova a interoperabilidade TS -> Python.
FIXTURE_SECRET = 'cross-language-fixture-secret-0123456789abcdef'
FIXTURE_TOKEN = (
    'wst1.eyJzdWIiOiJ3cl9sb2NhbCIsImF1ZCI6Im10NS13cyIsImlhdCI6MTgwMDAwMDAwMCwi'
    'ZXhwIjoxODAwMDAwMDMwLCJqdGkiOiJmaXh0dXJlLWp0aS0wMDAxIn0.'
    '1-NGlZ1_dPb09fNzWXZqQxAM9pDQZrlAYEZQ27JG-j4'
)


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode('ascii').rstrip('=')


def make_token(secret: str, sub: str = 'wr_local', aud: str = AUDIENCE,
               iat: int = NOW, exp: int = NOW + 30, jti: str = JTI,
               extra: dict = None) -> str:
    """Helper de teste: cria um token no mesmo formato da implementação TS."""
    payload = {'sub': sub, 'aud': aud, 'iat': iat, 'exp': exp, 'jti': jti}
    if extra:
        payload.update(extra)
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(',', ':')).encode('utf-8'))
    signed_part = f'wst1.{payload_b64}'
    sig = hmac.new(secret.encode('utf-8'), signed_part.encode('utf-8'), hashlib.sha256).digest()
    return f'{signed_part}.{_b64url_encode(sig)}'


class TestVerifyWsToken(unittest.TestCase):
    def test_token_valido(self):
        payload = verify_ws_token(make_token(SECRET), SECRET, now=NOW + 5)
        self.assertIsNotNone(payload)
        self.assertEqual(payload['sub'], 'wr_local')
        self.assertEqual(payload['aud'], AUDIENCE)
        self.assertEqual(payload['jti'], JTI)

    def test_payload_adulterado(self):
        token = make_token(SECRET)
        version, _, sig = token.split('.')
        forged = _b64url_encode(json.dumps({
            'sub': 'admin', 'aud': AUDIENCE, 'iat': NOW, 'exp': NOW + 30, 'jti': JTI,
        }).encode('utf-8'))
        self.assertIsNone(verify_ws_token(f'{version}.{forged}.{sig}', SECRET, now=NOW))

    def test_assinatura_adulterada(self):
        token = make_token(SECRET)
        version, payload_b64, sig = token.split('.')
        flipped = ('B' if sig[0] == 'A' else 'A') + sig[1:]
        self.assertIsNone(verify_ws_token(f'{version}.{payload_b64}.{flipped}', SECRET, now=NOW))

    def test_secret_errado(self):
        self.assertIsNone(verify_ws_token(make_token(SECRET), OTHER_SECRET, now=NOW))

    def test_formatos_invalidos(self):
        for bad in ('', 'abc', 'abc.def', 'abc.def.ghi', None, 123,
                    'wst9.' + 'a' * 10 + '.' + 'b' * 10,
                    'v1.' + 'a' * 10 + '.' + 'b' * 10,
                    'wst1.nao*base64url!.assinatura'):
            self.assertIsNone(verify_ws_token(bad, SECRET, now=NOW), msg=repr(bad))

    def test_token_gigante_rejeitado(self):
        self.assertIsNone(verify_ws_token('wst1.' + 'a' * 4096 + '.b', SECRET, now=NOW))

    def test_expirado(self):
        token = make_token(SECRET)
        self.assertIsNotNone(verify_ws_token(token, SECRET, now=NOW + 29))
        # dentro do skew ainda aceita
        self.assertIsNotNone(verify_ws_token(token, SECRET, now=NOW + 30 + CLOCK_SKEW_SECONDS - 1))
        # no limite exp + skew rejeita
        self.assertIsNone(verify_ws_token(token, SECRET, now=NOW + 30 + CLOCK_SKEW_SECONDS))
        self.assertIsNone(verify_ws_token(token, SECRET, now=NOW + 3600))

    def test_iat_no_futuro(self):
        self.assertIsNone(verify_ws_token(make_token(SECRET), SECRET,
                                          now=NOW - CLOCK_SKEW_SECONDS - 1))

    def test_aud_errada(self):
        self.assertIsNone(verify_ws_token(make_token(SECRET, aud='outra-aud'), SECRET, now=NOW))

    def test_ttl_acima_do_teto(self):
        token = make_token(SECRET, exp=NOW + MAX_TTL_SECONDS + 1)
        self.assertIsNone(verify_ws_token(token, SECRET, now=NOW))

    def test_exp_menor_ou_igual_a_iat(self):
        self.assertIsNone(verify_ws_token(make_token(SECRET, exp=NOW), SECRET, now=NOW))

    def test_claims_invalidos(self):
        self.assertIsNone(verify_ws_token(make_token(SECRET, sub=''), SECRET, now=NOW))
        self.assertIsNone(verify_ws_token(make_token(SECRET, jti='curto'), SECRET, now=NOW))

    def test_fail_closed_sem_secret(self):
        token = make_token(SECRET)
        self.assertIsNone(verify_ws_token(token, None, now=NOW))
        self.assertIsNone(verify_ws_token(token, '', now=NOW))
        self.assertIsNone(verify_ws_token(token, 'curto', now=NOW))

    def test_get_ws_token_secret_fail_closed(self):
        previous = os.environ.get('WR_WS_TOKEN_SECRET')
        try:
            os.environ.pop('WR_WS_TOKEN_SECRET', None)
            self.assertIsNone(get_ws_token_secret())
            os.environ['WR_WS_TOKEN_SECRET'] = 'curto-demais'
            self.assertIsNone(get_ws_token_secret())
            os.environ['WR_WS_TOKEN_SECRET'] = 's' * 32
            self.assertEqual(get_ws_token_secret(), 's' * 32)
        finally:
            if previous is None:
                os.environ.pop('WR_WS_TOKEN_SECRET', None)
            else:
                os.environ['WR_WS_TOKEN_SECRET'] = previous


class TestReplayCache(unittest.TestCase):
    def test_replay_rejeitado(self):
        cache = ReplayCache()
        self.assertTrue(cache.consume(JTI, NOW + 30, now=NOW))
        # segundo uso do mesmo jti deve ser rejeitado
        self.assertFalse(cache.consume(JTI, NOW + 30, now=NOW + 1))

    def test_limpeza_por_exp(self):
        cache = ReplayCache()
        self.assertTrue(cache.consume('jti-antigo-000001', NOW + 30, now=NOW))
        # bem depois de exp + skew a entrada é purgada e a memória não cresce
        self.assertTrue(cache.consume('jti-novo-00000001', NOW + 200, now=NOW + 120))
        self.assertNotIn('jti-antigo-000001', cache._seen)

    def test_fluxo_completo_com_verify(self):
        cache = ReplayCache()
        token = make_token(SECRET)
        payload = verify_ws_token(token, SECRET, now=NOW)
        self.assertIsNotNone(payload)
        self.assertTrue(cache.consume(payload['jti'], payload['exp'], now=NOW))
        # replay do mesmo token: verifica mas não consome
        replay = verify_ws_token(token, SECRET, now=NOW + 1)
        self.assertIsNotNone(replay)
        self.assertFalse(cache.consume(replay['jti'], replay['exp'], now=NOW + 1))


class TestCrossLanguageFixture(unittest.TestCase):
    def test_fixture_gerado_pelo_typescript(self):
        payload = verify_ws_token(FIXTURE_TOKEN, FIXTURE_SECRET, now=NOW + 5)
        self.assertIsNotNone(payload)
        self.assertEqual(payload['sub'], 'wr_local')
        self.assertEqual(payload['aud'], AUDIENCE)
        self.assertEqual(payload['jti'], 'fixture-jti-0001')
        self.assertEqual(payload['exp'] - payload['iat'], 30)

    def test_fixture_com_secret_errado(self):
        self.assertIsNone(verify_ws_token(FIXTURE_TOKEN, OTHER_SECRET, now=NOW + 5))


if __name__ == '__main__':
    unittest.main(verbosity=2)
