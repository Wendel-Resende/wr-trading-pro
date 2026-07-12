/**
 * Classificação de rotas para o middleware de autenticação — WR Trading Pro
 *
 * Módulo puro (sem imports de Node) para poder rodar no Edge runtime do
 * middleware e ser testado de forma determinística pelo smoke test.
 *
 * Política fail-closed: tudo que não for explicitamente público ou asset
 * estático é protegido — rotas novas nascem protegidas por padrão.
 */

export type RouteClass = 'asset' | 'public' | 'protected-api' | 'protected-page';

// Únicos caminhos acessíveis sem sessão válida
const PUBLIC_PAGE_PATHS = new Set(['/login']);
const PUBLIC_API_PREFIXES = ['/api/auth'];

// Extensões servidas de public/ que o middleware não deve bloquear
const STATIC_ASSET_EXTENSIONS =
  /\.(?:png|jpg|jpeg|gif|svg|ico|icns|webp|avif|woff2?|ttf|otf|css|js|map|json|txt|xml|webmanifest)$/i;

function normalize(pathname: string): string {
  let p = pathname;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

export function isApiPath(pathname: string): boolean {
  const p = normalize(pathname);
  return p === '/api' || p.startsWith('/api/');
}

export function isPublicPath(pathname: string): boolean {
  const p = normalize(pathname);
  if (PUBLIC_PAGE_PATHS.has(p)) return true;
  return PUBLIC_API_PREFIXES.some(
    (prefix) => p === prefix || p.startsWith(`${prefix}/`)
  );
}

export function classifyPath(pathname: string): RouteClass {
  const p = normalize(pathname);
  if (p.startsWith('/_next/') || p === '/_next') return 'asset';
  if (!isApiPath(p) && STATIC_ASSET_EXTENSIONS.test(p)) return 'asset';
  if (isPublicPath(p)) return 'public';
  if (isApiPath(p)) return 'protected-api';
  return 'protected-page';
}
