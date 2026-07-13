-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dag" TEXT NOT NULL,
    "inputJson" TEXT NOT NULL,
    "budgetJson" TEXT NOT NULL,
    "outputJson" TEXT,
    "errorJson" TEXT,
    "decisionTime" DATETIME NOT NULL,
    "knowledgeTime" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_runId_key" ON "AgentRun"("runId");

-- CreateIndex
CREATE INDEX "AgentRun_status_createdAt_idx" ON "AgentRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_requestedBy_createdAt_idx" ON "AgentRun"("requestedBy", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_decisionTime_knowledgeTime_idx" ON "AgentRun"("decisionTime", "knowledgeTime");
