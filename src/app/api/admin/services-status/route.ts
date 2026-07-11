import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface ServiceResult {
  name: string;
  url: string;
  status: 'online' | 'offline';
  latencyMs: number | null;
  error: string | null;
}

async function checkHttp(name: string, url: string, timeoutMs = 2000): Promise<ServiceResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    if (res.status < 500) {
      return { name, url, status: 'online', latencyMs, error: null };
    }
    return { name, url, status: 'offline', latencyMs, error: `HTTP ${res.status}` };
  } catch (err: unknown) {
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : 'connection refused';
    return { name, url, status: 'offline', latencyMs, error: msg };
  }
}

export async function GET() {
  const checks = await Promise.all([
    checkHttp('spread_api', 'http://localhost:5000/health'),
    checkHttp('volatility_api', 'http://localhost:5555/health'),
  ]);

  return NextResponse.json({
    services: checks,
    checkedAt: new Date().toISOString(),
  });
}
