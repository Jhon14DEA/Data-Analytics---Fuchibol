import { createHash } from 'node:crypto';
import type { TrainingObservation } from './observation';
import { timestampIssue } from './oddsIntegrity';

// Explicit allowlist: a new schema column cannot silently become a feature.
export const SNAPSHOT_FIELDS = {
  FEATURE_POINT_IN_TIME: [
    'minute', 'stoppageTime', 'elapsedStoppageTime', 'marketType', 'marketPeriod',
    'homeScore', 'awayScore', 'goalsNeeded', 'minutesRemainingMarket',
    'homeShots', 'awayShots', 'totalShots', 'homeSot', 'awaySot', 'totalSot',
    'homeXg', 'awayXg', 'totalXg', 'homeBigChances', 'awayBigChances', 'totalBigChances',
    'homeShotsInsideBox', 'awayShotsInsideBox', 'totalShotsInsideBox',
    'homeCorners', 'awayCorners', 'totalCorners', 'homeDangerousAttacks', 'awayDangerousAttacks', 'totalDangerousAttacks',
    'sotLast5', 'sotLast10', 'sotLast15', 'xgLast5', 'xgLast10', 'xgLast15',
    'bigChancesLast5', 'bigChancesLast10', 'bigChancesLast15', 'cornersLast5', 'cornersLast10', 'cornersLast15',
    'homeRedCards', 'awayRedCards', 'homeOver05FirstHalfRate', 'awayOver05FirstHalfRate',
    'homeAvgGoalsFirstHalf', 'awayAvgGoalsFirstHalf', 'homeZeroZeroHtRate', 'awayZeroZeroHtRate', 'marketOdds'
  ],
  LABEL_FUTURE: ['goalBeforeHt', 'goalBeforeFt', 'finalHomeScore', 'finalAwayScore', 'htResolvedAt', 'ftResolvedAt', 'resultResolvedAt'],
  METADATA: ['id', 'matchId', 'providerFixtureId', 'liveSnapshotId', 'capturedAt', 'sourceHash', 'match', 'liveSnapshot'],
  QUALITY_PROVENANCE: ['periodProvider', 'statsProvider', 'oddsProvider', 'oddsBookmaker', 'oddsQuotedAt', 'dataQuality', 'coveragePercent', 'dataQualityDetails']
} as const;
type Row = Record<string, unknown>;
const milliseconds = (v: unknown) => v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN;
const projection = (row: Row) => Object.fromEntries(SNAPSHOT_FIELDS.FEATURE_POINT_IN_TIME.map(k => [k, row[k]]));
const provenance = (row: Row) => Object.fromEntries(['matchId', 'providerFixtureId', 'periodProvider', 'statsProvider', 'oddsProvider', 'oddsBookmaker', 'oddsQuotedAt'].map(k => [k, row[k]]));
function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)).digest('hex');
}

export function observationTimeIssue(o: TrainingObservation): string | null {
  const at = Date.parse(o.observedAt);
  const clocks = [o.receipts?.fixture ?? o.observedAt, o.receipts?.stats ?? o.observedAt,
    o.hybridEvidence?.observedAt ?? o.receipts?.fixture ?? o.observedAt];
  return !Number.isFinite(at) || clocks.some(t => !Number.isFinite(Date.parse(t))) ? 'INVALID_TIMESTAMP'
    : clocks.some(t => Date.parse(t) > at) ? 'EVIDENCE_AFTER_CAPTURE' : null;
}

export function availableOdds(o: TrainingObservation) {
  const q = o.odds;
  if (!q?.receivedAt || timestampIssue(q.quotedAt, q.receivedAt, o.observedAt)
    || Date.parse(o.observedAt) - Date.parse(q.quotedAt) > 180_000 || !Number.isFinite(q.price) || q.price <= 1) return null;
  return q;
}

export function sealPointInTime(row: Row, o: TrainingObservation) {
  const evidence = { version: 1, capturedAt: o.observedAt, fixtureReceivedAt: o.receipts?.fixture ?? o.observedAt,
    statsReceivedAt: o.receipts ? o.receipts.stats : o.observedAt,
    periodAvailableAt: o.hybridEvidence?.observedAt ?? o.receipts?.fixture ?? o.observedAt,
    oddsReceivedAt: o.odds?.receivedAt ?? null, oddsProviderTimestamp: o.odds?.quotedAt ?? null };
  return { ...evidence, featureHash: digest({ features: projection(row), provenance: provenance(row), evidence }) };
}

// Fail closed for legacy/unverifiable rows. Labels and joined mutable Fixture data never enter this projection.
export function pointInTimeIssue(row: Row): string | null {
  const quality = row.dataQualityDetails as { pointInTime?: ReturnType<typeof sealPointInTime> } | null;
  const proof = quality?.pointInTime;
  if (!proof || proof.version !== 1) return 'UNVERIFIED_LEGACY_SNAPSHOT';
  const { featureHash, ...evidence } = proof;
  const at = milliseconds(row.capturedAt);
  if (!Number.isFinite(at) || at !== milliseconds(proof.capturedAt)) return 'CAPTURE_TIME_CHANGED';
  if ([proof.fixtureReceivedAt, proof.periodAvailableAt, ...(proof.statsReceivedAt ? [proof.statsReceivedAt] : [])]
    .some(t => !Number.isFinite(milliseconds(t)) || milliseconds(t) > at)) return 'EVIDENCE_AFTER_CAPTURE';
  if (row.marketOdds !== null && (!proof.oddsReceivedAt || !proof.oddsProviderTimestamp
    || timestampIssue(proof.oddsProviderTimestamp, proof.oddsReceivedAt, proof.capturedAt)
    || milliseconds(row.oddsQuotedAt) !== milliseconds(proof.oddsProviderTimestamp))) return 'UNSAFE_ODDS';
  if (SNAPSHOT_FIELDS.FEATURE_POINT_IN_TIME.some(k => row[k] === undefined)) return 'MISSING_FEATURE_COLUMN';
  if (digest({ features: projection(row), provenance: provenance(row), evidence }) !== featureHash) return 'FEATURE_PAYLOAD_CHANGED';
  return null;
}

export function pointInTimeFeatures(row: Row): Readonly<Row> | null {
  return pointInTimeIssue(row) ? null : Object.freeze(projection(row));
}
