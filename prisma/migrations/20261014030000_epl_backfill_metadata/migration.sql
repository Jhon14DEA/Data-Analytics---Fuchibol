BEGIN;
SET LOCAL lock_timeout = '5s';
-- AlterTable
ALTER TABLE "Fixture" ADD COLUMN     "historicalKickoffAt" TIMESTAMP(3),
ADD COLUMN     "kickoffPrecision" TEXT NOT NULL DEFAULT 'EXACT';

-- AlterTable
ALTER TABLE "HistoricalIngestionState" ADD COLUMN     "backfillMetadata" JSONB;


ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_kickoff_precision_check" CHECK ("kickoffPrecision" IN ('EXACT','DATE') AND ("kickoffPrecision" <> 'DATE' OR "historicalKickoffAt" IS NULL));
COMMIT;
