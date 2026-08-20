import type { OddsQuote } from "@/types/domain";

export type OddsProvider = {
  getCurrentOdds(matchId: string): Promise<OddsQuote[]>;
  getOddsHistory(matchId: string): Promise<OddsQuote[]>;
};
