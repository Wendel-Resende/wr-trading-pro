-- CreateTable
CREATE TABLE "DatasetSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "asOf" DATETIME NOT NULL,
    "knowledgeTime" DATETIME NOT NULL,
    "decisionTime" DATETIME NOT NULL,
    "domains" TEXT NOT NULL,
    "createdByRunId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatasetSnapshot_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "IngestionRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeatureValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "featureId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "featureType" TEXT NOT NULL,
    "valueRaw" TEXT NOT NULL,
    "scalePow" INTEGER,
    "enumValue" TEXT,
    "label" TEXT,
    "sourceKey" TEXT NOT NULL,
    "knowledgeTime" DATETIME NOT NULL,
    "decisionTime" DATETIME NOT NULL,
    "createdByRunId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeatureValue_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "IngestionRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DatasetSnapshot_decisionTime_knowledgeTime_idx" ON "DatasetSnapshot"("decisionTime", "knowledgeTime");

-- CreateIndex
CREATE INDEX "DatasetSnapshot_createdByRunId_idx" ON "DatasetSnapshot"("createdByRunId");

-- CreateIndex
CREATE INDEX "FeatureValue_decisionTime_knowledgeTime_idx" ON "FeatureValue"("decisionTime", "knowledgeTime");

-- CreateIndex
CREATE INDEX "FeatureValue_subjectId_featureType_knowledgeTime_idx" ON "FeatureValue"("subjectId", "featureType", "knowledgeTime");

-- CreateIndex
CREATE INDEX "FeatureValue_createdByRunId_idx" ON "FeatureValue"("createdByRunId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureValue_featureId_decisionTime_knowledgeTime_key" ON "FeatureValue"("featureId", "decisionTime", "knowledgeTime");
