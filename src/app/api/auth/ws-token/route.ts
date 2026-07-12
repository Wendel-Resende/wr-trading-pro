import { NextRequest, NextResponse } from 'next/server';
import { getAuthConfig, SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { verifySessionToken } from '@/lib/auth/session';
import { createWsToken, getWsTokenSecret, getWsTokenTtlSeconds } from '@/lib/auth/ws-token';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Emite um token efêmero de uso único para o handshake do WebSocket MT5
 * (Fase 0, Item 10).
 *
 * /api/auth/* é público no middleware, então este handler valida a sessão
 * diretamente: configuração completa (getAuthConfig), cookie wr_session com
 * HMAC válido e sub igual ao usuário configurado. Nada é aceito do body —
 * o sub vem exclusivamente da sessão.
 */
export async function POST(request: NextRequest) {
  const config = getAuthConfig();
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!config || !sessionToken) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401, headers: NO_STORE });
  }

  const session = await verifySessionToken(config.sessionSecret, sessionToken);
  if (!session || session.sub !== config.username) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401, headers: NO_STORE });
  }

  const wsSecret = getWsTokenSecret();
  if (!wsSecret) {
    // Fail-closed: sem WR_WS_TOKEN_SECRET (>= 32 chars) nenhum token é emitido
    return NextResponse.json(
      { error: 'Autenticação do bridge não configurada no servidor.' },
      { status: 503, headers: NO_STORE }
    );
  }

  const ttlSeconds = getWsTokenTtlSeconds();
  const token = await createWsToken(wsSecret, session.sub, ttlSeconds);

  return NextResponse.json({ token, expiresIn: ttlSeconds }, { headers: NO_STORE });
}
