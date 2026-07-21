/**
 * Gate Admin mínimo (Item A / D5, `BacktestCostProfile` — spec revisão 4).
 *
 * A WR Trading Pro ainda não tem RBAC (autorização por perfil é item
 * pendente no roadmap — ver `wr-trading-pro-professional-upgrade` no vault
 * e "Critérios obrigatórios do produto final" em CLAUDE.md). Em vez de
 * inventar um sistema de papéis completo fora do escopo do Item A, este
 * gate é deliberadamente minúsculo: uma allowlist de identidades (`sub` do
 * token de sessão) via variável de ambiente, mesmo padrão de gate
 * fail-closed já usado no projeto (`WR_TRADING_ENABLED`). Sem a variável
 * configurada, NINGUÉM é admin — nunca abre por omissão.
 *
 * Quando um RBAC real existir, este arquivo é o único ponto a trocar —
 * `isAdmin` é a única fronteira usada pelas rotas de cost-profile.
 */
export function isAdmin(userId: string): boolean {
  const raw = process.env.WR_ADMIN_USER_IDS ?? '';
  const allowlist = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return allowlist.includes(userId);
}
