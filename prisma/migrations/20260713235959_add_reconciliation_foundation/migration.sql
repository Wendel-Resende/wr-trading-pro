-- CreateTable
CREATE TABLE "ReconciliationPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "domain" TEXT,
    "subjectId" TEXT,
    "decisionTime" DATETIME NOT NULL,
    "knowledgeTime" DATETIME NOT NULL,
    "createdByRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ReconciliationReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "domain" TEXT,
    "fromTime" DATETIME NOT NULL,
    "toTime" DATETIME NOT NULL,
    "overall" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL,
    "decisionTime" DATETIME NOT NULL,
    "knowledgeTime" DATETIME NOT NULL,
    "createdByRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ReconciliationRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "legacySource" TEXT NOT NULL,
    "newSource" TEXT NOT NULL,
    "legacyCount" BIGINT NOT NULL,
    "newCount" BIGINT NOT NULL,
    "sampleLegacyIds" TEXT NOT NULL,
    "sampleNewIds" TEXT NOT NULL,
    "matchedSamples" INTEGER NOT NULL,
    "mismatchSamples" INTEGER NOT NULL,
    "decidedAt" DATETIME NOT NULL,
    "decisionTime" DATETIME NOT NULL,
    "knowledgeTime" DATETIME NOT NULL,
    "createdByRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReconciliationRow_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ReconciliationPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationPlan_planId_key" ON "ReconciliationPlan"("planId");

-- CreateIndex
CREATE INDEX "ReconciliationPlan_decisionTime_knowledgeTime_idx" ON "ReconciliationPlan"("decisionTime", "knowledgeTime");

-- CreateIndex
CREATE INDEX "ReconciliationPlan_createdByRunId_idx" ON "ReconciliationPlan"("createdByRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationReport_reportId_key" ON "ReconciliationReport"("reportId");

-- CreateIndex
CREATE INDEX "ReconciliationReport_decisionTime_knowledgeTime_idx" ON "ReconciliationReport"("decisionTime", "knowledgeTime");

-- CreateIndex
CREATE INDEX "ReconciliationReport_createdByRunId_idx" ON "ReconciliationReport"("createdByRunId");

-- CreateIndex
CREATE INDEX "ReconciliationRow_domain_decisionTime_knowledgeTime_idx" ON "ReconciliationRow"("domain", "decisionTime", "knowledgeTime");

-- CreateIndex
CREATE INDEX "ReconciliationRow_createdByRunId_idx" ON "ReconciliationRow"("createdByRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationRow_planId_domain_key" ON "ReconciliationRow"("planId", "domain");
