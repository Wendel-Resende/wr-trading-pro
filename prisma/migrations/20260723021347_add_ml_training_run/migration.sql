-- CreateTable
CREATE TABLE "MlTrainingRun" (
    "trainingRunId" TEXT NOT NULL PRIMARY KEY,
    "requestedBy" TEXT NOT NULL,
    "costProfileId" TEXT NOT NULL,
    "costProfileVersion" INTEGER NOT NULL,
    "symbolsJson" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "pythonJobId" TEXT,
    "researchRunId" TEXT,
    "modelVersionId" TEXT,
    "gateJson" TEXT,
    "metricsJson" TEXT,
    "errorCode" TEXT,
    "errorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "cancelRequestedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "MlTrainingRun_status_createdAt_idx" ON "MlTrainingRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MlTrainingRun_requestedBy_createdAt_idx" ON "MlTrainingRun"("requestedBy", "createdAt");
