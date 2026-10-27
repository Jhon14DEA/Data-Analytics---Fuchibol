-- CreateTable
CREATE TABLE "LiveMarketSnapshot" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "providerFixtureId" TEXT NOT NULL,
    "liveSnapshotId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "minute" INTEGER NOT NULL,
    "stoppageTime" INTEGER,
    "elapsedStoppageTime" INTEGER,
    "marketType" TEXT NOT NULL DEFAULT 'OVER_0_5',
    "marketPeriod" TEXT NOT NULL DEFAULT 'FIRST_HALF',
    "homeScore" INTEGER NOT NULL,
    "awayScore" INTEGER NOT NULL,
    "goalsNeeded" INTEGER NOT NULL,
    "minutesRemainingMarket" DOUBLE PRECISION,
    "homeShots" INTEGER,
    "awayShots" INTEGER,
    "totalShots" INTEGER,
    "homeSot" INTEGER,
    "awaySot" INTEGER,
    "totalSot" INTEGER,
    "homeXg" DOUBLE PRECISION,
    "awayXg" DOUBLE PRECISION,
    "totalXg" DOUBLE PRECISION,
    "homeBigChances" INTEGER,
    "awayBigChances" INTEGER,
    "totalBigChances" INTEGER,
    "homeShotsInsideBox" INTEGER,
    "awayShotsInsideBox" INTEGER,
    "totalShotsInsideBox" INTEGER,
    "homeCorners" INTEGER,
    "awayCorners" INTEGER,
    "totalCorners" INTEGER,
    "homeDangerousAttacks" INTEGER,
    "awayDangerousAttacks" INTEGER,
    "totalDangerousAttacks" INTEGER,
    "sotLast5" INTEGER,
    "sotLast10" INTEGER,
    "sotLast15" INTEGER,
    "xgLast5" DOUBLE PRECISION,
    "xgLast10" DOUBLE PRECISION,
    "xgLast15" DOUBLE PRECISION,
    "bigChancesLast5" INTEGER,
    "bigChancesLast10" INTEGER,
    "bigChancesLast15" INTEGER,
    "cornersLast5" INTEGER,
    "cornersLast10" INTEGER,
    "cornersLast15" INTEGER,
    "homeRedCards" INTEGER,
    "awayRedCards" INTEGER,
    "homeOver05FirstHalfRate" DOUBLE PRECISION,
    "awayOver05FirstHalfRate" DOUBLE PRECISION,
    "homeAvgGoalsFirstHalf" DOUBLE PRECISION,
    "awayAvgGoalsFirstHalf" DOUBLE PRECISION,
    "homeZeroZeroHtRate" DOUBLE PRECISION,
    "awayZeroZeroHtRate" DOUBLE PRECISION,
    "marketOdds" DOUBLE PRECISION,
    "oddsBookmaker" TEXT,
    "oddsQuotedAt" TIMESTAMP(3),
    "dataQuality" DOUBLE PRECISION NOT NULL,
    "coveragePercent" DOUBLE PRECISION NOT NULL,
    "dataQualityDetails" JSONB NOT NULL,
    "goalBeforeHt" BOOLEAN,
    "goalBeforeFt" BOOLEAN,
    "finalHomeScore" INTEGER,
    "finalAwayScore" INTEGER,
    "htResolvedAt" TIMESTAMP(3),
    "resultResolvedAt" TIMESTAMP(3),

    CONSTRAINT "LiveMarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveMarketSnapshot_matchId_capturedAt_idx" ON "LiveMarketSnapshot"("matchId", "capturedAt");

-- CreateIndex
CREATE INDEX "LiveMarketSnapshot_liveSnapshotId_idx" ON "LiveMarketSnapshot"("liveSnapshotId");

-- CreateIndex
CREATE INDEX "LiveMarketSnapshot_providerFixtureId_idx" ON "LiveMarketSnapshot"("providerFixtureId");

-- CreateIndex
CREATE INDEX "LiveMarketSnapshot_marketType_marketPeriod_goalBeforeHt_min_idx" ON "LiveMarketSnapshot"("marketType", "marketPeriod", "goalBeforeHt", "minute");

-- CreateIndex
CREATE INDEX "LiveMarketSnapshot_marketType_marketPeriod_dataQuality_capt_idx" ON "LiveMarketSnapshot"("marketType", "marketPeriod", "dataQuality", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveMarketSnapshot_matchId_marketType_marketPeriod_sourceHa_key" ON "LiveMarketSnapshot"("matchId", "marketType", "marketPeriod", "sourceHash");

-- AddForeignKey
ALTER TABLE "LiveMarketSnapshot" ADD CONSTRAINT "LiveMarketSnapshot_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveMarketSnapshot" ADD CONSTRAINT "LiveMarketSnapshot_liveSnapshotId_fkey" FOREIGN KEY ("liveSnapshotId") REFERENCES "LiveSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- This first dataset contains ONLY active 0-0 first-half over-0.5 candidates.
ALTER TABLE "LiveMarketSnapshot" ADD CONSTRAINT "LiveMarketSnapshot_candidate_check"
CHECK ("marketType" = 'OVER_0_5' AND "marketPeriod" = 'FIRST_HALF'
  AND "homeScore" = 0 AND "awayScore" = 0 AND "goalsNeeded" = 1
  AND "minute" BETWEEN 0 AND 45);
ALTER TABLE "LiveMarketSnapshot" ADD CONSTRAINT "LiveMarketSnapshot_quality_check"
CHECK ("dataQuality" BETWEEN 0 AND 100 AND "coveragePercent" BETWEEN 0 AND 100);
ALTER TABLE "LiveMarketSnapshot" ADD CONSTRAINT "LiveMarketSnapshot_resolution_check"
CHECK ("resultResolvedAt" IS NULL OR ("goalBeforeHt" IS NOT NULL AND "goalBeforeFt" IS NOT NULL
  AND "finalHomeScore" IS NOT NULL AND "finalAwayScore" IS NOT NULL));
