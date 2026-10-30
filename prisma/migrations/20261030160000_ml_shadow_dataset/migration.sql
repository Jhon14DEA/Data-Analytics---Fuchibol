CREATE TABLE "MlShadowSnapshot" (
  "id" TEXT NOT NULL,
  "fixtureId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerFixtureId" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "persistedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "minute" INTEGER,
  "period" TEXT NOT NULL,
  "homeScore" INTEGER NOT NULL,
  "awayScore" INTEGER NOT NULL,
  "stats" JSONB NOT NULL,
  "recent" JSONB NOT NULL,
  "dataQuality" JSONB NOT NULL,
  "sourceHash" TEXT NOT NULL,
  CONSTRAINT "MlShadowSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MlShadowSnapshot_receipt_check" CHECK ("receivedAt" <= "capturedAt"),
  CONSTRAINT "MlShadowSnapshot_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MlShadowSnapshot_fixtureId_provider_receivedAt_key" ON "MlShadowSnapshot"("fixtureId", "provider", "receivedAt");
CREATE INDEX "MlShadowSnapshot_fixtureId_capturedAt_idx" ON "MlShadowSnapshot"("fixtureId", "capturedAt");
CREATE TABLE "MlShadowOutcome" (
  "id" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "value" DOUBLE PRECISION,
  "resolvedAt" TIMESTAMP(3) NOT NULL,
  "evidence" JSONB NOT NULL,
  CONSTRAINT "MlShadowOutcome_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MlShadowOutcome_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MlShadowSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MlShadowOutcome_snapshotId_label_key" ON "MlShadowOutcome"("snapshotId", "label");
