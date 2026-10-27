BEGIN;
SET LOCAL lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "CompetitionClass" AS ENUM ('MEN_SENIOR', 'WOMEN', 'YOUTH', 'RESERVE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "HistoricalPeriod" AS ENUM ('FIRST_HALF', 'SECOND_HALF', 'FULL_TIME', 'MIN_0_15', 'MIN_16_30', 'MIN_31_45_PLUS', 'MIN_46_60', 'MIN_61_75', 'MIN_76_90_PLUS');

-- CreateEnum
CREATE TYPE "HistoricalOutcomeStatus" AS ENUM ('WIN', 'LOSS', 'PUSH', 'VOID', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "HistoricalIngestionStatus" AS ENUM ('READY', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProviderEntityKind" AS ENUM ('COMPETITION', 'TEAM', 'FIXTURE');

-- AlterTable
ALTER TABLE "Fixture" ADD COLUMN     "seasonId" TEXT;

-- AlterTable
ALTER TABLE "League" ADD COLUMN     "classification" "CompetitionClass" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "classificationEvidence" JSONB,
ADD COLUMN     "classificationSource" TEXT;

-- AlterTable
ALTER TABLE "OddsSnapshot" ADD COLUMN     "marketPeriod" "HistoricalPeriod",
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "sourceHash" TEXT;

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "providerSeasonId" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamPeriodStats" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "period" "HistoricalPeriod" NOT NULL,
    "goals" INTEGER,
    "shots" INTEGER,
    "shotsOnTarget" INTEGER,
    "xg" DECIMAL(10,4),
    "corners" INTEGER,
    "yellowCards" INTEGER,
    "redCards" INTEGER,
    "fouls" INTEGER,
    "possession" DOUBLE PRECISION,
    "dangerousAttacks" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "TeamPeriodStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalMarketOutcome" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "marketKey" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "period" "HistoricalPeriod" NOT NULL,
    "selection" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "line" DECIMAL(6,2),
    "rules" TEXT NOT NULL,
    "status" "HistoricalOutcomeStatus" NOT NULL,
    "observedValue" DOUBLE PRECISION,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "HistoricalMarketOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderEntityMapping" (
    "id" TEXT NOT NULL,
    "kind" "ProviderEntityKind" NOT NULL,
    "leftProvider" TEXT NOT NULL,
    "leftExternalId" TEXT NOT NULL,
    "rightProvider" TEXT NOT NULL,
    "rightExternalId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderEntityMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalIngestionState" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "rangeFrom" TIMESTAMP(3) NOT NULL,
    "rangeTo" TIMESTAMP(3) NOT NULL,
    "cursor" TEXT,
    "lastBatchKey" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "fixturesFound" INTEGER NOT NULL DEFAULT 0,
    "fixturesInserted" INTEGER NOT NULL DEFAULT 0,
    "fixturesUpdated" INTEGER NOT NULL DEFAULT 0,
    "fixturesRejected" INTEGER NOT NULL DEFAULT 0,
    "status" "HistoricalIngestionStatus" NOT NULL DEFAULT 'READY',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoricalIngestionState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Season_leagueId_key_key" ON "Season"("leagueId", "key");

-- CreateIndex
CREATE INDEX "TeamPeriodStats_teamId_period_fixtureId_idx" ON "TeamPeriodStats"("teamId", "period", "fixtureId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamPeriodStats_fixtureId_teamId_provider_period_key" ON "TeamPeriodStats"("fixtureId", "teamId", "provider", "period");

-- CreateIndex
CREATE INDEX "HistoricalMarketOutcome_market_period_status_idx" ON "HistoricalMarketOutcome"("market", "period", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalMarketOutcome_fixtureId_provider_marketKey_key" ON "HistoricalMarketOutcome"("fixtureId", "provider", "marketKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEntityMapping_kind_leftProvider_leftExternalId_righ_key" ON "ProviderEntityMapping"("kind", "leftProvider", "leftExternalId", "rightProvider");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEntityMapping_kind_rightProvider_rightExternalId_le_key" ON "ProviderEntityMapping"("kind", "rightProvider", "rightExternalId", "leftProvider");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalIngestionState_provider_leagueId_seasonId_key" ON "HistoricalIngestionState"("provider", "leagueId", "seasonId");

-- CreateIndex
CREATE INDEX "Fixture_leagueId_seasonId_kickoff_idx" ON "Fixture"("leagueId", "seasonId", "kickoff");

-- CreateIndex
CREATE UNIQUE INDEX "OddsSnapshot_sourceHash_key" ON "OddsSnapshot"("sourceHash");

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamPeriodStats" ADD CONSTRAINT "TeamPeriodStats_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamPeriodStats" ADD CONSTRAINT "TeamPeriodStats_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarketOutcome" ADD CONSTRAINT "HistoricalMarketOutcome_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalIngestionState" ADD CONSTRAINT "HistoricalIngestionState_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalIngestionState" ADD CONSTRAINT "HistoricalIngestionState_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Season" ADD CONSTRAINT "Season_dates_check" CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "startsAt" <= "endsAt");
ALTER TABLE "ProviderEntityMapping" ADD CONSTRAINT "ProviderEntityMapping_order_check" CHECK ("leftProvider" < "rightProvider");
ALTER TABLE "HistoricalIngestionState" ADD CONSTRAINT "HistoricalIngestionState_counters_check" CHECK (
  "rangeFrom" <= "rangeTo" AND "retryCount" >= 0 AND "fixturesFound" >= 0 AND "fixturesInserted" >= 0 AND "fixturesUpdated" >= 0 AND "fixturesRejected" >= 0
);
ALTER TABLE "TeamPeriodStats" ADD CONSTRAINT "TeamPeriodStats_values_check" CHECK (
  ("goals" IS NULL OR "goals" >= 0) AND ("shots" IS NULL OR "shots" >= 0) AND
  ("shotsOnTarget" IS NULL OR "shotsOnTarget" >= 0) AND ("xg" IS NULL OR "xg" >= 0) AND
  ("corners" IS NULL OR "corners" >= 0) AND ("yellowCards" IS NULL OR "yellowCards" >= 0) AND
  ("redCards" IS NULL OR "redCards" >= 0) AND ("fouls" IS NULL OR "fouls" >= 0) AND
  ("possession" IS NULL OR "possession" BETWEEN 0 AND 100) AND ("dangerousAttacks" IS NULL OR "dangerousAttacks" >= 0)
);
COMMIT;
