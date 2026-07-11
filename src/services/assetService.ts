import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AssetInput {
  symbol: string;
  name: string;
  type: 'STOCK' | 'ETF' | 'CRYPTO' | 'FOREX';
  exchange: string;
}

export class AssetService {
  /**
   * Listar todos os ativos
   */
  async getAll() {
    return prisma.asset.findMany({
      orderBy: {
        symbol: 'asc',
      },
    });
  }

  /**
   * Buscar ativo por ID
   */
  async getById(id: string) {
    return prisma.asset.findUnique({
      where: { id },
    });
  }

  /**
   * Buscar ativo por símbolo
   */
  async getBySymbol(symbol: string) {
    return prisma.asset.findUnique({
      where: { symbol },
    });
  }

  /**
   * Buscar ativos por tipo
   */
  async getByType(type: 'STOCK' | 'ETF' | 'CRYPTO' | 'FOREX') {
    return prisma.asset.findMany({
      where: { type },
      orderBy: {
        symbol: 'asc',
      },
    });
  }

  /**
   * Buscar ativos por exchange
   */
  async getByExchange(exchange: string) {
    return prisma.asset.findMany({
      where: { exchange },
      orderBy: {
        symbol: 'asc',
      },
    });
  }

  /**
   * Criar novo ativo
   */
  async create(input: AssetInput) {
    return prisma.asset.create({
      data: input,
    });
  }

  /**
   * Buscar ou criar ativo baseado no símbolo
   * Se o ativo não existir, cria um novo com dados padrão
   */
  async getOrCreate(symbol: string, name?: string, type: 'STOCK' | 'ETF' | 'CRYPTO' | 'FOREX' = 'STOCK', exchange: string = 'B3') {
    // Tenta buscar pelo símbolo
    const existing = await this.getBySymbol(symbol);
    
    if (existing) {
      return existing;
    }

    // Cria novo ativo se não existir
    return this.create({
      symbol,
      name: name || symbol,
      type,
      exchange,
    });
  }

  /**
   * Atualizar ativo
   */
  async update(id: string, data: Partial<AssetInput>) {
    return prisma.asset.update({
      where: { id },
      data,
    });
  }

  /**
   * Deletar ativo
   */
  async delete(id: string) {
    return prisma.asset.delete({
      where: { id },
    });
  }

  /**
   * Buscar ações (STOCK type)
   */
  async getStocks() {
    return this.getByType('STOCK');
  }

  /**
   * Buscar ações da B3
   */
  async getB3Stocks() {
    return prisma.asset.findMany({
      where: {
        type: 'STOCK',
        exchange: 'B3',
      },
      orderBy: {
        symbol: 'asc',
      },
    });
  }
}

// Singleton
let assetServiceInstance: AssetService | null = null;

export const AssetServiceSingleton = {
  getInstance: (): AssetService => {
    if (!assetServiceInstance) {
      assetServiceInstance = new AssetService();
    }
    return assetServiceInstance;
  },
};
