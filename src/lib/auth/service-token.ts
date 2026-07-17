/**
 * Token de serviço máquina-a-máquina (MCP Piloto). Aceito SOMENTE em rotas
 * /api/* como alternativa à sessão. Fail-closed: env ausente/curta recusa.
 * Edge-safe (sem node:crypto) — usado pelo middleware.
 */
const MIN_LENGTH = 32;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isValidServiceToken(header: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = env.WR_SERVICE_TOKEN?.trim() ?? '';
  if (expected.length < MIN_LENGTH) return false;
  if (!header?.startsWith('Bearer ')) return false;
  return constantTimeEqual(header.slice(7), expected);
}
