import { getAuthConfig, SESSION_COOKIE_NAME } from '../../../../lib/auth/config';
import { verifySessionToken } from '../../../../lib/auth/session';

/**
 * Derives `requestedBy` from the authenticated session cookie — never from
 * the request body. The global middleware already rejects unauthenticated
 * requests to `/api/v1/**` (fail-closed), so by the time a route handler
 * runs this should always resolve; the 'unknown' fallback only guards
 * against a config/session edge-case, it never trusts client input.
 */
export async function resolveRequestedBy(request: Request): Promise<string> {
  const authConfig = getAuthConfig();
  if (!authConfig) return 'unknown';

  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!match) return 'unknown';

  const token = decodeURIComponent(match.slice(SESSION_COOKIE_NAME.length + 1));
  const payload = await verifySessionToken(authConfig.sessionSecret, token);
  return payload?.sub ?? 'unknown';
}
