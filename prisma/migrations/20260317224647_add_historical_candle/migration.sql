-- CreateTable
CREATE TABLE "HistoricalCandle" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "time" DATETIME NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "volume" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "HistoricalCandle_symbol_timeframe_time_idx" ON "HistoricalCandle"("symbol", "timeframe", "time");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalCandle_symbol_timeframe_time_key" ON "HistoricalCandle"("symbol", "timeframe", "time");
