import type { PrismaClient } from '@prisma/client';
import { PrismaOptionPositionRepository } from '../../adapters/prisma/option-position';
import { PrismaMarketBarRepository } from '../../adapters/prisma/market-bar';
import { OptionPositionService } from './service';

export function createOptionPositionService(prisma: PrismaClient): OptionPositionService {
  return new OptionPositionService({
    optionPositionRepository: new PrismaOptionPositionRepository(prisma),
    marketBarRepository: new PrismaMarketBarRepository(prisma),
  });
}
