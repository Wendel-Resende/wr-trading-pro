"""
Verificação do token efêmero do WebSocket MT5 — WR Trading Pro (Fase 0, Item 10)

Formato (interoperável com src/lib/auth/ws-token.ts — mudanças precisam ser
espelhadas lá): wst1.<payload base64url>.<assinatura base64url>
Payload JSON: { sub, aud: 'mt5-ws', iat, exp, jti } (segundos Unix).
Assinatura: HMAC-SHA256(secret, "wst1.<payload base64url>").

Propriedades:
- Fail-closed: secret ausente/curto ou qualquer falha de validação rejeita.
- Comparação de assinatura com hmac.compare_digest (tempo constante).
- Uso único: cada jti é consumido em uma replay cache em memória; segundo
  uso do mesmo token é rejeitado. Entradas expiradas são limpas pelo exp.
- O token nunca deve aparecer em logs.
"""

import base64
import hashlib
import hmac
import json
import os
import re
import time
from typing import Any, Dict, Optional

TOKEN_VERSION = 'wst1'
AUDIENCE = 'mt5-ws'
MAX_TTL_SECONDS = 60
CLOCK_SKEW_SECONDS = 10
MIN_SECRET_LENGTH = 32
MAX_TOKEN_LENGTH = 2048

_BASE64URL_RE = re.compile(r'^[A-Za-z0-9_-]+$')


def get_ws_token_secret() -> Optional[str]:
    """Secret do env, ou None se ausente/curto demais (fail-closed)."""
    secret = (os.environ.get('WR_WS_TOKEN_SECRET') or '').strip()
    return secret if len(secret) >= MIN_SECRET_LENGTH else None


def _b64url_decode(value: str) -> Optional[bytes]:
    if not _BASE64URL_RE.match(value):
        return None
    padded = value + '=' * ((4 - len(value) % 4) % 4)
    try:
        return base64.urlsafe_b64decode(padded)
    except (ValueError, TypeError):
        return None


class ReplayCache:
    """Cache em memória de jti já consumidos, limpa por exp.

    O bridge roda em um único event loop asyncio, então não há concorrência
    real aqui; a estrutura é um dict simples jti -> exp.
    """

    def __init__(self) -> None:
        self._seen: Dict[str, float] = {}

    def _purge(self, now: float) -> None:
        expired = [jti for jti, exp in self._seen.items()
                   if exp + CLOCK_SKEW_SECONDS < now]
        for jti in expired:
            del self._seen[jti]

    def consume(self, jti: str, exp: float, now: Optional[float] = None) -> bool:
        """Consome o jti. Retorna False se já foi usado (replay)."""
        if now is None:
            now = time.time()
        self._purge(now)
        if jti in self._seen:
            return False
        self._seen[jti] = exp
        return True


def verify_ws_token(
    token: Any,
    secret: Optional[str],
    now: Optional[float] = None,
) -> Optional[Dict[str, Any]]:
    """Verifica assinatura, formato, audience, expiração e TTL máximo.

    Retorna o payload quando válido, ou None para qualquer falha
    (fail-closed). Uso único (jti) fica a cargo de ReplayCache.consume().
    """
    if not secret or len(secret) < MIN_SECRET_LENGTH:
        return None
    if not isinstance(token, str) or not token or len(token) > MAX_TOKEN_LENGTH:
        return None

    parts = token.split('.')
    if len(parts) != 3 or parts[0] != TOKEN_VERSION:
        return None
    version, payload_b64, signature_b64 = parts

    signature = _b64url_decode(signature_b64)
    payload_bytes = _b64url_decode(payload_b64)
    if signature is None or payload_bytes is None:
        return None

    expected = hmac.new(
        secret.encode('utf-8'),
        f'{version}.{payload_b64}'.encode('utf-8'),
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(expected, signature):
        return None

    try:
        payload = json.loads(payload_bytes.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(payload, dict):
        return None

    sub = payload.get('sub')
    aud = payload.get('aud')
    iat = payload.get('iat')
    exp = payload.get('exp')
    jti = payload.get('jti')
    if not isinstance(sub, str) or not sub:
        return None
    if aud != AUDIENCE:
        return None
    if not isinstance(iat, (int, float)) or not isinstance(exp, (int, float)):
        return None
    if isinstance(iat, bool) or isinstance(exp, bool):
        return None
    if not isinstance(jti, str) or len(jti) < 8:
        return None

    if now is None:
        now = time.time()

    ttl = exp - iat
    if ttl <= 0 or ttl > MAX_TTL_SECONDS:
        return None
    # iat no futuro além do skew tolerado = relógio inconsistente ou forjado
    if iat > now + CLOCK_SKEW_SECONDS:
        return None
    if now >= exp + CLOCK_SKEW_SECONDS:
        return None

    return payload
