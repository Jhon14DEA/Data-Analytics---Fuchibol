-- First confirmed FT resolution, independent of HT. No historical backfill.
ALTER TABLE "LiveMarketSnapshot" ADD COLUMN "ftResolvedAt" TIMESTAMP(3);
