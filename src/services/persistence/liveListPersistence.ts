import { createHash } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { MatchSummary } from '@/types/domain';
import { allSportsObservation, knownNumber, trainingReceipt, type AllSportsTrainingRaw } from '@/services/training/observation';

// This writer receives an existing response. It never fetches provider data or
// invokes detail ingestion, training, odds, alerts or betting decisions.
export async function persistAllSportsLiveList(
  rows: { raw: AllSportsTrainingRaw; summary: MatchSummary }[],
  db: Pick<PrismaClient, '$transaction'>,
  now = new Date()
) {
  let persisted = 0, failed = 0;
  for (const { raw, summary } of rows) {
    const receipt = trainingReceipt(raw);
    if (!receipt || summary.status !== 'LIVE') continue;
    const at = new Date(receipt), age = now.getTime() - at.getTime();
    const observation = allSportsObservation(raw, receipt);
    // Required scoreboard columns cannot represent missing scores: skip rather
    // than turning absence into a confirmed 0-0. Never refresh cached receipts.
    if (!Number.isFinite(age) || age < 0 || age > 180000 || !observation.score) continue;
    // General LIVE visibility does not require proof of FIRST_HALF. In particular,
    // a numeric clock can be LIVE while its market period remains UNKNOWN.
    const ids = [raw.event_key, summary.leagueExternalId, summary.homeTeamExternalId, summary.awayTeamExternalId];
    if (ids.some(id => id == null || String(id).trim() === '')) continue;
    // AllSports was requested in America/Bogota (UTC-05:00), not server time.
    const kickoff = new Date(`${summary.kickoffAt}-05:00`);
    if (!Number.isFinite(kickoff.getTime())) continue;
    const provider = 'AllSportsApi', externalId = String(raw.event_key);
    const status = observation.period === 'HALFTIME' ? 'HALFTIME' : 'LIVE';
    const score = observation.score;
    const sourceHash = createHash('sha256').update(`live-list:${externalId}:${receipt}`).digest('hex');
    try {
      const saved = await db.$transaction(async tx => {
        const existing = await tx.fixture.findUnique({ where: { provider_externalId: { provider, externalId } } });
        if (existing && (!['LIVE', 'HALFTIME', 'UPCOMING'].includes(existing.status)
          || (existing.providerUpdatedAt && existing.providerUpdatedAt >= at))) return false;
        const leagueId = String(summary.leagueExternalId);
        const league = await tx.league.upsert({ where: { provider_externalId: { provider, externalId: leagueId } },
          update: {}, create: { provider, externalId: leagueId, name: summary.competition } });
        const team = (id: string, name: string) => tx.team.upsert({ where: { provider_externalId: { provider, externalId: id } },
          update: {}, create: { provider, externalId: id, name } });
        const home = await team(String(summary.homeTeamExternalId), summary.homeTeam);
        const away = await team(String(summary.awayTeamExternalId), summary.awayTeam);
        const data = { leagueId: league.id, homeTeamId: home.id, awayTeamId: away.id, kickoff,
          status, minute: observation.minute, homeScore: score.home, awayScore: score.away,
          providerUpdatedAt: at, staleReason: null } as const;
        const fixture = await tx.fixture.upsert({ where: { provider_externalId: { provider, externalId } },
          update: data, create: { provider, externalId, ...data } });
        const side = (s: 'home' | 'away') => {
          const stats = observation.stats[s];
          const extra = (names: string[], integer = true) => knownNumber(raw.statistics?.find(item => names.includes((item.type ?? '').trim().toLowerCase()))?.[s], integer);
          return Object.fromEntries(Object.entries({ Shots: stats.shots, ShotsOnTarget: stats.sot,
            ShotsOffTarget: extra(['shots off goal', 'shots off target']), Xg: stats.xg,
            BigChances: stats.bigChances, ShotsInsideBox: stats.shotsInsideBox, Corners: stats.corners,
            RedCards: stats.redCards, YellowCards: extra(['yellow cards']),
            Possession: extra(['ball possession', 'possession']), Attacks: extra(['attacks']),
            DangerousAttacks: stats.dangerousAttacks }).map(([key, value]) => [`${s}${key}`, value]));
        };
        await tx.liveSnapshot.create({ data: { fixtureId: fixture.id, sourceHash, timestamp: at,
          minute: observation.minute, homeScore: score.home, awayScore: score.away, ...side('home'), ...side('away') } });
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (saved) persisted++;
    } catch {
      // Fail closed for the AI reader, but retain the already received dashboard.
      // No exception detail here: database connection strings can contain secrets.
      failed++;
    }
  }
  if (failed) console.warn(`[live-list-persistence] ${failed} fixture(s) not saved; AI freshness remains unchanged.`);
  return { persisted, failed };
}
