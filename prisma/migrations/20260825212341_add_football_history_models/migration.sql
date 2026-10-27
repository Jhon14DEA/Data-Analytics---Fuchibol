-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('LIVE', 'UPCOMING', 'FINISHED');

-- CreateEnum
CREATE TYPE "FixtureStatus" AS ENUM ('UPCOMING', 'LIVE', 'HALFTIME', 'FINISHED', 'POSTPONED', 'CANCELLED', 'ABANDONED', 'STALE_PROVIDER_DATA');

-- CreateEnum
CREATE TYPE "PickClass" AS ENUM ('STRONG_SUPPORT', 'WATCH', 'HIGH_RISK', 'DISCARD');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('GOAL', 'RED_CARD', 'INJURY', 'PENALTY', 'VAR', 'SUBSTITUTION', 'SHOTS_SPIKE', 'XG_SPIKE', 'DOMINANCE', 'ODDS_MOVEMENT');

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "competition" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL,
    "minute" INTEGER,
    "homeScore" INTEGER NOT NULL DEFAULT 0,
    "awayScore" INTEGER NOT NULL DEFAULT 0,
    "kickoffAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchSnapshot" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "minute" INTEGER,
    "possessionHome" INTEGER NOT NULL,
    "possessionAway" INTEGER NOT NULL,
    "shotsHome" INTEGER NOT NULL,
    "shotsAway" INTEGER NOT NULL,
    "shotsOnTargetHome" INTEGER NOT NULL,
    "shotsOnTargetAway" INTEGER NOT NULL,
    "xgHome" DECIMAL(5,2) NOT NULL,
    "xgAway" DECIMAL(5,2) NOT NULL,
    "cornersHome" INTEGER NOT NULL,
    "cornersAway" INTEGER NOT NULL,
    "yellowCardsHome" INTEGER NOT NULL,
    "yellowCardsAway" INTEGER NOT NULL,
    "redCardsHome" INTEGER NOT NULL,
    "redCardsAway" INTEGER NOT NULL,
    "foulsHome" INTEGER NOT NULL,
    "foulsAway" INTEGER NOT NULL,
    "dangerousHome" INTEGER,
    "dangerousAway" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OddsQuote" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "bookmaker" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "price" DECIMAL(8,3) NOT NULL,
    "minute" INTEGER,
    "quotedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OddsQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisPick" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "availableOdd" DECIMAL(8,3),
    "confidence" INTEGER NOT NULL,
    "classification" "PickClass" NOT NULL,
    "reasons" TEXT[],
    "risks" TEXT[],
    "invalidators" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "severity" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "minute" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "League" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "season" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teamId" TEXT,
    "position" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fixture" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "kickoff" TIMESTAMP(3) NOT NULL,
    "status" "FixtureStatus" NOT NULL,
    "minute" INTEGER,
    "homeScore" INTEGER NOT NULL DEFAULT 0,
    "awayScore" INTEGER NOT NULL DEFAULT 0,
    "season" INTEGER,
    "round" TEXT,
    "venue" TEXT,
    "staleReason" TEXT,
    "providerUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fixture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMatchStats" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "isHome" BOOLEAN NOT NULL,
    "goals" INTEGER,
    "shots" INTEGER,
    "shotsOnTarget" INTEGER,
    "xg" DECIMAL(6,2),
    "possession" INTEGER,
    "corners" INTEGER,
    "yellowCards" INTEGER,
    "redCards" INTEGER,
    "fouls" INTEGER,
    "dangerousAttacks" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMatchStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerMatchStats" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "starter" BOOLEAN,
    "minutes" INTEGER,
    "goals" INTEGER,
    "assists" INTEGER,
    "shots" INTEGER,
    "shotsOnTarget" INTEGER,
    "xg" DECIMAL(6,2),
    "xa" DECIMAL(6,2),
    "keyPasses" INTEGER,
    "foulsCommitted" INTEGER,
    "foulsReceived" INTEGER,
    "yellowCards" INTEGER,
    "redCards" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerMatchStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lineup" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "isHome" BOOLEAN NOT NULL,
    "starter" BOOLEAN NOT NULL,
    "position" TEXT,
    "number" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lineup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchEvent" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "teamId" TEXT,
    "providerEventId" TEXT,
    "eventType" TEXT NOT NULL,
    "minute" INTEGER,
    "playerName" TEXT,
    "detail" TEXT,
    "sourceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveSnapshot" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "minute" INTEGER,
    "homeScore" INTEGER NOT NULL,
    "awayScore" INTEGER NOT NULL,
    "homeShots" INTEGER,
    "awayShots" INTEGER,
    "homeShotsOnTarget" INTEGER,
    "awayShotsOnTarget" INTEGER,
    "homeXg" DECIMAL(6,2),
    "awayXg" DECIMAL(6,2),
    "homeCorners" INTEGER,
    "awayCorners" INTEGER,
    "homeYellowCards" INTEGER,
    "awayYellowCards" INTEGER,
    "homeRedCards" INTEGER,
    "awayRedCards" INTEGER,
    "homePossession" INTEGER,
    "awayPossession" INTEGER,
    "homeDangerousAttacks" INTEGER,
    "awayDangerousAttacks" INTEGER,
    "sourceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bookmaker" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bookmaker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OddsSnapshot" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "bookmakerId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "line" DECIMAL(6,2),
    "odds" DECIMAL(8,3) NOT NULL,
    "minute" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OddsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Match_externalId_key" ON "Match"("externalId");

-- CreateIndex
CREATE INDEX "MatchSnapshot_matchId_capturedAt_idx" ON "MatchSnapshot"("matchId", "capturedAt");

