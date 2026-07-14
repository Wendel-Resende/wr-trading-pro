/**
 * Thin read-only facade consumed by the MCP tools (Fase 4). Wires the
 * existing Fase 2/3 application services via their `compose.ts` helpers
 * and exposes ONLY the read methods (`get*`/`list*`/`findValues`-style
 * queries) — never `submit`, `advance`, `cancel`, `evaluate`, or `create`.
 * The MCP server never imports a Prisma repository directly and never
 * constructs a `PrismaClient` itself.
 */
import type { PrismaClient } from '@prisma/client';
import { createAgentRunService } from '../../application/agent-run/compose';
import type { ListAgentRunsQueryV1 } from '../../application/agent-run/service';
import { createRiskPolicyService } from '../../application/risk-policy/compose';
import { createOrderIntentService } from '../../application/order-intent/compose';
import { createReconciliationService } from '../../application/reconciliation/compose';
import { createFeatureValueService } from '../../application/feature-value/compose';
import { createReadModelV1Service } from '../../application/read-models-v1/compose';
import type { AgentRun } from '../../domain/v1/models/agent-run';
import type { RiskDecision } from '../../domain/v1/models/risk-policy';
import type { OrderIntent } from '../../domain/v1/models/order-intent';
import type { ReconciliationReport } from '../../domain/v1/models/reconciliation';
import type {
  FactsQueryV1,
  InstrumentQueryV1,
  MarketBarsQueryV1,
} from '../../application/read-models-v1/service';
import type {
  CvmFactReadModelV1,
  EffectiveCvmFilingReadModelV1,
  InstrumentVersionReadModelV1,
  MarketBarReadModelV1,
} from '../../application/read-models-v1/dto';
import type { FeatureValueReadModelV1 } from '../../application/feature-value/dto';
import type { FeatureValueQueryV1 } from '../../application/feature-value/service';
import type { ReconciliationReportQueryV1 } from '../../application/reconciliation/service';

export interface McpReadServices {
  readonly agentRun: {
    get(runId: string): Promise<AgentRun>;
    list(query: ListAgentRunsQueryV1): Promise<readonly AgentRun[]>;
  };
  readonly riskDecision: {
    getDecision(decisionId: string): Promise<RiskDecision>;
    listByRunId(runId: string): Promise<readonly RiskDecision[]>;
  };
  readonly orderIntent: {
    getIntent(intentId: string): Promise<OrderIntent>;
    listByDecisionId(decisionId: string): Promise<readonly OrderIntent[]>;
  };
  readonly reconciliation: {
    getReport(query: ReconciliationReportQueryV1): Promise<ReconciliationReport>;
  };
  readonly featureValue: {
    getValues(query: FeatureValueQueryV1): Promise<readonly FeatureValueReadModelV1[]>;
  };
  readonly readModel: {
    getInstrument(query: InstrumentQueryV1): Promise<InstrumentVersionReadModelV1>;
    getFacts(query: FactsQueryV1): Promise<{ facts: readonly CvmFactReadModelV1[]; effectiveFiling: EffectiveCvmFilingReadModelV1 }>;
    getMarketBars(query: MarketBarsQueryV1): Promise<readonly MarketBarReadModelV1[]>;
  };
}

/** `prisma` must already be constructed by the caller (test harness or app singleton); this facade never constructs one itself. */
export function createMcpReadServices(prisma: PrismaClient): McpReadServices {
  const agentRunService = createAgentRunService(prisma);
  const riskPolicyService = createRiskPolicyService(prisma);
  const orderIntentService = createOrderIntentService(prisma);
  const reconciliationService = createReconciliationService(prisma);
  const featureValueService = createFeatureValueService(prisma);
  const readModelService = createReadModelV1Service(prisma);

  return Object.freeze({
    agentRun: Object.freeze({
      get: (runId: string) => agentRunService.get(runId),
      list: (query: ListAgentRunsQueryV1) => agentRunService.list(query),
    }),
    riskDecision: Object.freeze({
      getDecision: (decisionId: string) => riskPolicyService.getDecision(decisionId),
      listByRunId: (runId: string) => riskPolicyService.listByRunId(runId),
    }),
    orderIntent: Object.freeze({
      getIntent: (intentId: string) => orderIntentService.getIntent(intentId),
      listByDecisionId: (decisionId: string) => orderIntentService.listByDecisionId(decisionId),
    }),
    reconciliation: Object.freeze({
      getReport: (query: ReconciliationReportQueryV1) => reconciliationService.getReport(query),
    }),
    featureValue: Object.freeze({
      getValues: (query: FeatureValueQueryV1) => featureValueService.getValues(query),
    }),
    readModel: Object.freeze({
      getInstrument: (query: InstrumentQueryV1) => readModelService.getInstrument(query),
      getFacts: (query: FactsQueryV1) => readModelService.getFacts(query),
      getMarketBars: (query: MarketBarsQueryV1) => readModelService.getMarketBars(query),
    }),
  });
}
