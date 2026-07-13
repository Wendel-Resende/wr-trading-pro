-- CreateTable
CREATE TABLE "CvmFiling" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issuerId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "cvmProtocol" TEXT NOT NULL,
    "referenceDate" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "fiscalQuarter" INTEGER,
    "filedAt" DATETIME NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "isRestatement" BOOLEAN NOT NULL,
    "supersedesFilingId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "rawSha256" TEXT NOT NULL,
    "createdByRunId" TEXT NOT NULL,
    CONSTRAINT "CvmFiling_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Issuer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CvmFiling_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "IngestionRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CvmFiling_supersedesFilingId_fkey" FOREIGN KEY ("supersedesFilingId") REFERENCES "CvmFiling" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CvmFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filingId" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "statementType" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountLabel" TEXT NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "durationType" TEXT NOT NULL,
    "valueRaw" BIGINT NOT NULL,
    "scalePow" INTEGER NOT NULL,
    "originalScale" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "createdByRunId" TEXT NOT NULL,
    CONSTRAINT "CvmFact_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "CvmFiling" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CvmFact_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Issuer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CvmFact_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "IngestionRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShareCapitalFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filingId" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "shareClass" TEXT NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "quantityType" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "createdByRunId" TEXT NOT NULL,
    CONSTRAINT "ShareCapitalFact_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "CvmFiling" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ShareCapitalFact_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Issuer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ShareCapitalFact_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "IngestionRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CvmFiling_cvmProtocol_key" ON "CvmFiling"("cvmProtocol");

-- CreateIndex
CREATE UNIQUE INDEX "CvmFiling_supersedesFilingId_key" ON "CvmFiling"("supersedesFilingId");

-- CreateIndex
CREATE UNIQUE INDEX "CvmFiling_issuerId_documentType_referenceDate_versionNumber_key" ON "CvmFiling"("issuerId", "documentType", "referenceDate", "versionNumber");

-- CreateIndex
CREATE INDEX "CvmFiling_createdByRunId_idx" ON "CvmFiling"("createdByRunId");

-- CreateIndex
CREATE INDEX "CvmFiling_publishedAt_idx" ON "CvmFiling"("publishedAt");

-- CreateIndex
CREATE INDEX "CvmFact_issuerId_statementType_scope_accountCode_periodEnd_idx" ON "CvmFact"("issuerId", "statementType", "scope", "accountCode", "periodEnd");

-- CreateIndex
CREATE INDEX "CvmFact_filingId_idx" ON "CvmFact"("filingId");

-- CreateIndex
CREATE INDEX "CvmFact_createdByRunId_idx" ON "CvmFact"("createdByRunId");

-- CreateIndex
CREATE UNIQUE INDEX "CvmFact_filingId_statementType_scope_accountCode_periodStart_periodEnd_key" ON "CvmFact"("filingId", "statementType", "scope", "accountCode", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "ShareCapitalFact_issuerId_shareClass_quantityType_periodEnd_idx" ON "ShareCapitalFact"("issuerId", "shareClass", "quantityType", "periodEnd");

-- CreateIndex
CREATE INDEX "ShareCapitalFact_filingId_idx" ON "ShareCapitalFact"("filingId");

-- CreateIndex
CREATE INDEX "ShareCapitalFact_createdByRunId_idx" ON "ShareCapitalFact"("createdByRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareCapitalFact_filingId_shareClass_periodEnd_quantityType_key" ON "ShareCapitalFact"("filingId", "shareClass", "periodEnd", "quantityType");
