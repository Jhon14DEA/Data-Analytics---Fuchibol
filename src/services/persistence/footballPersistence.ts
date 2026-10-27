import { createHash } from "crypto";
import { FixtureStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { observeLiveMarketDataset } from "@/services/training/liveMarketSnapshots";
import { buildLiveMomentumAnalysis, type StoredLiveSnapshot } from "@/services/analysis/liveMomentum";
import type { LiveDataFreshness, LiveSnapshotDelta, MatchDetail, MatchStatus, OddsQuote, PlayerStat, TeamSide, TeamStats } from "@/types/domain";

type SyncHistoricalTeamDataOptions = {
  provider: string;
  teamExternalId: ExternalIdValue;
  isHome?: boolean;
  staleAfterMs?: number;
  loader: () => Promise<MatchDetail[]>;
};

type ExternalIdValue = string | number | null | undefined;

const HISTORICAL_STALE_MS = 24 * 60 * 60 * 1000;

export async function syncFixture(match: MatchDetail) {
  const provider = providerName(match);
  const league = await upsertLeague(provider, match.competition, match.leagueExternalId);
  const homeTeam = await upsertTeam(provider, match.homeTeam, match.homeTeamExternalId);
  const awayTeam = await upsertTeam(provider, match.awayTeam, match.awayTeamExternalId);
  const fixtureExternalId = externalId(match.id);
  const kickoff = parseKickoff(match.kickoffAt);
  const status = normalizeFixtureStatus(match.status, kickoff, match.minute, match.events.length);
  const existing = await prisma.fixture.findUnique({
    where: { provider_externalId: { provider, externalId: fixtureExternalId } }
  });
  const reconciledStatus = reconcileFixtureStatus(existing?.status ?? null, status);
  const preservesTerminalStatus = existing ? isTerminalFixtureStatus(existing.status) && !isTerminalFixtureStatus(status) : false;
  const persistedMinute = preservesTerminalStatus ? existing?.minute ?? match.minute : match.minute;
  const persistedHomeScore = preservesTerminalStatus ? existing?.homeScore ?? match.score.home : match.score.home;
  const persistedAwayScore = preservesTerminalStatus ? existing?.awayScore ?? match.score.away : match.score.away;
  const staleReason = reconciledStatus === FixtureStatus.STALE_PROVIDER_DATA ? staleProviderReason(kickoff, match.minute, match.events.length) : null;

  return prisma.fixture.upsert({
    where: { provider_externalId: { provider, externalId: fixtureExternalId } },
    update: {
      leagueId: league.id,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      kickoff,
      status: reconciledStatus,
      minute: persistedMinute,
      homeScore: persistedHomeScore,
      awayScore: persistedAwayScore,
      season: kickoff.getFullYear(),
      staleReason,
      providerUpdatedAt: new Date()
    },
    create: {
      provider,
      externalId: fixtureExternalId,
      leagueId: league.id,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      kickoff,
      status: reconciledStatus,
      minute: match.minute,
      homeScore: match.score.home,
      awayScore: match.score.away,
      season: kickoff.getFullYear(),
      staleReason,
      providerUpdatedAt: new Date()
    }
  });
}

export async function syncFixtureStats(fixtureId: string, match: MatchDetail) {
  const fixture = await prisma.fixture.findUniqueOrThrow({ where: { id: fixtureId } });
  const home = await saveTeamStats(fixture.id, fixture.homeTeamId, true, match.score.home, match.stats.home);
  const away = await saveTeamStats(fixture.id, fixture.awayTeamId, false, match.score.away, match.stats.away);
  await saveLineups(fixture.id, fixture.homeTeamId, true, match.lineups.home, providerName(match));
  await saveLineups(fixture.id, fixture.awayTeamId, false, match.lineups.away, providerName(match));
  await saveEvents(fixture.id, fixture.homeTeamId, fixture.awayTeamId, match);
  await savePlayerMatchStats(fixture.id, fixture.homeTeamId, fixture.awayTeamId, match);
  return { home, away };
}

export async function persistMatchDetail(match: MatchDetail) {
  const fixture = await syncFixture(match);
  await syncFixtureStats(fixture.id, match);
  let liveSnapshotId: string | undefined;
  if (fixture.status === FixtureStatus.LIVE || fixture.status === FixtureStatus.HALFTIME) {
    liveSnapshotId = (await saveLiveSnapshot(match, fixture.id)).id;
  }
  await saveOddsSnapshot(match, fixture.id);
  await observeLiveMarketDataset(match, fixture, liveSnapshotId);
  return fixture;
}

export async function syncHistoricalTeamData(options: SyncHistoricalTeamDataOptions) {
  const staleAfterMs = options.staleAfterMs ?? HISTORICAL_STALE_MS;
  const local = await getRecentTeamFixtures(options.teamExternalId, options.provider, options.isHome, 10);
  const completeEnough = local.length >= 10 && local.every((fixture) => Date.now() - fixture.updatedAt.getTime() < staleAfterMs);
  if (completeEnough) {
    return { source: "postgres" as const, fixtures: local };
  }

  const matches = await options.loader();
  const synced = [];
  for (const match of matches) {
    const fixture = await syncFixture(match);
    await syncFixtureStats(fixture.id, match);
    synced.push(fixture);
  }
  return { source: "api" as const, fixtures: synced };
}

export async function saveLiveSnapshot(match: MatchDetail, fixtureId?: string) {
  const resolvedFixtureId = fixtureId ?? (await syncFixture(match)).id;
  const sourceHash = hashObject({
    status: match.status,
    minute: match.minute,
    score: match.score,
    stats: match.stats,
    captureBucket: liveSnapshotCaptureBucket()
  });

  await prisma.liveSnapshot.createMany({
    data: liveSnapshotCreateData(resolvedFixtureId, sourceHash, match),
    skipDuplicates: true
  });

  return prisma.liveSnapshot.findUniqueOrThrow({
    where: { fixtureId_sourceHash: { fixtureId: resolvedFixtureId, sourceHash } }
  });
}

export async function saveOddsSnapshot(match: MatchDetail, fixtureId?: string) {
  const resolvedFixtureId = fixtureId ?? (await syncFixture(match)).id;
  const created = [];
  for (const quote of match.odds) {
    const saved = await saveSingleOddSnapshot(resolvedFixtureId, quote);
    if (saved) created.push(saved);
  }
  return created;
}

export async function getRecentTeamFixtures(teamExternalId: ExternalIdValue, provider: string, isHome?: boolean, take = 5) {
  const normalizedTeamExternalId = normalizeExternalId(teamExternalId);
  if (!normalizedTeamExternalId) return [];
  const team = await prisma.team.findUnique({ where: { provider_externalId: { provider, externalId: normalizedTeamExternalId } } });
  if (!team) return [];

  return prisma.fixture.findMany({
    where: {
      status: FixtureStatus.FINISHED,
      OR: [
        isHome === false ? undefined : { homeTeamId: team.id },
        isHome === true ? undefined : { awayTeamId: team.id }
      ].filter(Boolean) as Prisma.FixtureWhereInput[]
    },
    include: { league: true, homeTeam: true, awayTeam: true, teamStats: true },
    orderBy: { kickoff: "desc" },
    take
  });
}

export async function getLocalAnalysisHistory(match: MatchDetail, take = 10) {
  const provider = providerName(match);
  const homeExternalId = normalizeExternalId(match.homeTeamExternalId) ?? slug(match.homeTeam);
  const awayExternalId = normalizeExternalId(match.awayTeamExternalId) ?? slug(match.awayTeam);
  const fixtureExternalId = externalId(match.id);
  const [homeTeam, awayTeam] = await Promise.all([
    prisma.team.findUnique({ where: { provider_externalId: { provider, externalId: homeExternalId } } }),
    prisma.team.findUnique({ where: { provider_externalId: { provider, externalId: awayExternalId } } })
  ]);

  if (!homeTeam || !awayTeam) {
    return { recentHome: [], recentAway: [], h2h: [] };
  }

  const include = fixtureInclude;
  const [recentHome, recentAway, h2h] = await Promise.all([
    prisma.fixture.findMany({
      where: {
        status: FixtureStatus.FINISHED,
        OR: [{ homeTeamId: homeTeam.id }, { awayTeamId: homeTeam.id }],
        NOT: { provider, externalId: fixtureExternalId }
      },
      include,
      orderBy: { kickoff: "desc" },
      take
    }),
    prisma.fixture.findMany({
      where: {
        status: FixtureStatus.FINISHED,
        OR: [{ homeTeamId: awayTeam.id }, { awayTeamId: awayTeam.id }],
        NOT: { provider, externalId: fixtureExternalId }
      },
      include,
      orderBy: { kickoff: "desc" },
      take
    }),
    prisma.fixture.findMany({
      where: {
        status: FixtureStatus.FINISHED,
        OR: [
          { homeTeamId: homeTeam.id, awayTeamId: awayTeam.id },
          { homeTeamId: awayTeam.id, awayTeamId: homeTeam.id }
        ]
      },
      include,
      orderBy: { kickoff: "desc" },
      take
    })
  ]);

  return {
    recentHome: recentHome.map(mapFixtureRecord),
    recentAway: recentAway.map(mapFixtureRecord),
    h2h: h2h.map(mapFixtureRecord)
  };
}

export async function getPreviousLiveStats(matchId: string) {
  const provider = matchId.startsWith("api-football-") ? "API-Football" : matchId.startsWith("demo-") ? "DEMO" : "AllSportsApi";
  const fixture = await prisma.fixture.findUnique({
    where: { provider_externalId: { provider, externalId: externalId(matchId) } },
    include: { liveSnapshots: { orderBy: { timestamp: "desc" }, take: 2 } }
  });
  const previous = fixture?.liveSnapshots[1] ?? null;
  if (!previous) return null;
  return {
    home: {
      possession: previous.homePossession,
      shots: previous.homeShots,
      shotsOffTarget: previous.homeShotsOffTarget,
      shotsOnTarget: previous.homeShotsOnTarget,
      xg: previous.homeXg === null ? null : Number(previous.homeXg),
      corners: previous.homeCorners,
      yellowCards: previous.homeYellowCards,
      redCards: previous.homeRedCards,
      fouls: null,
      attacks: previous.homeAttacks,
      dangerousAttacks: previous.homeDangerousAttacks
    },
    away: {
      possession: previous.awayPossession,
      shots: previous.awayShots,
      shotsOffTarget: previous.awayShotsOffTarget,
      shotsOnTarget: previous.awayShotsOnTarget,
      xg: previous.awayXg === null ? null : Number(previous.awayXg),
      corners: previous.awayCorners,
      yellowCards: previous.awayYellowCards,
      redCards: previous.awayRedCards,
      fouls: null,
      attacks: previous.awayAttacks,
      dangerousAttacks: previous.awayDangerousAttacks
    }
  };
}

export async function reconcileMissingProviderFixture(matchId: string, reason: string) {
  const provider = providerFromMatchId(matchId);
  const fixture = await prisma.fixture.findUnique({
    where: { provider_externalId: { provider, externalId: externalId(matchId) } },
    include: { liveSnapshots: { orderBy: { timestamp: "desc" }, take: 1 } }
  });

  if (!fixture) return null;

  const latestSnapshot = fixture.liveSnapshots[0] ?? null;
  const shouldClose = (fixture.status === FixtureStatus.LIVE || fixture.status === FixtureStatus.HALFTIME) && isMissingProviderLiveStale(fixture, latestSnapshot);
  if (shouldClose) {
    await prisma.fixture.update({
      where: { id: fixture.id },
      data: {
        status: FixtureStatus.STALE_PROVIDER_DATA,
        staleReason: reason,
        providerUpdatedAt: new Date()
      }
    });
  }

  return getPersistedMatchDetail(matchId);
}

export async function getPersistedMatchDetail(matchId: string) {
  const provider = providerFromMatchId(matchId);
  const fixture = await prisma.fixture.findUnique({
    where: { provider_externalId: { provider, externalId: externalId(matchId) } },
    include: fixtureInclude
  });
  return fixture ? mapFixtureRecord(fixture) : null;
}

export async function getLiveSnapshotTrend(matchId: string) {
  const provider = matchId.startsWith("api-football-") ? "API-Football" : matchId.startsWith("demo-") ? "DEMO" : "AllSportsApi";
  const fixture = await prisma.fixture.findUnique({
    where: { provider_externalId: { provider, externalId: externalId(matchId) } },
    include: { liveSnapshots: { orderBy: { timestamp: "desc" }, take: 20 } }
  });
  const latest = fixture?.liveSnapshots[0] ?? null;
  const snapshots = fixture?.liveSnapshots ?? [];
  const five = snapshotDelta(latest, snapshots, 5);
  const ten = snapshotDelta(latest, snapshots, 10);
  const fifteen = snapshotDelta(latest, snapshots, 15);
  return {
    available: Boolean(latest && snapshots.length >= 2),
    five,
    ten,
    fifteen
  };
}

export async function getLiveMomentumBreakdown(matchId: string, match: MatchDetail) {
  const provider = matchId.startsWith("api-football-") ? "API-Football" : matchId.startsWith("demo-") ? "DEMO" : "AllSportsApi";
  const fixture = await prisma.fixture.findUnique({
    where: { provider_externalId: { provider, externalId: externalId(matchId) } },
    include: { liveSnapshots: { orderBy: { timestamp: "desc" }, take: 40 } }
  });
  const snapshots: StoredLiveSnapshot[] = (fixture?.liveSnapshots ?? []).reverse().map((snapshot) => ({
    timestamp: snapshot.timestamp,
    minute: snapshot.minute,
    homeScore: snapshot.homeScore,
    awayScore: snapshot.awayScore,
    homeShots: snapshot.homeShots,
    awayShots: snapshot.awayShots,
    homeShotsOffTarget: snapshot.homeShotsOffTarget,
    awayShotsOffTarget: snapshot.awayShotsOffTarget,
    homeShotsOnTarget: snapshot.homeShotsOnTarget,
    awayShotsOnTarget: snapshot.awayShotsOnTarget,
    homeXg: decimalNumber(snapshot.homeXg),
    awayXg: decimalNumber(snapshot.awayXg),
    homeCorners: snapshot.homeCorners,
    awayCorners: snapshot.awayCorners,
    homeYellowCards: snapshot.homeYellowCards,
    awayYellowCards: snapshot.awayYellowCards,
    homeRedCards: snapshot.homeRedCards,
    awayRedCards: snapshot.awayRedCards,
    homePossession: snapshot.homePossession,
    awayPossession: snapshot.awayPossession,
    homeAttacks: snapshot.homeAttacks,
    awayAttacks: snapshot.awayAttacks,
    homeDangerousAttacks: snapshot.homeDangerousAttacks,
    awayDangerousAttacks: snapshot.awayDangerousAttacks
  }));
  return buildLiveMomentumAnalysis(match, snapshots);
}

export async function getLiveSnapshotCoverageDebug(matchId: string) {
  const provider = providerFromMatchId(matchId);
  const fixture = await prisma.fixture.findUnique({
    where: { provider_externalId: { provider, externalId: externalId(matchId) } },
    include: { liveSnapshots: { orderBy: { timestamp: "asc" }, take: 80 } }
  });
  const snapshots = fixture?.liveSnapshots ?? [];
  const oldest = snapshots[0] ?? null;
  const newest = snapshots[snapshots.length - 1] ?? null;
  const coverage5 = snapshotCoverageWindow(newest, snapshots, 5);
  const coverage10 = snapshotCoverageWindow(newest, snapshots, 10);
  const coverage15 = snapshotCoverageWindow(newest, snapshots, 15);
  return {
    snapshotsCount: snapshots.length,
    oldestSnapshotAt: oldest?.timestamp.toISOString() ?? null,
    newestSnapshotAt: newest?.timestamp.toISOString() ?? null,
    coverage5,
    coverage10,
    coverage15,
    recentDataStatus: recentDataStatusFromCoverage([coverage10, coverage15])
  };
}

export async function getMatchDataFreshness(matchId: string, match?: MatchDetail): Promise<LiveDataFreshness | null> {
  const provider = providerFromMatchId(matchId);
  const fixture = await prisma.fixture.findUnique({
    where: { provider_externalId: { provider, externalId: externalId(matchId) } },
    include: {
      liveSnapshots: { orderBy: { timestamp: "desc" }, take: 12 },
      events: { orderBy: { createdAt: "desc" }, take: 1 },
      oddsSnapshots: { orderBy: { timestamp: "desc" }, take: 1 }
    }
  });
  if (!fixture) return null;

  const now = new Date();
  const latestSnapshot = fixture.liveSnapshots[0] ?? null;
  const lastScoreSnapshot = lastSnapshotWithScoreChange(fixture.liveSnapshots);
  const providerFetchedAt = fixture.providerUpdatedAt ?? fixture.updatedAt;
  const lastEventAt = fixture.events[0]?.createdAt ?? null;
  const oddsUpdatedAt = fixture.oddsSnapshots[0]?.timestamp ?? null;
  const statsUpdatedAt = latestSnapshot?.timestamp ?? null;
  const providerAgeSeconds = ageSeconds(providerFetchedAt, now);
  const statsAgeSeconds = ageSeconds(statsUpdatedAt, now);
  const eventAgeSeconds = ageSeconds(lastEventAt, now);
  const oddsAgeSeconds = ageSeconds(oddsUpdatedAt, now);
  const scoreAgeSeconds = ageSeconds(lastScoreSnapshot?.timestamp ?? statsUpdatedAt, now);
  const live = (match?.status ?? domainStatus(fixture.status)) === "LIVE";
  const staleReasons = [
    live && providerAgeSeconds !== null && providerAgeSeconds > 180 ? `providerFetchedAt hace ${providerAgeSeconds}s` : null,
    live && statsAgeSeconds !== null && statsAgeSeconds > 240 ? `statsUpdatedAt hace ${statsAgeSeconds}s` : null,
    live && statsUpdatedAt === null ? "sin LiveSnapshot reciente" : null,
    live && (match?.minute ?? fixture.minute ?? null) !== null && providerAgeSeconds !== null && providerAgeSeconds > 300 ? "minuto/marcador sin confirmacion fresca del proveedor" : null
  ].filter((item): item is string => Boolean(item));

  return {
    providerFetchedAt: providerFetchedAt?.toISOString() ?? null,
    lastScoreChangeAt: lastScoreSnapshot?.timestamp.toISOString() ?? null,
    lastEventAt: lastEventAt?.toISOString() ?? null,
    statsUpdatedAt: statsUpdatedAt?.toISOString() ?? null,
    oddsUpdatedAt: oddsUpdatedAt?.toISOString() ?? null,
    providerAgeSeconds,
    scoreAgeSeconds,
    eventAgeSeconds,
    statsAgeSeconds,
    oddsAgeSeconds,
    liveDataStale: staleReasons.length > 0,
    staleReasons
  };
}

export async function getTodaysBettableFixtures(now = new Date()) {
  const { start, end } = localDayRange(now);
  return prisma.fixture.findMany({
    where: {
      kickoff: { gte: start, lt: end },
      status: { in: [FixtureStatus.UPCOMING, FixtureStatus.LIVE, FixtureStatus.HALFTIME] }
    },
    include: { league: true, homeTeam: true, awayTeam: true, teamStats: true, oddsSnapshots: { include: { bookmaker: true } } },
    orderBy: { kickoff: "asc" }
  });
}

export function normalizeFixtureStatus(status: MatchStatus | string, kickoff: Date, minute: number | null, eventsCount = 0): FixtureStatus {
  const raw = normalizeStatusText(status);
  if (raw === "HALFTIME" || raw === "HT") return FixtureStatus.HALFTIME;
  if (isFinishedStatusText(raw)) return FixtureStatus.FINISHED;
  if (isPostponedStatusText(raw)) return FixtureStatus.POSTPONED;
  if (isCancelledStatusText(raw)) return FixtureStatus.CANCELLED;
  if (isAbandonedStatusText(raw)) return FixtureStatus.ABANDONED;
  if ((raw === "LIVE" || minute !== null) && isStaleProviderData(kickoff, minute, eventsCount)) return FixtureStatus.STALE_PROVIDER_DATA;
  if (raw === "LIVE") return FixtureStatus.LIVE;
  return FixtureStatus.UPCOMING;
}

export function isStaleProviderData(kickoff: Date, minute: number | null, eventsCount = 0, now = new Date()) {
  const ageHours = (now.getTime() - kickoff.getTime()) / 36e5;
  if (minute !== null && minute >= 90 && ageHours >= 3.25) return true;
  return ageHours >= 6 && eventsCount === 0 && (minute === null || minute < 90);
}

export async function getFixtureLifecycleDebug(matchId: string, providerRawStatus: string | null, normalizedStatus: MatchStatus | null, statusSource: string, reconciliationReason: string) {
  const provider = providerFromMatchId(matchId);
  const fixture = await prisma.fixture.findUnique({
    where: { provider_externalId: { provider, externalId: externalId(matchId) } },
    include: { liveSnapshots: { orderBy: { timestamp: "desc" }, take: 1 } }
  });
  const latestSnapshot = fixture?.liveSnapshots[0] ?? null;
  const now = Date.now();
  return {
    providerRawStatus,
    normalizedStatus,
    persistedStatus: fixture?.status ?? null,
    snapshotStatus: latestSnapshot ? "LIVE_SNAPSHOT" : null,
    snapshotAge: latestSnapshot ? Math.round((now - latestSnapshot.timestamp.getTime()) / 1000) : null,
    cacheAge: null,
    statusSource,
    reconciliationReason
  };
}

async function saveTeamStats(fixtureId: string, teamId: string, isHome: boolean, goals: number, stats: TeamStats) {
  return prisma.teamMatchStats.upsert({
    where: { fixtureId_teamId: { fixtureId, teamId } },
    update: teamStatsData(isHome, goals, stats),
    create: { fixtureId, teamId, ...teamStatsData(isHome, goals, stats) }
  });
}

function teamStatsData(isHome: boolean, goals: number, stats: TeamStats) {
  return {
    isHome,
    goals,
    shots: stats.shots,
    shotsOffTarget: stats.shotsOffTarget ?? null,
    shotsOnTarget: stats.shotsOnTarget,
    xg: decimalOrNull(stats.xg),
    possession: stats.possession,
    corners: stats.corners,
    yellowCards: stats.yellowCards,
    redCards: stats.redCards,
    fouls: stats.fouls,
    attacks: stats.attacks ?? null,
    dangerousAttacks: stats.dangerousAttacks ?? null
  };
}

async function saveLineups(fixtureId: string, teamId: string, isHome: boolean, players: MatchDetail["lineups"]["home"], provider: string) {
  for (const item of players) {
    const position = normalizeOptionalString(item.position);
    const number = normalizeOptionalNumber(item.number);
    const player = await upsertPlayer(provider, item.name, teamId, position);
    await prisma.lineup.upsert({
      where: { fixtureId_playerId_teamId: { fixtureId, playerId: player.id, teamId } },
      update: { isHome, starter: true, position, number },
      create: { fixtureId, teamId, playerId: player.id, isHome, starter: true, position, number }
    });
  }
}

async function saveEvents(fixtureId: string, homeTeamId: string, awayTeamId: string, match: MatchDetail) {
  for (const event of match.events) {
    const teamId = event.team === "home" ? homeTeamId : event.team === "away" ? awayTeamId : null;
    const sourceHash = hashObject({ minute: event.minute, type: event.type, team: event.team, title: event.title, detail: event.detail });
    await prisma.matchEvent.upsert({
      where: { fixtureId_sourceHash: { fixtureId, sourceHash } },
      update: { minute: event.minute, teamId, eventType: event.type, playerName: event.detail || null, detail: event.title, sourceHash },
      create: { fixtureId, teamId, eventType: event.type, minute: event.minute, playerName: event.detail || null, detail: event.title, sourceHash }
    });
  }
}

async function savePlayerMatchStats(fixtureId: string, homeTeamId: string, awayTeamId: string, match: MatchDetail) {
  for (const stat of match.playerStats) {
    const teamId = stat.team === "home" ? homeTeamId : awayTeamId;
    const player = await upsertPlayer(providerName(match), stat.player, teamId, normalizeOptionalString(stat.position));
    await prisma.playerMatchStats.upsert({
      where: { fixtureId_playerId: { fixtureId, playerId: player.id } },
      update: playerStatsData(stat, isStarter(match, stat.player)),
      create: { fixtureId, playerId: player.id, teamId, ...playerStatsData(stat, isStarter(match, stat.player)) }
    });
  }
}

function playerStatsData(stat: PlayerStat, starter: boolean) {
  return {
    starter,
    minutes: stat.minutes ?? null,
    goals: stat.goals ?? null,
    assists: stat.assists ?? null,
    shots: stat.shots,
    shotsOnTarget: stat.shotsOnTarget,
    xg: decimalOrNull(stat.xg),
    xa: decimalOrNull(stat.xa),
    keyPasses: stat.keyPasses,
    foulsCommitted: stat.foulsCommitted,
    foulsReceived: stat.foulsReceived ?? null,
    yellowCards: stat.yellowCards ?? null,
    redCards: stat.redCards ?? null
  };
}

async function saveSingleOddSnapshot(fixtureId: string, quote: OddsQuote) {
  const bookmakerName = normalizeExternalId(quote.bookmaker) ?? "N/D";
  const bookmaker = await prisma.bookmaker.upsert({
    where: { name: bookmakerName },
    update: {},
    create: { name: bookmakerName }
  });
  const line = decimalOrNull(extractLine(`${quote.market} ${quote.selection}`));
  const odds = new Prisma.Decimal(quote.price);
  const lockKey = advisoryLockKey([fixtureId, bookmaker.id, quote.market, quote.selection, line?.toString() ?? "NULL", odds.toString(), quote.minute ?? "NULL"]);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
    const existing = await tx.oddsSnapshot.findFirst({
      where: { fixtureId, bookmakerId: bookmaker.id, market: quote.market, selection: quote.selection, line, odds, minute: quote.minute },
      orderBy: { timestamp: "desc" }
    });
    if (existing) return null;

    return tx.oddsSnapshot.create({
      data: { fixtureId, bookmakerId: bookmaker.id, market: quote.market, selection: quote.selection, line, odds, minute: quote.minute, timestamp: new Date(quote.quotedAt) }
    });
  });
}

