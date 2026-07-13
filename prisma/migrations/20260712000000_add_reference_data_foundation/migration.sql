-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "summary" TEXT
);

-- CreateTable
CREATE TABLE "Issuer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cvmCode" TEXT NOT NULL,
    "cnpj" TEXT,
    "name" TEXT NOT NULL,
    "createdByRunId" TEXT NOT NULL,
    CONSTRAINT "Issuer_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "IngestionRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstrumentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priceScalePow" INTEGER,
    "quantityScalePow" INTEGER,
    "lotSize" INTEGER,
    "validFrom" DATETIME NOT NULL,
    "validTo" DATETIME,
    "validFromBasis" TEXT NOT NULL,
    "issuerId" TEXT,
    "createdByRunId" TEXT NOT NULL,
    "closedByRunId" TEXT,
    CONSTRAINT "InstrumentVersion_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Issuer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InstrumentVersion_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "IngestionRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstrumentVersion_closedByRunId_fkey" FOREIGN KEY ("closedByRunId") REFERENCES "IngestionRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "IngestionRun_sourceKey_startedAt_idx" ON "IngestionRun"("sourceKey", "startedAt");

-- CreateIndex
CREATE INDEX "IngestionRun_status_idx" ON "IngestionRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Issuer_cvmCode_key" ON "Issuer"("cvmCode");

-- CreateIndex
CREATE UNIQUE INDEX "Issuer_cnpj_key" ON "Issuer"("cnpj");

-- CreateIndex
CREATE INDEX "Issuer_createdByRunId_idx" ON "Issuer"("createdByRunId");

-- CreateIndex
CREATE INDEX "InstrumentVersion_symbol_exchange_validTo_idx" ON "InstrumentVersion"("symbol", "exchange", "validTo");

-- CreateIndex
CREATE INDEX "InstrumentVersion_issuerId_idx" ON "InstrumentVersion"("issuerId");

-- CreateIndex
CREATE INDEX "InstrumentVersion_createdByRunId_idx" ON "InstrumentVersion"("createdByRunId");

-- CreateIndex
CREATE INDEX "InstrumentVersion_closedByRunId_idx" ON "InstrumentVersion"("closedByRunId");

-- CreateIndex
CREATE UNIQUE INDEX "InstrumentVersion_symbol_exchange_validFrom_key" ON "InstrumentVersion"("symbol", "exchange", "validFrom");
