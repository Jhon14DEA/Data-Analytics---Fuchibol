import { demoMatches } from "@/data/demo";
import type { OddsProvider } from "./types";

export const demoOddsProvider: OddsProvider = {
  async getCurrentOdds(matchId) {
    return demoMatches.find((match) => match.id === matchId)?.odds ?? [];
  },
  async getOddsHistory(matchId) {
    return demoMatches.find((match) => match.id === matchId)?.oddsHistory ?? [];
  }
};
