"""
Configuração de rede segura para os serviços Python do WR Trading Pro.

Todos os serviços devem escutar apenas em loopback (127.0.0.1) e aceitar
CORS apenas da origem do app local. Nunca expor em 0.0.0.0.
"""
import os

# Host de bind: sempre loopback. Override permitido via env apenas para dev.
NETWORK_HOST = os.environ.get('WRTP_BIND_HOST', '127.0.0.1')

# Origens CORS permitidas (allowlist estrita).
ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://localhost:5173',  # dev opcional
    'http://127.0.0.1:5173',
]

CORS_OPTIONS = {
    'origins': ALLOWED_ORIGINS,
    'methods': ['GET', 'POST', 'OPTIONS'],
    'allow_headers': ['Content-Type', 'Authorization'],
    'supports_credentials': False,
    'max_age': 600,
}
