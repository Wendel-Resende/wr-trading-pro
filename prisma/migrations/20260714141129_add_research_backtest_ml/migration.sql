-- CreateTable
CREATE TABLE "ResearchRun" (
    "runId" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "windowEnd" DATETIME NOT NULL,
    "paramsJson" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modelVersionId" TEXT
);

-- CreateTable
CREATE TABLE "ModelVersion" (
    "modelVersion" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "asOf" DATETIME NOT NULL,
    "hyperparametersJson" TEXT NOT NULL,
    "trainingEvidenceJson" TEXT,
    "invalidatedAt" DATETIME,
    "invalidationReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Signal" (
    "signalId" TEXT NOT NULL PRIMARY KEY,
    "modelVersionId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "barTime" DATETIME NOT NULL,
    "direction" TEXT NOT NULL,
    "score" REAL,
    "knowledgeTime" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BacktestRun" (
    "backtestId" TEXT NOT NULL PRIMARY KEY,
    "researchRunId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "entryRule" TEXT NOT NULL,
    "costsJson" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "windowEnd" DATETIME NOT NULL,
    "metricsJson" TEXT NOT NULL,
    "embargoDays" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ResearchRun_datasetId_createdAt_idx" ON "ResearchRun"("datasetId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchRun_createdBy_createdAt_idx" ON "ResearchRun"("createdBy", "createdAt");

-- CreateIndex
CREATE INDEX "ModelVersion_kind_asOf_idx" ON "ModelVersion"("kind", "asOf");

-- CreateIndex
CREATE INDEX "Signal_modelVersionId_barTime_idx" ON "Signal"("modelVersionId", "barTime");

-- CreateIndex
CREATE INDEX "Signal_instrumentId_barTime_idx" ON "Signal"("instrumentId", "barTime");

-- CreateIndex
CREATE INDEX "BacktestRun_researchRunId_idx" ON "BacktestRun"("researchRunId");

-- CreateIndex
CREATE INDEX "BacktestRun_modelVersionId_instrumentId_idx" ON "BacktestRun"("modelVersionId", "instrumentId");
