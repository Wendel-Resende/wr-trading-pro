-- AlterTable
ALTER TABLE "BacktestRun" ADD COLUMN "costProfileId" TEXT;
ALTER TABLE "BacktestRun" ADD COLUMN "costProfileVersion" INTEGER;
ALTER TABLE "BacktestRun" ADD COLUMN "exitRuleKey" TEXT;
ALTER TABLE "BacktestRun" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "BacktestRun" ADD COLUMN "metricsSchemaVersion" INTEGER;
ALTER TABLE "BacktestRun" ADD COLUMN "predictionHorizonBars" INTEGER;

-- CreateTable
CREATE TABLE "BacktestCostProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "fixedBrokerage" REAL NOT NULL,
    "emolumentsPct" REAL NOT NULL,
    "spreadBps" REAL NOT NULL,
    "slippageBps" REAL NOT NULL,
    "lotSize" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME,
    "archivedBy" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "BacktestCostProfile_label_version_key" ON "BacktestCostProfile"("label", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BacktestRun_idempotencyKey_key" ON "BacktestRun"("idempotencyKey");
