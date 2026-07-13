-- CreateTable
CREATE TABLE "VersionedMarketBar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instrumentVersionId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceRecordKey" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "openedAt" DATETIME NOT NULL,
    "closedAt" DATETIME NOT NULL,
    "sourceAvailableAt" DATETIME NOT NULL,
    "openRaw" BIGINT NOT NULL,
    "highRaw" BIGINT NOT NULL,
    "lowRaw" BIGINT NOT NULL,
    "closeRaw" BIGINT NOT NULL,
    "priceScalePow" INTEGER NOT NULL,
    "volumeRaw" BIGINT NOT NULL,
    "volumeScalePow" INTEGER NOT NULL,
    "volumeSemantics" TEXT NOT NULL,
    "tradeCount" BIGINT,
    "priceBasis" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "rawSha256" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "supersedesBarId" TEXT,
    "createdByRunId" TEXT NOT NULL,
    CONSTRAINT "VersionedMarketBar_instrumentVersionId_fkey" FOREIGN KEY ("instrumentVersionId") REFERENCES "InstrumentVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VersionedMarketBar_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "IngestionRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VersionedMarketBar_supersedesBarId_fkey" FOREIGN KEY ("supersedesBarId") REFERENCES "VersionedMarketBar" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "VersionedMarketBar_supersedesBarId_key" ON "VersionedMarketBar"("supersedesBarId");

-- CreateIndex
CREATE INDEX "VersionedMarketBar_instrumentVersionId_timeframe_sourceKey_openedAt_idx" ON "VersionedMarketBar"("instrumentVersionId", "timeframe", "sourceKey", "openedAt");

-- CreateIndex
CREATE INDEX "VersionedMarketBar_createdByRunId_idx" ON "VersionedMarketBar"("createdByRunId");

-- CreateIndex
CREATE UNIQUE INDEX "VersionedMarketBar_instrumentVersionId_timeframe_sourceKey_openedAt_revisionNumber_key" ON "VersionedMarketBar"("instrumentVersionId", "timeframe", "sourceKey", "openedAt", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "VersionedMarketBar_sourceKey_sourceRecordKey_key" ON "VersionedMarketBar"("sourceKey", "sourceRecordKey");

-- CreateIndex
CREATE INDEX "VersionedMarketBar_sourceAvailableAt_idx" ON "VersionedMarketBar"("sourceAvailableAt");
