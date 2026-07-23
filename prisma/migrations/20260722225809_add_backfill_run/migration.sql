-- CreateTable
CREATE TABLE "BackfillRun" (
    "backfillRunId" TEXT NOT NULL PRIMARY KEY,
    "requestedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "eligibleCount" INTEGER NOT NULL,
    "updatedCount" INTEGER NOT NULL,
    "failedCount" INTEGER NOT NULL,
    "updatedSymbolsJson" TEXT NOT NULL,
    "failuresJson" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "BackfillRun_createdAt_idx" ON "BackfillRun"("createdAt");
