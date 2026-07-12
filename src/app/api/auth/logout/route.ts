import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';

export const runtime = 'nodejs';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return response;
}
