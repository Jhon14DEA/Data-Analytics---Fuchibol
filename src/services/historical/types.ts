import type { HistoricalPeriod } from '@prisma/client';
import type { CompetitionMetadata, Provider } from './scope';
export const METRICS = ['goals','shots','shotsOnTarget','xg','corners','yellowCards','redCards','fouls','possession','dangerousAttacks'] as const;
export type Metrics = Record<typeof METRICS[number], number | null>;
export type Side = 'HOME' | 'AWAY';
export type PeriodStats = { period: HistoricalPeriod; home: Metrics; away: Metrics; source: string };
export type MarketSpec = { market: 'TOTAL_GOALS' | 'BTTS' | 'TEAM_GOALS' | 'CORNERS' | 'CARDS'; period: HistoricalPeriod; selection: 'OVER' | 'UNDER' | 'YES' | 'NO'; line: number | null; side: Side | 'BOTH'; rules: string; voided?: boolean };
export type HistoricalFixture = {
  kickoffPrecision?: 'DATE';
  historicalKickoffAt?: null;
  referee?: string | null;
  archiveOdds?: { bookmaker: string; market: 'MATCH_RESULT' | 'TOTAL_GOALS' | 'ASIAN_HANDICAP'; selection: string; line: number | null; price: number; phase: 'PRE_CLOSING' | 'CLOSING'; sourceColumn: string; quotedAt: null }[];
  id: string; competitionId: string; seasonKey: string; kickoff: string; status: 'FINISHED';
  home: { id: string; name: string }; away: { id: string; name: string };
  periods: PeriodStats[];
  events?: { id: string; side: Side | null; type: string; minute: number | null; playerName: string | null; detail: string | null }[];
  players?: { id: string; name: string; side: Side; starter?: boolean; position?: string; number?: number; stats?: { minutes?: number | null; goals?: number | null; assists?: number | null; shots?: number | null; shotsOnTarget?: number | null; xg?: number | null; yellowCards?: number | null; redCards?: number | null } }[];
  odds?: { bookmaker: string; market: string; selection: string; price: number; quotedAt: string; receivedAt: string }[];
  markets?: MarketSpec[];
};
export type HistoricalBatch = {
  synthetic?: boolean;
  provider: Provider; competition: CompetitionMetadata;
  season: { key: string; label: string; providerSeasonId?: string; startsAt?: string; endsAt?: string };
  rangeFrom: string; rangeTo: string; receivedAt: string; cursor: string | null; nextCursor: string | null;
  fixtures: HistoricalFixture[];
};
