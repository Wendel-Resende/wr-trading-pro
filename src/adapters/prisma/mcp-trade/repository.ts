import type { PrismaClient, McpTradeProposal as McpTradeProposalRow } from '@prisma/client';

/**
 * MCP Piloto — Task 6: persistência mínima do trilho de trade governado.
 * Repositório fino (sem regra de negócio) — todo o gate propose -> risk ->
 * code -> approve -> intent vive no `McpTradeService`.
 */
export interface McpTradeProposalRecord {
  readonly id: string;
  readonly proposalId: string;
  readonly requestedBy: string;
  readonly symbol: string;
  readonly direction: string;
  readonly volume: number;
  readonly stopLoss: number | null;
  readonly takeProfit: number | null;
  readonly rationale: string;
  readonly decisionId: string | null;
  readonly status: string;
  readonly executionState: string | null;
  readonly confirmationCodeHash: string;
  readonly codeAttempts: number;
  readonly expiresAt: Date;
  readonly executionJson: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateMcpTradeProposalInput {
  readonly proposalId: string;
  readonly requestedBy: string;
  readonly symbol: string;
  readonly direction: string;
  readonly volume: number;
  readonly stopLoss?: number | null;
  readonly takeProfit?: number | null;
  readonly rationale: string;
  readonly decisionId: string | null;
  readonly status: string;
  readonly confirmationCodeHash: string;
  readonly expiresAt: Date;
  /** Explícito (não `@default(now())`) para permitir clock injetado nos testes do gate. */
  readonly createdAt: Date;
}

export interface UpdateMcpTradeProposalInput {
  readonly status?: string;
  readonly executionState?: string | null;
  readonly codeAttempts?: number;
  readonly executionJson?: string | null;
}

function toRecord(row: McpTradeProposalRow): McpTradeProposalRecord {
  return {
    id: row.id,
    proposalId: row.proposalId,
    requestedBy: row.requestedBy,
    symbol: row.symbol,
    direction: row.direction,
    volume: row.volume,
    stopLoss: row.stopLoss,
    takeProfit: row.takeProfit,
    rationale: row.rationale,
    decisionId: row.decisionId,
    status: row.status,
    executionState: row.executionState,
    confirmationCodeHash: row.confirmationCodeHash,
    codeAttempts: row.codeAttempts,
    expiresAt: row.expiresAt,
    executionJson: row.executionJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaMcpTradeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateMcpTradeProposalInput): Promise<McpTradeProposalRecord> {
    const row = await this.prisma.mcpTradeProposal.create({
      data: {
        proposalId: input.proposalId,
        requestedBy: input.requestedBy,
        symbol: input.symbol,
        direction: input.direction,
        volume: input.volume,
        stopLoss: input.stopLoss ?? null,
        takeProfit: input.takeProfit ?? null,
        rationale: input.rationale,
        decisionId: input.decisionId,
        status: input.status,
        confirmationCodeHash: input.confirmationCodeHash,
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
      },
    });
    return toRecord(row);
  }

  async findByProposalId(proposalId: string): Promise<McpTradeProposalRecord | null> {
    const row = await this.prisma.mcpTradeProposal.findUnique({ where: { proposalId } });
    return row ? toRecord(row) : null;
  }

  async update(proposalId: string, input: UpdateMcpTradeProposalInput): Promise<McpTradeProposalRecord> {
    const row = await this.prisma.mcpTradeProposal.update({
      where: { proposalId },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.executionState !== undefined ? { executionState: input.executionState } : {}),
        ...(input.codeAttempts !== undefined ? { codeAttempts: input.codeAttempts } : {}),
        ...(input.executionJson !== undefined ? { executionJson: input.executionJson } : {}),
      },
    });
    return toRecord(row);
  }

  async countRecentByRequester(requestedBy: string, since: Date): Promise<number> {
    return this.prisma.mcpTradeProposal.count({
      where: { requestedBy, createdAt: { gt: since } },
    });
  }

  /**
   * Transição atômica `PENDING_HUMAN -> toStatus`, condicionada por
   * `updateMany` (sem leitura-antes-de-escrever). Fecha a corrida de dois
   * `approve` concorrentes: só uma chamada consegue `count === 1`; a
   * perdedora recebe `count === 0` (sem erro Prisma cru, sem 2ª execução).
   */
  async transitionFromPendingHuman(proposalId: string, toStatus: string): Promise<boolean> {
    const result = await this.prisma.mcpTradeProposal.updateMany({
      where: { proposalId, status: 'PENDING_HUMAN' },
      data: { status: toStatus },
    });
    return result.count === 1;
  }
}