export function liveSnapshotCreateData(fixtureId: string, sourceHash: string, match: MatchDetail): Prisma.LiveSnapshotCreateManyInput {
  return {
    fixtureId,
    minute: match.minute,
    homeScore: match.score.home,
    awayScore: match.score.away,
    homeShots: match.stats.home.shots,
    awayShots: match.stats.away.shots,
    homeShotsOffTarget: match.stats.home.shotsOffTarget ?? null,
    awayShotsOffTarget: match.stats.away.shotsOffTarget ?? null,
    homeShotsOnTarget: match.stats.home.shotsOnTarget,
    awayShotsOnTarget: match.stats.away.shotsOnTarget,
    homeBigChances: match.stats.home.bigChances ?? null,
    awayBigChances: match.stats.away.bigChances ?? null,
    homeShotsInsideBox: match.stats.home.shotsInsideBox ?? null,
    awayShotsInsideBox: match.stats.away.shotsInsideBox ?? null,
    homeXg: decimalOrNull(match.stats.home.xg),
    awayXg: decimalOrNull(match.stats.away.xg),
    homeCorners: match.stats.home.corners,
    awayCorners: match.stats.away.corners,
    homeYellowCards: match.stats.home.yellowCards,
    awayYellowCards: match.stats.away.yellowCards,
    homeRedCards: match.stats.home.redCards,
    awayRedCards: match.stats.away.redCards,
    homePossession: match.stats.home.possession,
    awayPossession: match.stats.away.possession,
    homeAttacks: match.stats.home.attacks ?? null,
    awayAttacks: match.stats.away.attacks ?? null,
    homeDangerousAttacks: match.stats.home.dangerousAttacks ?? null,
    awayDangerousAttacks: match.stats.away.dangerousAttacks ?? null,
    sourceHash
  };
}

