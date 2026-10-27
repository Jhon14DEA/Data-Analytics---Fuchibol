ALTER TABLE "LiveMarketSnapshot" ADD COLUMN "periodProvider" TEXT,
  ADD COLUMN "statsProvider" TEXT, ADD COLUMN "oddsProvider" TEXT;

CREATE TABLE "HybridScout" (
  "matchId" TEXT NOT NULL PRIMARY KEY,
  "allSportsFixtureId" TEXT NOT NULL,
  "apiFootballFixtureId" TEXT,
  "identity" JSONB NOT NULL,
  "observation" JSONB NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "liveSnapshotId" TEXT,
  "live" BOOLEAN NOT NULL,
  "priority" INTEGER NOT NULL,
  "phase" TEXT NOT NULL DEFAULT 'PENDING_PERIOD_CONFIRMATION',
  "invalidated" BOOLEAN NOT NULL DEFAULT false,
  "certificate" JSONB,
  "validationCount" INTEGER NOT NULL DEFAULT 0,
  "nextValidationAt" TIMESTAMP(3),
  "htAttemptedAt" TIMESTAMP(3),
  "ftAttemptedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HybridScout_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "HybridScout_allSportsFixtureId_key" ON "HybridScout"("allSportsFixtureId");
CREATE UNIQUE INDEX "HybridScout_apiFootballFixtureId_key" ON "HybridScout"("apiFootballFixtureId");
CREATE INDEX "HybridScout_phase_priority_idx" ON "HybridScout"("phase", "priority");

CREATE TABLE "ApiFootballBudget" (
  "day" TEXT NOT NULL PRIMARY KEY, "used" INTEGER NOT NULL DEFAULT 0,
  "automaticUsed" INTEGER NOT NULL DEFAULT 0, "validationUsed" INTEGER NOT NULL DEFAULT 0,
  "remoteLimit" INTEGER NOT NULL DEFAULT 100,
  CONSTRAINT "ApiFootballBudget_nonnegative" CHECK ("used" >= 0 AND "automaticUsed" >= 0 AND "validationUsed" >= 0 AND "remoteLimit" >= 0)
);
CREATE TABLE "HybridApiCache" (
  "key" TEXT NOT NULL PRIMARY KEY, "payload" JSONB,
  "fetchedAt" TIMESTAMP(3), "lockedUntil" TIMESTAMP(3)
);
