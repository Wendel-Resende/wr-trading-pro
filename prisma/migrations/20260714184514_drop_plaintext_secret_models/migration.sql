/*
  Warnings:

  - You are about to drop the `AIProvider` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DataSource` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "AIProvider";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "DataSource";
PRAGMA foreign_keys=on;
