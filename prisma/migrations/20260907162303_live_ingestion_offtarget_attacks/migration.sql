-- AlterTable
ALTER TABLE "LiveSnapshot" ADD COLUMN     "awayAttacks" INTEGER,
ADD COLUMN     "awayShotsOffTarget" INTEGER,
ADD COLUMN     "homeAttacks" INTEGER,
ADD COLUMN     "homeShotsOffTarget" INTEGER;

-- AlterTable
ALTER TABLE "TeamMatchStats" ADD COLUMN     "attacks" INTEGER,
ADD COLUMN     "shotsOffTarget" INTEGER;
