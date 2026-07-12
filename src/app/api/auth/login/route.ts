import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthConfig, SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { createSessionToken } from '@/lib/auth/session';
import { safeEqualStrings, verifyPassword } from '@/lib/auth/password';

export const runtime = 'nodejs';

const loginSchema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(1024),
});

// Atraso fixo em falhas para atenuar força bruta e enumeração
const FAILURE_DELAY_MS = 400;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: NextRequest) {
  const config = getAuthConfig();
  if (!config) {
    return NextResponse.json(
      { error: 'Autenticação não configurada no servidor. Consulte docs/AUTH_SETUP.md.' },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 });
  }

  // Sempre avaliar usuário E senha para manter o custo de tempo uniforme
  const usernameOk = safeEqualStrings(parsed.data.username, config.username);
  const passwordOk = verifyPassword(parsed.data.password, config.passwordHash);

  if (!usernameOk || !passwordOk) {
    await delay(FAILURE_DELAY_MS);
    return NextResponse.json({ error: 'Usuário ou senha inválidos.' }, { status: 401 });
  }

  const token = await createSessionToken(
    config.sessionSecret,
    config.username,
    config.sessionTtlSeconds
  );

  const response = NextResponse.json({ ok: true, username: config.username });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.sessionTtlSeconds,
  });
  return response;
}
