import { NextRequest, NextResponse } from 'next/server';
import { getAuthConfig, SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { verifySessionToken } from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const config = getAuthConfig();
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!config || !token) {
    return NextResponse.json({ authenticated: false }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const payload = await verifySessionToken(config.sessionSecret, token);
  if (!payload || payload.sub !== config.username) {
    return NextResponse.json({ authenticated: false }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  return NextResponse.json({
    authenticated: true,
    username: payload.sub,
    expiresAt: payload.exp,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
