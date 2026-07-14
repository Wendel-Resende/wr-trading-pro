import type { PrismaClient } from '@prisma/client';
import { PrismaOrderIntentRepository } from '../../adapters/prisma/order-intent';
import { PrismaRiskPolicyRepository } from '../../adapters/prisma/risk-policy';
import { OrderIntentService } from './service';

export function createOrderIntentService(prisma: PrismaClient): OrderIntentService {
  return new OrderIntentService({
    orderIntentRepository: new PrismaOrderIntentRepository(prisma),
    riskPolicyRepository: new PrismaRiskPolicyRepository(prisma),
  });
}

/** `config.tradingEnabled` é derivado de `process.env.WR_TRADING_ENABLED` SOMENTE aqui (adapter); o núcleo nunca lê `process.env`. */
export function resolveOrderIntentConfigFromEnv(): { readonly tradingEnabled: boolean; readonly policyVersion: string } {
  return {
    tradingEnabled: process.env.WR_TRADING_ENABLED === 'true',
    policyVersion: 'order-intent/v1',
  };
}
