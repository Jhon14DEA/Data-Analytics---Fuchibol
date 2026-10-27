BEGIN;
SET LOCAL lock_timeout = '5s';
-- AlterTable
ALTER TABLE "Fixture" ADD COLUMN     "referee" TEXT;

-- CreateTable
CREATE TABLE "HistoricalOddsQuote" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "bookmakerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceColumn" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "line" DECIMAL(6,2),
    "price" DECIMAL(8,3) NOT NULL,
    "phase" TEXT NOT NULL,
    "quotedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoricalOddsQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HistoricalOddsQuote_fixtureId_market_idx" ON "HistoricalOddsQuote"("fixtureId", "market");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalOddsQuote_fixtureId_provider_sourceColumn_key" ON "HistoricalOddsQuote"("fixtureId", "provider", "sourceColumn");

-- AddForeignKey
ALTER TABLE "HistoricalOddsQuote" ADD CONSTRAINT "HistoricalOddsQuote_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalOddsQuote" ADD CONSTRAINT "HistoricalOddsQuote_bookmakerId_fkey" FOREIGN KEY ("bookmakerId") REFERENCES "Bookmaker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "HistoricalOddsQuote" ADD CONSTRAINT "HistoricalOddsQuote_price_positive" CHECK ("price" > 1);
COMMIT;
