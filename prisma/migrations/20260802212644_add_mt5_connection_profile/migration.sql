-- CreateTable
CREATE TABLE "Mt5ConnectionProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "apiKeyCiphertext" TEXT NOT NULL,
    "apiKeyNonce" TEXT NOT NULL,
    "apiKeyTag" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
