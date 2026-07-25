-- CreateTable
CREATE TABLE "DirectionalModelVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modelVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "researchRunId" TEXT NOT NULL,
    "metrics" TEXT NOT NULL,
    "artifactPath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "gateFailures" TEXT,
    CONSTRAINT "DirectionalModelVersion_researchRunId_fkey" FOREIGN KEY ("researchRunId") REFERENCES "ResearchRun" ("runId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DirectionalPrediction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modelVersion" TEXT NOT NULL,
    "cdCvm" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "prob" REAL NOT NULL,
    "knowledgeDate" DATETIME NOT NULL,
    "topFeatures" TEXT NOT NULL,
    "universeDigest" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "DirectionalModelVersion_modelVersion_key" ON "DirectionalModelVersion"("modelVersion");

-- CreateIndex
CREATE INDEX "DirectionalModelVersion_status_createdAt_idx" ON "DirectionalModelVersion"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DirectionalModelVersion_researchRunId_idx" ON "DirectionalModelVersion"("researchRunId");

-- CreateIndex
CREATE INDEX "DirectionalPrediction_modelVersion_generatedAt_idx" ON "DirectionalPrediction"("modelVersion", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DirectionalPrediction_modelVersion_cdCvm_generatedAt_key" ON "DirectionalPrediction"("modelVersion", "cdCvm", "generatedAt");
