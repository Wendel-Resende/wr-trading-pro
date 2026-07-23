-- AlterTable
ALTER TABLE "ModelVersion" ADD COLUMN "publishedAt" DATETIME;

-- CreateIndex
CREATE INDEX "ModelVersion_kind_publishedAt_idx" ON "ModelVersion"("kind", "publishedAt");
