-- AlterTable (aditivo: apenas ADD COLUMN, sem DROP; nenhuma coluna/tabela do Item 1 é removida)
ALTER TABLE "AgentRun" ADD COLUMN "nodeStatesJson" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN "stepsUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentRun" ADD COLUMN "costUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "AgentRun_status_updatedAt_idx" ON "AgentRun"("status", "updatedAt");
