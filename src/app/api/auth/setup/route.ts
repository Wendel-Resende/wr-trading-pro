import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthConfig, SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { createSessionToken } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';
import { persistLocalAuthCredentials } from '@/lib/auth/env-file';

export const runtime = 'nodejs';

const DEFAULT_TTL_SECONDS = 12 * 3600;

const setupSchema = z
  .object({
    username: z
      .string()
      .regex(/^[a-zA-Z0-9._-]{3,64}$/, 'Usuário: 3–64 caracteres (letras, números, ponto, hífen, underline).'),
    password: z.string().min(8, 'Senha: mínimo 8 caracteres.').max(1024),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'As senhas não conferem.',
    path: ['confirmPassword'],
  });

/** Informa se o primeiro acesso ainda precisa ser feito. */
export async function GET() {
  return NextResponse.json({ needsSetup: getAuthConfig() === null });
}

/**
 * Cria as credenciais locais no primeiro acesso.
 * Fail-closed: só funciona enquanto NÃO existe credencial configurada —
 * depois disso responde 409 e nunca sobrescreve o cadastro existente.
 */
export async function POST(request: NextRequest) {
  if (getAuthConfig() !== null) {
    return NextResponse.json(
      { error: 'Cadastro já realizado. Use a tela de login.' },
      { status: 409 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 });
  }

  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Dados inválidos.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const username = parsed.data.username;
  const passwordHash = hashPassword(parsed.data.password);
  const sessionSecret = randomBytes(32).toString('hex');

  try {
    persistLocalAuthCredentials({ username, passwordHash, sessionSecret });
  } catch (error) {
    console.error('[auth/setup] Falha ao gravar credenciais no .env:', error);
    return NextResponse.json(
      { error: 'Não foi possível gravar as credenciais no servidor.' },
      { status: 500 }
    );
  }

  // Auto-login: sessão criada imediatamente após o cadastro
  const token = await createSessionToken(sessionSecret, username, DEFAULT_TTL_SECONDS);
  const response = NextResponse.json({ ok: true, username });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.WR_AUTH_COOKIE_SECURE === 'true',
    path: '/',
    maxAge: DEFAULT_TTL_SECONDS,
  });
  return response;
}
