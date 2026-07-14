-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "avgPrice" REAL NOT NULL,
    "currentPrice" REAL NOT NULL,
    "pnl" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    CONSTRAINT "Position_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" REAL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filledAt" DATETIME,
    CONSTRAINT "Order_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "prediction" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "targetPrice" REAL,
    "timeframe" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Prediction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketData" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "volume" BIGINT NOT NULL,
    CONSTRAINT "MarketData_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TechnicalIndicator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "indicator" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "signal" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AIProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "apiKey" TEXT,
    "endpoint" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SystemMetrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "metricName" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SpreadOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId1" TEXT NOT NULL,
    "assetId2" TEXT NOT NULL,
    "type1" TEXT NOT NULL,
    "type2" TEXT NOT NULL,
    "quantity1" INTEGER NOT NULL,
    "quantity2" INTEGER NOT NULL,
    "price1" REAL NOT NULL,
    "price2" REAL NOT NULL,
    "spreadValue" REAL NOT NULL,
    "status" TEXT NOT NULL,
    "isAutomated" BOOLEAN NOT NULL DEFAULT false,
    "automationTarget" REAL,
    "automationCondition" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filledAt" DATETIME,
    "mt5OrderTicket1" INTEGER,
    "mt5OrderTicket2" INTEGER
);

-- CreateTable
CREATE TABLE "StockMonitoring" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "stockType" TEXT NOT NULL,
    "composition" REAL NOT NULL DEFAULT 1,
    "payoutEstatuto" REAL,
    "dyMedia3Anos" REAL,
    "gatilhoROE" REAL,
    "gatilhoVPA" REAL,
    "gatilhoLPA" REAL,
    "precoTeto" REAL,
    "precoTetoReajustado" REAL,
    "metaPapeis" INTEGER NOT NULL DEFAULT 0,
    "investimentoNecessarioParaMeta" REAL,
    "patrimonioLiquido" REAL,
    "lucroLiquido" REAL,
    "acoesEmitidas" BIGINT,
    "vpa" REAL,
    "pVpa" REAL,
    "lpa" REAL,
    "precoLucro" REAL,
    "roe" REAL,
    "previsaoDividendoAnual" REAL,
    "yieldOnCost" REAL,
    "precoAtual" REAL,
    "quantidadeAdquirida" INTEGER NOT NULL DEFAULT 0,
    "precoMedioCompra" REAL,
    "valorInvestido" REAL,
    "valorCarteira" REAL,
    "resultado" REAL NOT NULL DEFAULT 0,
    "participacaoCarteira" REAL,
    "status" TEXT NOT NULL DEFAULT 'NEUTRO',
    "observacoes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockMonitoring_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DividendMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "jan" REAL NOT NULL DEFAULT 0,
    "fev" REAL NOT NULL DEFAULT 0,
    "mar" REAL NOT NULL DEFAULT 0,
    "abr" REAL NOT NULL DEFAULT 0,
    "mai" REAL NOT NULL DEFAULT 0,
    "jun" REAL NOT NULL DEFAULT 0,
    "jul" REAL NOT NULL DEFAULT 0,
    "ago" REAL NOT NULL DEFAULT 0,
    "set" REAL NOT NULL DEFAULT 0,
    "out" REAL NOT NULL DEFAULT 0,
    "nov" REAL NOT NULL DEFAULT 0,
    "dez" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL DEFAULT 0,
    "ano" INTEGER NOT NULL,
    CONSTRAINT "DividendMap_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "StockMonitoring" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "value" REAL,
    "targetValue" REAL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "triggeredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockAlert_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "StockMonitoring" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "data" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_symbol_key" ON "Asset"("symbol");

-- CreateIndex
CREATE INDEX "Position_assetId_idx" ON "Position"("assetId");

-- CreateIndex
CREATE INDEX "Order_assetId_idx" ON "Order"("assetId");

-- CreateIndex
CREATE INDEX "Prediction_assetId_idx" ON "Prediction"("assetId");

-- CreateIndex
CREATE INDEX "MarketData_assetId_idx" ON "MarketData"("assetId");

-- CreateIndex
CREATE INDEX "MarketData_timestamp_idx" ON "MarketData"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "MarketData_assetId_timestamp_key" ON "MarketData"("assetId", "timestamp");

-- CreateIndex
CREATE INDEX "TechnicalIndicator_assetId_idx" ON "TechnicalIndicator"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "AIProvider_name_key" ON "AIProvider"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_name_key" ON "DataSource"("name");

-- CreateIndex
CREATE INDEX "SystemMetrics_metricName_idx" ON "SystemMetrics"("metricName");

-- CreateIndex
CREATE INDEX "SystemMetrics_timestamp_idx" ON "SystemMetrics"("timestamp");

-- CreateIndex
CREATE INDEX "SpreadOrder_assetId1_idx" ON "SpreadOrder"("assetId1");

-- CreateIndex
CREATE INDEX "SpreadOrder_assetId2_idx" ON "SpreadOrder"("assetId2");

-- CreateIndex
CREATE INDEX "SpreadOrder_status_idx" ON "SpreadOrder"("status");

-- CreateIndex
CREATE INDEX "SpreadOrder_createdAt_idx" ON "SpreadOrder"("createdAt");

-- CreateIndex
CREATE INDEX "StockMonitoring_assetId_idx" ON "StockMonitoring"("assetId");

-- CreateIndex
CREATE INDEX "StockMonitoring_status_idx" ON "StockMonitoring"("status");

-- CreateIndex
CREATE INDEX "DividendMap_stockId_idx" ON "DividendMap"("stockId");

-- CreateIndex
CREATE UNIQUE INDEX "DividendMap_stockId_ano_key" ON "DividendMap"("stockId", "ano");

-- CreateIndex
CREATE INDEX "StockAlert_stockId_idx" ON "StockAlert"("stockId");

-- CreateIndex
CREATE INDEX "StockAlert_isActive_idx" ON "StockAlert"("isActive");

-- CreateIndex
CREATE INDEX "StockAlert_isRead_idx" ON "StockAlert"("isRead");

-- CreateIndex
CREATE INDEX "StockAlert_type_idx" ON "StockAlert"("type");

-- CreateIndex
CREATE INDEX "StockReport_type_idx" ON "StockReport"("type");

-- CreateIndex
CREATE INDEX "StockReport_startDate_idx" ON "StockReport"("startDate");

-- CreateIndex
CREATE INDEX "StockReport_endDate_idx" ON "StockReport"("endDate");
