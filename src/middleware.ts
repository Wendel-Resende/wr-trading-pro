/**
 * Middleware de autenticação — WR Trading Pro (Fase 0, Item 9)
 *
 * Protege todas as páginas e rotas /api por padrão (fail-closed).
 * Públicos: /login e /api/auth/*. Assets do Next e arquivos estáticos
 * passam direto (ver classifyPath em src/lib/auth/routes.ts).
 *
 * Roda no Edge runtime: usa apenas módulos Edge-safe (Web Crypto).
 */

import { NextRequest, NextResponse } from 'next/server';
import { classifyPath } from '@/lib/auth/routes';
import { getAuthConfig, SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { verifySessionToken } from '@/lib/auth/session';

async function isAuthenticated(request: NextRequest): Promise<boolean> {
  // Exige a configuração completa, não apenas o secret. Assim, remover usuário
  // ou hash invalida imediatamente todas as sessões (fail-closed).
  const authConfig = getAuthConfig();
  if (!authConfig) return false;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return false;
  const payload = await verifySessionToken(authConfig.sessionSecret, token);
  return payload?.sub === authConfig.username;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const routeClass = classifyPath(pathname);

  if (routeClass === 'asset') {
    return NextResponse.next();
  }

  if (routeClass === 'public') {
    // Usuário já autenticado não precisa da tela de login
    if (pathname === '/login' && (await isAuthenticated(request))) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  if (await isAuthenticated(request)) {
    return NextResponse.next();
  }

  if (routeClass === 'protected-api') {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }

  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  // Exclui internals do Next; a classificação fina fica em classifyPath
  matcher: ['/((?!_next/).*)'],
};
