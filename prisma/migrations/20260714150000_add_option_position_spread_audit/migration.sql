-- CreateTable
CREATE TABLE "OptionPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instrumentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "strike" INTEGER NOT NULL,
    "expiration" DATETIME NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "knowledgeTime" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "OptionPosition_instrumentId_expiration_idx" ON "OptionPosition"("instrumentId", "expiration");

-- CreateTable
CREATE TABLE "SpreadOrderAudit" (
    "auditId" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "decisionTime" DATETIME NOT NULL,
    "knowledgeTime" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SpreadOrderAudit_orderId_idx" ON "SpreadOrderAudit"("orderId");

-- CreateIndex
CREATE INDEX "SpreadOrderAudit_action_createdAt_idx" ON "SpreadOrderAudit"("action", "createdAt");
