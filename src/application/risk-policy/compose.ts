import type { PrismaClient } from '@prisma/client';
import { PrismaRiskPolicyRepository } from '../../adapters/prisma/risk-policy';
import { RiskPolicyService } from './service';

export function createRiskPolicyService(prisma: PrismaClient): RiskPolicyService {
  return new RiskPolicyService({
    riskPolicyRepository: new PrismaRiskPolicyRepository(prisma),
  });
}

/** `config.tradingEnabled` é derivado de `process.env.WR_TRADING_ENABLED` SOMENTE aqui (adapter); o núcleo nunca lê `process.env`. */
export function resolveRiskPolicyConfigFromEnv(): { readonly tradingEnabled: boolean; readonly policyVersion: string } {
  return {
    tradingEnabled: process.env.WR_TRADING_ENABLED === 'true',
    policyVersion: 'risk-policy/v1',
  };
}
