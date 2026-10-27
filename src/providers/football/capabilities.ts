export type FootballDataCapability =
  | "LIVE_SCORE"
  | "LIVE_STATS"
  | "H2H"
  | "TEAM_FORM"
  | "LINEUPS"
  | "PLAYERS"
  | "ODDS";

export type FootballDataProviderCapabilities = {
  provider: string;
  capabilities: Record<FootballDataCapability, boolean>;
};

export const allSportsApiCapabilities: FootballDataProviderCapabilities = {
  provider: "AllSportsApi",
  capabilities: {
    LIVE_SCORE: true,
    LIVE_STATS: true,
    H2H: true,
    TEAM_FORM: true,
    LINEUPS: true,
    PLAYERS: true,
    ODDS: true
  }
};

export const footballDataProviderPlaceholder: FootballDataProviderCapabilities = {
  provider: "FootballDataProvider",
  capabilities: {
    LIVE_SCORE: false,
    LIVE_STATS: false,
    H2H: false,
    TEAM_FORM: false,
    LINEUPS: false,
    PLAYERS: false,
    ODDS: false
  }
};
