import type { MatchDetail, MatchSummary, TeamStats } from "@/types/domain";

export type FootballProvider = {
  listMatches(): Promise<MatchSummary[]>;
  getMatch(matchId: string): Promise<MatchDetail | null>;
  getPreviousSnapshot(matchId: string): Promise<{ home: TeamStats; away: TeamStats } | null>;
};
