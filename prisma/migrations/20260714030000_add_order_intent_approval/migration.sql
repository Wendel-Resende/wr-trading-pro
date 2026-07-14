-- CreateTable
CREATE TABLE "HumanApprovalReceipt" (
    "approvalId" TEXT NOT NULL PRIMARY KEY,
    "decisionId" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" DATETIME NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "decisionOutcome" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "HumanApprovalReceipt_decisionId_idx" ON "HumanApprovalReceipt"("decisionId");

-- CreateIndex
CREATE INDEX "HumanApprovalReceipt_approvedBy_createdAt_idx" ON "HumanApprovalReceipt"("approvedBy", "createdAt");

-- CreateTable
CREATE TABLE "OrderIntent" (
    "intentId" TEXT NOT NULL PRIMARY KEY,
    "decisionId" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "decisionTime" DATETIME NOT NULL,
    "knowledgeTime" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderIntent_idempotencyKey_key" ON "OrderIntent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderIntent_decisionId_idx" ON "OrderIntent"("decisionId");

-- CreateIndex
CREATE INDEX "OrderIntent_approvalId_idx" ON "OrderIntent"("approvalId");

-- CreateIndex
CREATE INDEX "OrderIntent_requestedBy_createdAt_idx" ON "OrderIntent"("requestedBy", "createdAt");

-- CreateIndex
CREATE INDEX "OrderIntent_status_createdAt_idx" ON "OrderIntent"("status", "createdAt");
