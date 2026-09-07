-- CreateTable
CREATE TABLE "ResearchSession" (
    "sessionId" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "notes" TEXT,
    "configJson" TEXT NOT NULL,
    "resultJson" TEXT,
    "errorSummary" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ResearchSession_kind_status_createdAt_idx" ON "ResearchSession"("kind", "status", "createdAt");
