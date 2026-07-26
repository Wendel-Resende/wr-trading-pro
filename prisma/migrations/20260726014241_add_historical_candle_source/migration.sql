-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_HistoricalCandle" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "time" DATETIME NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "volume" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MT5',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_HistoricalCandle" ("close", "createdAt", "high", "id", "low", "open", "symbol", "time", "timeframe", "volume") SELECT "close", "createdAt", "high", "id", "low", "open", "symbol", "time", "timeframe", "volume" FROM "HistoricalCandle";
DROP TABLE "HistoricalCandle";
ALTER TABLE "new_HistoricalCandle" RENAME TO "HistoricalCandle";
CREATE INDEX "HistoricalCandle_symbol_timeframe_time_idx" ON "HistoricalCandle"("symbol", "timeframe", "time");
CREATE INDEX "HistoricalCandle_source_symbol_idx" ON "HistoricalCandle"("source", "symbol");
CREATE UNIQUE INDEX "HistoricalCandle_symbol_timeframe_time_key" ON "HistoricalCandle"("symbol", "timeframe", "time");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