-- CreateIndex
CREATE INDEX "OddsQuote_matchId_market_quotedAt_idx" ON "OddsQuote"("matchId", "market", "quotedAt");

-- CreateIndex
CREATE INDEX "AnalysisPick_matchId_createdAt_idx" ON "AnalysisPick"("matchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_fingerprint_key" ON "Alert"("fingerprint");

-- CreateIndex
CREATE INDEX "Alert_matchId_createdAt_idx" ON "Alert"("matchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSubscription_endpoint_key" ON "NotificationSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "League_name_idx" ON "League"("name");

-- CreateIndex
CREATE UNIQUE INDEX "League_provider_externalId_key" ON "League"("provider", "externalId");

-- CreateIndex
CREATE INDEX "Team_name_idx" ON "Team"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Team_provider_externalId_key" ON "Team"("provider", "externalId");

-- CreateIndex
CREATE INDEX "Player_name_idx" ON "Player"("name");

-- CreateIndex
CREATE INDEX "Player_teamId_idx" ON "Player"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_provider_externalId_key" ON "Player"("provider", "externalId");

-- CreateIndex
CREATE INDEX "Fixture_externalId_idx" ON "Fixture"("externalId");

-- CreateIndex
CREATE INDEX "Fixture_kickoff_idx" ON "Fixture"("kickoff");

-- CreateIndex
CREATE INDEX "Fixture_status_idx" ON "Fixture"("status");

-- CreateIndex
CREATE INDEX "Fixture_homeTeamId_idx" ON "Fixture"("homeTeamId");

-- CreateIndex
CREATE INDEX "Fixture_awayTeamId_idx" ON "Fixture"("awayTeamId");

-- CreateIndex
CREATE INDEX "Fixture_provider_kickoff_idx" ON "Fixture"("provider", "kickoff");

-- CreateIndex
CREATE UNIQUE INDEX "Fixture_provider_externalId_key" ON "Fixture"("provider", "externalId");

-- CreateIndex
CREATE INDEX "TeamMatchStats_teamId_fixtureId_idx" ON "TeamMatchStats"("teamId", "fixtureId");

-- CreateIndex
CREATE INDEX "TeamMatchStats_fixtureId_isHome_idx" ON "TeamMatchStats"("fixtureId", "isHome");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMatchStats_fixtureId_teamId_key" ON "TeamMatchStats"("fixtureId", "teamId");

-- CreateIndex
CREATE INDEX "PlayerMatchStats_playerId_fixtureId_idx" ON "PlayerMatchStats"("playerId", "fixtureId");

-- CreateIndex
CREATE INDEX "PlayerMatchStats_teamId_fixtureId_idx" ON "PlayerMatchStats"("teamId", "fixtureId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerMatchStats_fixtureId_playerId_key" ON "PlayerMatchStats"("fixtureId", "playerId");

-- CreateIndex
CREATE INDEX "Lineup_fixtureId_idx" ON "Lineup"("fixtureId");

-- CreateIndex
CREATE INDEX "Lineup_teamId_idx" ON "Lineup"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Lineup_fixtureId_playerId_teamId_key" ON "Lineup"("fixtureId", "playerId", "teamId");

-- CreateIndex
CREATE INDEX "MatchEvent_fixtureId_idx" ON "MatchEvent"("fixtureId");

-- CreateIndex
CREATE INDEX "MatchEvent_eventType_idx" ON "MatchEvent"("eventType");

-- CreateIndex
CREATE INDEX "MatchEvent_teamId_idx" ON "MatchEvent"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchEvent_fixtureId_sourceHash_key" ON "MatchEvent"("fixtureId", "sourceHash");

-- CreateIndex
CREATE INDEX "LiveSnapshot_fixtureId_timestamp_idx" ON "LiveSnapshot"("fixtureId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "LiveSnapshot_fixtureId_sourceHash_key" ON "LiveSnapshot"("fixtureId", "sourceHash");

-- CreateIndex
CREATE UNIQUE INDEX "Bookmaker_name_key" ON "Bookmaker"("name");

-- CreateIndex
CREATE INDEX "OddsSnapshot_fixtureId_market_bookmakerId_timestamp_idx" ON "OddsSnapshot"("fixtureId", "market", "bookmakerId", "timestamp");

-- CreateIndex
CREATE INDEX "OddsSnapshot_fixtureId_timestamp_idx" ON "OddsSnapshot"("fixtureId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "OddsSnapshot_fixtureId_bookmakerId_market_selection_line_od_key" ON "OddsSnapshot"("fixtureId", "bookmakerId", "market", "selection", "line", "odds", "minute");

-- AddForeignKey
ALTER TABLE "MatchSnapshot" ADD CONSTRAINT "MatchSnapshot_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OddsQuote" ADD CONSTRAINT "OddsQuote_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisPick" ADD CONSTRAINT "AnalysisPick_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMatchStats" ADD CONSTRAINT "TeamMatchStats_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMatchStats" ADD CONSTRAINT "TeamMatchStats_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerMatchStats" ADD CONSTRAINT "PlayerMatchStats_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerMatchStats" ADD CONSTRAINT "PlayerMatchStats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerMatchStats" ADD CONSTRAINT "PlayerMatchStats_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lineup" ADD CONSTRAINT "Lineup_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lineup" ADD CONSTRAINT "Lineup_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lineup" ADD CONSTRAINT "Lineup_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSnapshot" ADD CONSTRAINT "LiveSnapshot_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OddsSnapshot" ADD CONSTRAINT "OddsSnapshot_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OddsSnapshot" ADD CONSTRAINT "OddsSnapshot_bookmakerId_fkey" FOREIGN KEY ("bookmakerId") REFERENCES "Bookmaker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
