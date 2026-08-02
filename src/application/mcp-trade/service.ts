import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { RiskPolicyService } from '../risk-policy/service';
import type { OrderIntentService } from '../order-intent/service';
import type { PilotExecutionPort } from '../../domain/v1/ports/pilot-execution';
import type { RiskDecision } from '../../domain/v1/models/risk-policy';
import { RISK_POLICY_VERSION } from '../../domain/v1/models/risk-policy';
import type { OrderIntent } from '../../domain/v1/models/order-intent';
import { ReadModelError } from '../read-models-v1/errors';
import { PrismaMcpTradeRepository, type McpTradeProposalRecord } from '../../adapters/prisma/mcp-trade/repository';

/**
 * MCP Piloto — Task 6: trilho de trade governado — MAIS crítico do plano.
 *
 * Fluxo fixo: `propose` (rate limit -> snapshot -> RiskPolicy) -> code de
 * 6 dígitos armazenado só como hash -> `approve` (código -> OrderIntent ->
 * kill switch real -> broker). `execution.send` NUNCA é chamado em nenhum
 * caminho de falha (risco rejeitado, código errado/expirado, estado
 * inválido, kill switch desligado) — só depois que o `OrderIntentService`
 * cria a intent com sucesso.
 */
export interface MarketSnapshotPort {
  get(symbol: string): Promise<{ readonly referencePrice: number; readonly currentPositionQty: number; readonly portfolioNav: number }>;
}

export interface McpTradeServiceDeps {
  readonly prisma: PrismaClient;
  readonly riskPolicy: RiskPolicyService;
  readonly orderIntent: OrderIntentService;
  readonly execution: PilotExecutionPort;
  readonly snapshot: MarketSnapshotPort;
  readonly clock?: () => Date;
  readonly env?: NodeJS.ProcessEnv;
}

export interface ProposeTradeInputV1 {
  readonly requestedBy: string;
  readonly symbol: string;
  readonly direction: 'BUY' | 'SELL';
  readonly volume: number;
  readonly stopLoss?: number;
  readonly takeProfit?: number;
  readonly rationale: string;
}

export interface ProposeTradeResultV1 {
  readonly proposalId: string;
  readonly status: string;
  readonly riskOutcome: RiskDecision['outcome'];
  readonly riskReasons: RiskDecision['reasons'];
  readonly confirmationCode?: string;
  readonly expiresAt?: string;
}

export interface ApproveTradeInputV1 {
  readonly proposalId: string;
  readonly confirmationCode: string;
}

export interface ApproveTradeResultV1 {
  readonly status: string;
  readonly executionState?: string | null;
  readonly execution?: { readonly ok: boolean; readonly ticket?: number; readonly price?: number; readonly error?: string };
}

export interface McpTradeStatusV1 {
  readonly proposal: Omit<McpTradeProposalRecord, 'confirmationCodeHash'>;
  readonly riskDecision: RiskDecision | null;
  readonly intents: readonly OrderIntent[];
}

