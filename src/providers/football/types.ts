import type { MatchDetail, MatchSummary, TeamStats } from "@/types/domain";

export type FootballProvider = {
  listMatches(): Promise<MatchSummary[]>;
  searchMatches?(query: string, date?: string): Promise<MatchSummary[]>;
  getMatch(matchId: string): Promise<MatchDetail | null>;
  getPreviousSnapshot(matchId: string): Promise<{ home: TeamStats; away: TeamStats } | null>;
  invalidateMatchCache?(matchId: string): unknown;
  invalidateListCache?(): unknown;
};
