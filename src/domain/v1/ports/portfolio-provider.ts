import type { Account, Portfolio, PortfolioRequest } from '../models';

export interface PortfolioProvider {
  listAccounts(): Promise<readonly Account[]>;
  getPortfolio(request: PortfolioRequest): Promise<Portfolio>;
}
