-- CreateTable
CREATE TABLE "LlmProviderConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "LlmProviderConfig_provider_key" ON "LlmProviderConfig"("provider");