const MAX_CODE_ATTEMPTS = 3;
const EXPIRY_MINUTES = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const DECISION_TIME_OFFSET_MS = 60 * 1000;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Comparação de hash em tempo constante (`sha256` sempre produz 64 hex chars / 32 bytes dos dois lados). */
function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Sem WR_MCP_TRADE_ALLOWLIST no .env: nenhuma restrição de instrumento —
// qualquer ativo que o MT5 conectado consiga cotar é elegível. Setar a env
// var reativa a trava (lista explícita de tickers permitidos).
function parseAllowlist(env: NodeJS.ProcessEnv): readonly string[] {
  const raw = env.WR_MCP_TRADE_ALLOWLIST ?? '';
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function parseNumberEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stripHash(record: McpTradeProposalRecord): Omit<McpTradeProposalRecord, 'confirmationCodeHash'> {
  const { confirmationCodeHash: _confirmationCodeHash, ...rest } = record;
  return rest;
}

export class McpTradeService {
  private readonly repo: PrismaMcpTradeRepository;
  private readonly clock: () => Date;
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly deps: McpTradeServiceDeps) {
    this.repo = new PrismaMcpTradeRepository(deps.prisma);
    this.clock = deps.clock ?? (() => new Date());
    this.env = deps.env ?? process.env;
  }

  async propose(input: ProposeTradeInputV1): Promise<ProposeTradeResultV1> {
    if (!Number.isFinite(input.volume) || input.volume <= 0) {
      throw new ReadModelError('INVALID_QUERY', 'volume deve ser um número finito maior que zero');
    }

    const now = this.clock();
    const maxPerHour = parseNumberEnv(this.env, 'WR_MCP_TRADE_MAX_PROPOSALS_PER_HOUR', 10);
    const recentCount = await this.repo.countRecentByRequester(input.requestedBy, new Date(now.getTime() - RATE_LIMIT_WINDOW_MS));
    if (recentCount >= maxPerHour) {
      throw new ReadModelError('RATE_LIMITED', 'limite de propostas por hora excedido');
    }

    const snapshot = await this.deps.snapshot.get(input.symbol);
    const decisionTime = new Date(now.getTime() + DECISION_TIME_OFFSET_MS).toISOString();

    // UUID: contrato com as tools trade.* (schema z.string().uuid()) — achado
    // do E2E real: formato "mcp-<ts>-<n>" era rejeitado pelo zod das tools.
    const proposalId = randomUUID();

    const proposal = {
      kind: 'PROPOSAL' as const,
      instrumentId: input.symbol,
      direction: input.direction,
      rationale: input.rationale,
      risks: [] as const,
      confidence: 1,
      decisionTime,
      requiresHumanApproval: true as const,
    };

    const limits = {
      maxNotional: parseNumberEnv(this.env, 'WR_MCP_TRADE_MAX_NOTIONAL', 50_000),
      maxPositionConcentrationPct: parseNumberEnv(this.env, 'WR_MCP_TRADE_MAX_CONCENTRATION_PCT', 20),
      maxProposalsPerRun: 1,
      instrumentAllowlist: parseAllowlist(this.env),
    };

    const context = {
      referencePrice: snapshot.referencePrice,
      proposedQuantity: input.volume,
      currentPositionQty: snapshot.currentPositionQty,
      portfolioNav: snapshot.portfolioNav,
      limits,
    };

    const riskResult = await this.deps.riskPolicy.evaluate(
      { runId: `mcp:${proposalId}`, requestedBy: input.requestedBy, proposal, context, decisionTime },
      { tradingEnabled: true, policyVersion: RISK_POLICY_VERSION },
    );

    if (riskResult.outcome === 'REJECTED') {
      await this.repo.create({
        proposalId,
        requestedBy: input.requestedBy,
        symbol: input.symbol,
        direction: input.direction,
        volume: input.volume,
        stopLoss: input.stopLoss ?? null,
        takeProfit: input.takeProfit ?? null,
        rationale: input.rationale,
        decisionId: riskResult.decisionId,
        status: 'RISK_REJECTED',
        confirmationCodeHash: sha256('unused'),
        expiresAt: now,
        createdAt: now,
      });
      return {
        proposalId,
        status: 'RISK_REJECTED',
        riskOutcome: riskResult.outcome,
        riskReasons: riskResult.reasons,
      };
    }

    const confirmationCode = String(randomInt(100000, 1000000));
    const expiresAt = new Date(now.getTime() + EXPIRY_MINUTES * 60 * 1000);

    await this.repo.create({
      proposalId,
      requestedBy: input.requestedBy,
      symbol: input.symbol,
      direction: input.direction,
      volume: input.volume,
      stopLoss: input.stopLoss ?? null,
      takeProfit: input.takeProfit ?? null,
      rationale: input.rationale,
      decisionId: riskResult.decisionId,
      status: 'PENDING_HUMAN',
      confirmationCodeHash: sha256(confirmationCode),
      expiresAt,
      createdAt: now,
    });

    return {
      proposalId,
      status: 'PENDING_HUMAN',
      riskOutcome: riskResult.outcome,
      riskReasons: riskResult.reasons,
      confirmationCode,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async approve(input: ApproveTradeInputV1): Promise<ApproveTradeResultV1> {
    const now = this.clock();
    const record = await this.repo.findByProposalId(input.proposalId);
    if (!record) {
      throw new ReadModelError('NOT_FOUND', 'proposta não encontrada');
    }
    if (record.status !== 'PENDING_HUMAN') {
      throw new ReadModelError('INVALID_STATE', 'proposta não está aguardando aprovação humana');
    }
    if (now.getTime() > record.expiresAt.getTime()) {
      await this.repo.update(input.proposalId, { status: 'EXPIRED' });
      throw new ReadModelError('PROPOSAL_EXPIRED', 'proposta expirada');
    }

    if (!hashesMatch(sha256(input.confirmationCode), record.confirmationCodeHash)) {
      const attempts = record.codeAttempts + 1;
      if (attempts >= MAX_CODE_ATTEMPTS) {
        await this.repo.update(input.proposalId, { status: 'EXPIRED', codeAttempts: attempts });
      } else {
        await this.repo.update(input.proposalId, { codeAttempts: attempts });
      }
      throw new ReadModelError('INVALID_CODE', 'código de confirmação inválido');
    }

    // Transição atômica PENDING_HUMAN -> APPROVED via `updateMany` (sem
    // leitura-antes-de-escrever): fecha a corrida de dois `approve`
    // concorrentes que passaram pelos mesmos gates acima. A chamada
    // perdedora recebe `count === 0` -> INVALID_STATE limpo, nunca um erro
    // Prisma cru vazando pro chamador.
    const claimed = await this.repo.transitionFromPendingHuman(input.proposalId, 'APPROVED');
    if (!claimed) {
      throw new ReadModelError('INVALID_STATE', 'proposta não está aguardando aprovação humana');
    }

    // decisionId sempre presente aqui: só chega em PENDING_HUMAN quando o risco aprovou (com decisionId).
    const decisionId = record.decisionId as string;
    // `decisionTime` é exigido pelo tipo `CreateOrderIntentInputV1`, mas
    // `OrderIntentService.create` nunca o lê: o `decisionTime` do
    // `OrderIntent` final é sempre herdado do `RiskDecision` (ver
    // `createOrderIntent` em domain/v1/models/order-intent). Mantido aqui
    // só para satisfazer o contrato de tipo do serviço reusado.
    const decisionTime = new Date(now.getTime() + DECISION_TIME_OFFSET_MS).toISOString();

    let intentResult: Awaited<ReturnType<OrderIntentService['create']>>;
    try {
      intentResult = await this.deps.orderIntent.create(
        {
          decisionId,
          idempotencyKey: input.proposalId,
          quantity: record.volume,
          decisionTime,
          requestedBy: record.requestedBy,
          approvedBy: 'user-via-mcp:hermes',
        },
        { tradingEnabled: this.env.WR_TRADING_ENABLED === 'true', policyVersion: 'order-intent/v1' },
      );
    } catch (error) {
      if (error instanceof ReadModelError && error.code === 'TRADING_DISABLED') {
        const updated = await this.repo.update(input.proposalId, { status: 'APPROVED', executionState: 'BLOCKED_KILL_SWITCH' });
        return { status: updated.status, executionState: updated.executionState };
      }
      // Estado intermediário 'APPROVED' fica persistido — nunca volta pra
      // PENDING_HUMAN (o código já foi gasto) — mas também não dispara o
      // broker. Erros aqui não deveriam ocorrer em operação normal
      // (decisionId sempre existe e sempre é APPROVED/acionável quando a
      // proposta chegou em PENDING_HUMAN); propagados como estão.
      throw error;
    }

    // R5 do OrderIntentService: reenvio com a mesma idempotencyKey retorna
    // a intent já existente sem recriar. Se a intent já existia (ex.: um
    // approve anterior chegou a criar a intent mas caiu antes de enviar ao
    // broker), NUNCA reemitir a ordem — apenas refletir o estado já
    // persistido.
    if (intentResult.replayed) {
      const current = (await this.repo.findByProposalId(input.proposalId))!;
      return { status: current.status, executionState: current.executionState ?? 'REPLAY_SUPPRESSED' };
    }

    let result: { readonly ok: boolean; readonly ticket?: number; readonly price?: number; readonly error?: string };
    try {
      result = await this.deps.execution.send({
        symbol: record.symbol,
        direction: record.direction as 'BUY' | 'SELL',
        volume: record.volume,
        stopLoss: record.stopLoss ?? undefined,
        takeProfit: record.takeProfit ?? undefined,
        comment: `mcp:${input.proposalId}`,
      });
    } catch (error) {
      // Exceção do broker (timeout, conexão) — nunca deixa a proposta presa
      // num estado intermediário: grava EXECUTION_FAILED com o erro
      // sanitizado (mensagem apenas, sem stack) e devolve. Retry cai no
      // check `status !== PENDING_HUMAN` acima -> INVALID_STATE, sem
      // chamar o broker de novo.
      const message = error instanceof Error ? error.message : 'erro desconhecido do broker';
      const updated = await this.repo.update(input.proposalId, {
        status: 'EXECUTION_FAILED',
        executionJson: JSON.stringify({ ok: false, error: message }),
      });
      return { status: updated.status, executionState: updated.executionState, execution: { ok: false, error: message } };
    }

    if (result.ok) {
      const updated = await this.repo.update(input.proposalId, {
        status: 'EXECUTED',
        executionState: 'SENT',
        executionJson: JSON.stringify(result),
      });
      return { status: updated.status, executionState: updated.executionState, execution: result };
    }

    const updated = await this.repo.update(input.proposalId, {
      status: 'EXECUTION_FAILED',
      executionJson: JSON.stringify(result),
    });
    return { status: updated.status, executionState: updated.executionState, execution: result };
  }

  async reject(proposalId: string): Promise<{ readonly status: string }> {
    const record = await this.repo.findByProposalId(proposalId);
    if (!record) {
      throw new ReadModelError('NOT_FOUND', 'proposta não encontrada');
    }
    if (record.status !== 'PENDING_HUMAN') {
      throw new ReadModelError('INVALID_STATE', 'proposta não está aguardando aprovação humana');
    }
    const updated = await this.repo.update(proposalId, { status: 'REJECTED' });
    return { status: updated.status };
  }

  async status(proposalId: string): Promise<McpTradeStatusV1> {
    const record = await this.repo.findByProposalId(proposalId);
    if (!record) {
      throw new ReadModelError('NOT_FOUND', 'proposta não encontrada');
    }
    const riskDecision = record.decisionId ? await this.deps.riskPolicy.getDecision(record.decisionId).catch(() => null) : null;
    const intents = record.decisionId ? await this.deps.orderIntent.listByDecisionId(record.decisionId) : [];
    return { proposal: stripHash(record), riskDecision, intents };
  }
}
