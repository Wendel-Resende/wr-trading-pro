-- CreateTable (aditivo: nova tabela apenas; nenhuma coluna/tabela de itens anteriores é alterada ou removida)
CREATE TABLE "RiskDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "decisionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reasonsJson" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "proposalJson" TEXT NOT NULL,
    "contextJson" TEXT NOT NULL,
    "policySnapshotJson" TEXT,
    "decisionTime" DATETIME NOT NULL,
    "knowledgeTime" DATETIME NOT NULL,
    "evaluatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "RiskDecision_decisionId_key" ON "RiskDecision"("decisionId");

-- CreateIndex
CREATE INDEX "RiskDecision_runId_evaluatedAt_idx" ON "RiskDecision"("runId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "RiskDecision_outcome_evaluatedAt_idx" ON "RiskDecision"("outcome", "evaluatedAt");

-- CreateIndex
CREATE INDEX "RiskDecision_instrumentId_evaluatedAt_idx" ON "RiskDecision"("instrumentId", "evaluatedAt");
