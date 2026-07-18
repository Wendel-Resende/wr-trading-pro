-- CreateTable
CREATE TABLE "McpTradeProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "volume" REAL NOT NULL,
    "stopLoss" REAL,
    "takeProfit" REAL,
    "rationale" TEXT NOT NULL,
    "decisionId" TEXT,
    "status" TEXT NOT NULL,
    "executionState" TEXT,
    "confirmationCodeHash" TEXT NOT NULL,
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "executionJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "McpTradeProposal_proposalId_key" ON "McpTradeProposal"("proposalId");

-- CreateIndex
CREATE INDEX "McpTradeProposal_status_createdAt_idx" ON "McpTradeProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "McpTradeProposal_requestedBy_createdAt_idx" ON "McpTradeProposal"("requestedBy", "createdAt");