function liveSnapshotCaptureBucket() {
  const refreshSeconds = Number(process.env.LIVE_REFRESH_SECONDS) || 120;
  const bucketMs = Math.max(60_000, refreshSeconds * 1000);
  return Math.floor(Date.now() / bucketMs);
}

async function upsertLeague(provider: string, name: string, providerExternalId?: ExternalIdValue) {
  const externalId = normalizeExternalId(providerExternalId) ?? slug(name);
  return prisma.league.upsert({
    where: { provider_externalId: { provider, externalId } },
    update: { name },
    create: { provider, externalId, name }
  });
}

async function upsertTeam(provider: string, name: string, providerExternalId?: ExternalIdValue) {
  const externalId = normalizeExternalId(providerExternalId) ?? slug(name);
  return prisma.team.upsert({
    where: { provider_externalId: { provider, externalId } },
    update: { name },
    create: { provider, externalId, name }
  });
}

async function upsertPlayer(provider: string, name: string, teamId: string, position?: string | null, providerExternalId?: ExternalIdValue) {
  const externalId = normalizeExternalId(providerExternalId) ?? `${teamId}:${slug(name)}`;
  const normalizedPosition = normalizeOptionalString(position);
  return prisma.player.upsert({
    where: { provider_externalId: { provider, externalId } },
    update: { name, teamId, position: normalizedPosition },
    create: { provider, externalId, name, teamId, position: normalizedPosition }
  });
}

