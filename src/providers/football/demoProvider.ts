import { demoMatches, previousDemoSnapshots } from "@/data/demo";
import type { FootballProvider } from "./types";

export const demoFootballProvider: FootballProvider = {
  async listMatches() {
    return demoMatches.map(({ id, homeTeam, awayTeam, competition, status, minute, score, kickoffAt }) => ({
      id,
      homeTeam,
      awayTeam,
      competition,
      status,
      minute,
      score,
      kickoffAt
    }));
  },
  async getMatch(matchId) {
    return demoMatches.find((match) => match.id === matchId) ?? null;
  },
  async getPreviousSnapshot(matchId) {
    return previousDemoSnapshots[matchId as keyof typeof previousDemoSnapshots] ?? null;
  }
};