function isStarter(match: MatchDetail, playerName: string) {
  const names = [...match.lineups.home, ...match.lineups.away].map((player) => slug(player.name));
  return names.includes(slug(playerName));
}

function providerName(match: MatchDetail) {
  if (match.source === "api-football") return "API-Football";
  if (match.source === "demo") return "DEMO";
  return "AllSportsApi";
}

function normalizeExternalId(value: ExternalIdValue): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

function normalizeOptionalString(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function normalizeOptionalNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function externalId(matchId: ExternalIdValue) {
  return (normalizeExternalId(matchId) ?? "unknown").replace(/^allsports-/, "").replace(/^api-football-/, "").replace(/^demo-/, "");
}

const fixtureInclude = Prisma.validator<Prisma.FixtureInclude>()({
    league: true,
    homeTeam: true,
    awayTeam: true,
    teamStats: true,
    liveSnapshots: { orderBy: { timestamp: "desc" as const }, take: 1 },
    playerStats: { include: { player: true, team: true } },
    lineups: { include: { player: true } },
    events: true,
    oddsSnapshots: { include: { bookmaker: true }, orderBy: { timestamp: "desc" as const } }
});

type FixtureRecord = Prisma.FixtureGetPayload<{ include: typeof fixtureInclude }>;

export function mapFixtureRecord(fixture: FixtureRecord): MatchDetail {
  const snapshot = fixture.liveSnapshots[0];
  const aligned = snapshot && snapshot.minute === fixture.minute && snapshot.homeScore === fixture.homeScore && snapshot.awayScore === fixture.awayScore ? snapshot : null;
  const homeStats = fixture.teamStats.find((item) => item.teamId === fixture.homeTeamId);
  const awayStats = fixture.teamStats.find((item) => item.teamId === fixture.awayTeamId);
  return {
    id: `${providerPrefix(fixture.provider)}-${fixture.externalId}`,
    source: sourceForProvider(fixture.provider),
    leagueExternalId: fixture.league.externalId,
    homeTeamExternalId: fixture.homeTeam.externalId,
    awayTeamExternalId: fixture.awayTeam.externalId,
    homeTeam: fixture.homeTeam.name,
    awayTeam: fixture.awayTeam.name,
    competition: fixture.league.name,
    status: domainStatus(fixture.status),
    minute: fixture.minute,
    score: { home: fixture.homeScore, away: fixture.awayScore },
    kickoffAt: fixture.kickoff.toISOString(),
    demo: fixture.provider === "DEMO",
    providerStatus: `${fixture.provider} local`,
    stats: {
      home: { ...teamStatsFromRecord(homeStats), bigChances: aligned?.homeBigChances ?? null, shotsInsideBox: aligned?.homeShotsInsideBox ?? null },
      away: { ...teamStatsFromRecord(awayStats), bigChances: aligned?.awayBigChances ?? null, shotsInsideBox: aligned?.awayShotsInsideBox ?? null }
    },
    lineups: {
      home: fixture.lineups.filter((item) => item.teamId === fixture.homeTeamId).map((item) => ({ name: item.player.name, number: item.number ?? 0, position: item.position ?? item.player.position ?? "N/D" })),
      away: fixture.lineups.filter((item) => item.teamId === fixture.awayTeamId).map((item) => ({ name: item.player.name, number: item.number ?? 0, position: item.position ?? item.player.position ?? "N/D" }))
    },
    substitutions: fixture.events.filter((event) => event.eventType === "substitution").map(eventFromRecord),
    events: fixture.events.map(eventFromRecord),
    playerStats: fixture.playerStats.map((stat) => ({
      player: stat.player.name,
      team: stat.teamId === fixture.homeTeamId ? "home" : "away",
      position: stat.player.position ?? "N/D",
      minutes: stat.minutes,
      goals: stat.goals,
      assists: stat.assists,
      shots: stat.shots,
      shotsOnTarget: stat.shotsOnTarget,
      xg: stat.xg === null || stat.xg === undefined ? null : Number(stat.xg),
      xa: stat.xa === null || stat.xa === undefined ? null : Number(stat.xa),
      keyPasses: stat.keyPasses,
      foulsCommitted: stat.foulsCommitted,
      foulsReceived: stat.foulsReceived,
      yellowCards: stat.yellowCards,
      redCards: stat.redCards
    })),
    odds: fixture.oddsSnapshots.map((quote) => ({
      bookmaker: quote.bookmaker.name,
      market: quote.market,
      selection: quote.selection,
      price: Number(quote.odds),
      quotedAt: quote.timestamp.toISOString(),
      minute: quote.minute
    })),
    oddsHistory: fixture.oddsSnapshots.map((quote) => ({
      bookmaker: quote.bookmaker.name,
      market: quote.market,
      selection: quote.selection,
      price: Number(quote.odds),
      quotedAt: quote.timestamp.toISOString(),
      minute: quote.minute
    })),
    analysis: [],
    alerts: []
  };
}

function teamStatsFromRecord(stats: FixtureRecord["teamStats"][number] | undefined): TeamStats {
  return {
    possession: stats?.possession ?? null,
    shots: stats?.shots ?? null,
    shotsOffTarget: stats?.shotsOffTarget ?? null,
    shotsOnTarget: stats?.shotsOnTarget ?? null,
    xg: stats?.xg === null || stats?.xg === undefined ? null : Number(stats.xg),
    corners: stats?.corners ?? null,
    yellowCards: stats?.yellowCards ?? null,
    redCards: stats?.redCards ?? null,
    fouls: stats?.fouls ?? null,
    attacks: stats?.attacks ?? null,
    dangerousAttacks: stats?.dangerousAttacks ?? null
  };
}

function eventFromRecord(event: FixtureRecord["events"][number]) {
  return {
    minute: event.minute ?? 0,
    type: event.eventType as MatchDetail["events"][number]["type"],
    team: undefined,
    title: event.eventType,
    detail: event.detail ?? event.playerName ?? "N/D"
  };
}

function domainStatus(status: FixtureStatus): MatchStatus {
  if (status === FixtureStatus.FINISHED || status === FixtureStatus.POSTPONED || status === FixtureStatus.CANCELLED || status === FixtureStatus.ABANDONED || status === FixtureStatus.STALE_PROVIDER_DATA) return "FINISHED";
  if (status === FixtureStatus.LIVE || status === FixtureStatus.HALFTIME) return "LIVE";
  return "UPCOMING";
}

function providerFromMatchId(matchId: string) {
  if (matchId.startsWith("api-football-")) return "API-Football";
  if (matchId.startsWith("demo-")) return "DEMO";
  return "AllSportsApi";
}

function reconcileFixtureStatus(existing: FixtureStatus | null, incoming: FixtureStatus) {
  if (existing && isTerminalFixtureStatus(existing) && !isTerminalFixtureStatus(incoming)) {
    return existing;
  }
  return incoming;
}

function isTerminalFixtureStatus(status: FixtureStatus) {
  return status === FixtureStatus.FINISHED ||
    status === FixtureStatus.POSTPONED ||
    status === FixtureStatus.CANCELLED ||
    status === FixtureStatus.ABANDONED ||
    status === FixtureStatus.STALE_PROVIDER_DATA;
}

function isMissingProviderLiveStale(
  fixture: { kickoff: Date; minute: number | null; providerUpdatedAt: Date | null; updatedAt: Date; status: FixtureStatus },
  latestSnapshot: { timestamp: Date } | null
) {
  const now = Date.now();
  const refreshMs = (Number(process.env.LIVE_REFRESH_SECONDS) || 120) * 1000;
  const staleAfterMs = Math.max(240_000, refreshMs * 2);
  const providerAge = now - (fixture.providerUpdatedAt ?? fixture.updatedAt).getTime();
  const snapshotAge = latestSnapshot ? now - latestSnapshot.timestamp.getTime() : Number.POSITIVE_INFINITY;
  const kickoffAgeHours = (now - fixture.kickoff.getTime()) / 36e5;
  return snapshotAge >= staleAfterMs || providerAge >= staleAfterMs || (fixture.minute !== null && fixture.minute >= 70 && kickoffAgeHours >= 2.2);
}

function normalizeStatusText(status: MatchStatus | string) {
  return String(status)
    .replace(/[_-]+/g, " ")
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function isFinishedStatusText(status: string) {
  return [
    "FINISHED",
    "FT",
    "FULL TIME",
    "FULLTIME",
    "AET",
    "AFTER ET",
    "AFTER EXTRA TIME",
    "PEN",
    "AFTER PEN",
    "AFTER PENALTIES",
    "PENALTIES",
    "ENDED"
  ].includes(status);
}

function isPostponedStatusText(status: string) {
  return ["POSTPONED", "PST", "POSTP"].includes(status) || status.includes("POSTPON");
}

function isCancelledStatusText(status: string) {
  return ["CANCELLED", "CANCELED", "CANC"].includes(status) || status.includes("CANCEL");
}

function isAbandonedStatusText(status: string) {
  return ["ABANDONED", "ABD"].includes(status) || status.includes("ABANDON");
}

function providerPrefix(provider: string) {
  if (provider === "API-Football") return "api-football";
  if (provider === "DEMO") return "demo";
  return "allsports";
}

function sourceForProvider(provider: string) {
  if (provider === "API-Football") return "api-football" as const;
  if (provider === "DEMO") return "demo" as const;
  return "allsports" as const;
}

function snapshotDelta(
  latest: Awaited<ReturnType<typeof prisma.liveSnapshot.findFirst>> | null,
  snapshots: Awaited<ReturnType<typeof prisma.liveSnapshot.findMany>>,
  minutes: 5 | 10 | 15
): LiveSnapshotDelta {
  const empty = { minutes, requestedMinutes: minutes, observedMinutes: null, coveragePercentage: 0, isComplete: false, shots: null, shotsOffTarget: null, shotsOnTarget: null, xg: null, corners: null, attacks: null, dangerousAttacks: null, goals: null, cards: null };
  if (!latest) return empty;
  const previous = snapshotAtOrBeforeWindowStart(latest, snapshots, minutes);
  if (!previous || previous.id === latest.id) return empty;
  const observedMinutes = observedSnapshotMinutes(latest, snapshots, minutes);
  const coveragePercentage = Math.min(100, Math.round((observedMinutes / minutes) * 100));
  if (coveragePercentage < 75) return { ...empty, observedMinutes, coveragePercentage };
  return {
    minutes,
    requestedMinutes: minutes,
    observedMinutes,
    coveragePercentage,
    isComplete: true,
    shots: diffPair(latest.homeShots, latest.awayShots, previous.homeShots, previous.awayShots),
    shotsOffTarget: diffPair(latest.homeShotsOffTarget, latest.awayShotsOffTarget, previous.homeShotsOffTarget, previous.awayShotsOffTarget),
    shotsOnTarget: diffPair(latest.homeShotsOnTarget, latest.awayShotsOnTarget, previous.homeShotsOnTarget, previous.awayShotsOnTarget),
    xg: diffPair(decimalNumber(latest.homeXg), decimalNumber(latest.awayXg), decimalNumber(previous.homeXg), decimalNumber(previous.awayXg)),
    corners: diffPair(latest.homeCorners, latest.awayCorners, previous.homeCorners, previous.awayCorners),
    attacks: diffPair(latest.homeAttacks, latest.awayAttacks, previous.homeAttacks, previous.awayAttacks),
    dangerousAttacks: diffPair(latest.homeDangerousAttacks, latest.awayDangerousAttacks, previous.homeDangerousAttacks, previous.awayDangerousAttacks),
    goals: latest.homeScore + latest.awayScore - previous.homeScore - previous.awayScore,
    cards: diffPair(latest.homeYellowCards, latest.awayYellowCards, previous.homeYellowCards, previous.awayYellowCards)
  };
}

function snapshotAtOrBeforeWindowStart<T extends { minute: number | null; timestamp: Date }>(latest: T, snapshots: T[], minutes: 5 | 10 | 15) {
  const targetMinute = latest.minute === null ? null : latest.minute - minutes;
  return snapshots.find((item) => {
    if (targetMinute !== null && item.minute !== null) return item.minute <= targetMinute;
    return latest.timestamp.getTime() - item.timestamp.getTime() >= minutes * 60_000;
  }) ?? null;
}

function observedSnapshotMinutes<T extends { minute: number | null; timestamp: Date }>(latest: T, snapshots: T[], minutes: 5 | 10 | 15) {
  const windowStartMinute = latest.minute === null ? null : latest.minute - minutes;
  const maxGap = 6;
  const ordered = [...snapshots]
    .filter((item) => item !== latest)
    .concat(latest)
    .sort((a, b) => {
      const minuteDiff = (a.minute ?? -1) - (b.minute ?? -1);
      return minuteDiff || a.timestamp.getTime() - b.timestamp.getTime();
    });
  let observed = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const start = ordered[index - 1];
    const end = ordered[index];
    const gap = end.minute !== null && start.minute !== null
      ? Math.max(0, end.minute - start.minute)
      : Math.max(0, (end.timestamp.getTime() - start.timestamp.getTime()) / 60_000);
    if (!Number.isFinite(gap) || gap <= 0 || gap > maxGap) continue;
    if (latest.minute !== null && windowStartMinute !== null && start.minute !== null && end.minute !== null) {
      observed += Math.max(0, Math.min(end.minute, latest.minute) - Math.max(start.minute, windowStartMinute));
    } else {
      const windowStartTime = latest.timestamp.getTime() - minutes * 60_000;
      observed += Math.max(0, (Math.min(end.timestamp.getTime(), latest.timestamp.getTime()) - Math.max(start.timestamp.getTime(), windowStartTime)) / 60_000);
    }
  }
  return Math.max(0, Math.round(Math.min(minutes, observed) * 10) / 10);
}

function snapshotCoverageWindow<T extends { minute: number | null; timestamp: Date; homeShots: number | null; awayShots: number | null; homeShotsOnTarget: number | null; awayShotsOnTarget: number | null; homeXg: Prisma.Decimal | null; awayXg: Prisma.Decimal | null; homeCorners: number | null; awayCorners: number | null; homeDangerousAttacks: number | null; awayDangerousAttacks: number | null }>(
  latest: T | null,
  snapshots: T[],
  minutes: 5 | 10 | 15
) {
  if (!latest) {
    return { requestedMinutes: minutes, observedMinutes: null, coveragePercentage: 0, isComplete: false, dataStatus: "INSUFFICIENT_RECENT_DATA" as const };
  }
  const previous = snapshotAtOrBeforeWindowStart(latest, [...snapshots].reverse(), minutes);
  if (!previous || previous === latest) {
    return { requestedMinutes: minutes, observedMinutes: null, coveragePercentage: 0, isComplete: false, dataStatus: "INSUFFICIENT_RECENT_DATA" as const };
  }
  const observedMinutes = observedSnapshotMinutes(latest, snapshots, minutes);
  const coveragePercentage = Math.min(100, Math.round((observedMinutes / minutes) * 100));
  const isComplete = coveragePercentage >= 75;
  if (!isComplete) {
    return { requestedMinutes: minutes, observedMinutes, coveragePercentage, isComplete, dataStatus: "INSUFFICIENT_RECENT_DATA" as const };
  }
  const deltas = [
    diffPair(latest.homeShots, latest.awayShots, previous.homeShots, previous.awayShots),
    diffPair(latest.homeShotsOnTarget, latest.awayShotsOnTarget, previous.homeShotsOnTarget, previous.awayShotsOnTarget),
    diffPair(decimalNumber(latest.homeXg), decimalNumber(latest.awayXg), decimalNumber(previous.homeXg), decimalNumber(previous.awayXg)),
    diffPair(latest.homeCorners, latest.awayCorners, previous.homeCorners, previous.awayCorners),
    diffPair(latest.homeDangerousAttacks, latest.awayDangerousAttacks, previous.homeDangerousAttacks, previous.awayDangerousAttacks)
  ];
  const hasAnyKnownDelta = deltas.some((value) => value !== null);
  const hasProduction = deltas.some((value) => value !== null && value > 0);
  const dataStatus = hasAnyKnownDelta && !hasProduction ? "RECENT_DEAD" as const : "VALID_RECENT_DATA" as const;
  return { requestedMinutes: minutes, observedMinutes, coveragePercentage, isComplete, dataStatus };
}

function recentDataStatusFromCoverage(windows: Array<ReturnType<typeof snapshotCoverageWindow>>) {
  if (windows.some((window) => window.dataStatus === "VALID_RECENT_DATA")) return "VALID_RECENT_DATA" as const;
  if (windows.some((window) => window.dataStatus === "INSUFFICIENT_RECENT_DATA")) return "INSUFFICIENT_RECENT_DATA" as const;
  return "RECENT_DEAD" as const;
}

function lastSnapshotWithScoreChange<T extends { timestamp: Date; homeScore: number; awayScore: number }>(snapshots: T[]) {
  for (let index = 0; index < snapshots.length - 1; index += 1) {
    const current = snapshots[index];
    const previous = snapshots[index + 1];
    if (current.homeScore !== previous.homeScore || current.awayScore !== previous.awayScore) {
      return current;
    }
  }
  return null;
}

function ageSeconds(value: Date | null | undefined, now = new Date()) {
  if (!value) return null;
  return Math.max(0, Math.round((now.getTime() - value.getTime()) / 1000));
}

function diffPair(home: number | null, away: number | null, prevHome: number | null, prevAway: number | null) {
  if (home === null || away === null || prevHome === null || prevAway === null) return null;
  return Math.max(0, home + away - prevHome - prevAway);
}

function decimalNumber(value: Prisma.Decimal | null) {
  return value === null ? null : Number(value);
}

function parseKickoff(value?: string) {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function localDayRange(now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { start, end };
}

function staleProviderReason(kickoff: Date, minute: number | null, eventsCount: number) {
  return `Fixture marcado stale: kickoff ${kickoff.toISOString()}, minute ${minute ?? "N/D"}, events ${eventsCount}.`;
}

function decimalOrNull(value: number | null | undefined) {
  return value === null || value === undefined ? null : new Prisma.Decimal(value);
}

function extractLine(text: string) {
  const match = text.replace(",", ".").match(/(?:\b|\+)(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function hashObject(value: unknown) {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

function advisoryLockKey(parts: unknown[]) {
  const hash = createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 15);
  return BigInt(`0x${hash}`);
}

function slug(value: string | number | null | undefined) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "nd";
}
