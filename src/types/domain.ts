export type MatchStatus = "LIVE" | "UPCOMING" | "FINISHED";

export type TeamSide = "home" | "away";

export type MatchSummary = {
  id: string;
  source?: "allsports" | "api-football" | "demo";
  homeTeam: string;
  awayTeam: string;
  competition: string;
  status: MatchStatus;
  minute: number | null;
  score: {
    home: number;
    away: number;
  };
  kickoffAt?: string;
};

export type ProviderState = "REAL" | "ERROR" | "DEMO";

export type FootballDebugStatus = {
  configured: boolean;
  provider: "AllSportsApi" | "API-Football" | "DEMO";
  statusCode: number | null;
  message: string;
  remainingRequests: number | null;
  usedRequests?: number | null;
};

export type TeamStats = {
  possession: number | null;
  shots: number | null;
  shotsOnTarget: number | null;
  xg: number | null;
  corners: number | null;
  yellowCards: number | null;
  redCards: number | null;
  fouls: number | null;
  dangerousAttacks?: number | null;
};

export type PlayerStat = {
  player: string;
  team: TeamSide;
  position: string;
  shots: number | null;
  shotsOnTarget: number | null;
  xg: number | null;
  keyPasses: number | null;
  foulsCommitted: number | null;
};

export type LineupPlayer = {
  name: string;
  number: number;
  position: string;
};

export type MatchEvent = {
  minute: number;
  type: "goal" | "card" | "substitution" | "var" | "injury" | "penalty" | "note";
  team?: TeamSide;
  title: string;
  detail: string;
};

export type OddsQuote = {
  bookmaker: string;
  market: string;
  selection: string;
  price: number;
  quotedAt: string;
  minute: number | null;
};

export type AnalysisClassification =
  | "RESPALDO FUERTE"
  | "INTERESANTE"
  | "VIGILAR"
  | "RIESGO ALTO"
  | "DESCARTAR";

export type AnalysisPick = {
  market: string;
  selection: string;
  availableOdd: number | null;
  confidence: number;
  classification: AnalysisClassification;
  reasons: string[];
  risks: string[];
  invalidators: string[];
};

export type MatchAlert = {
  type: string;
  severity: number;
  activityScore?: number;
  title: string;
  message: string;
  minute: number | null;
};

export type MatchDetail = MatchSummary & {
  demo: boolean;
  providerStatus?: string;
  stats: {
    home: TeamStats;
    away: TeamStats;
  };
  lineups: {
    home: LineupPlayer[];
    away: LineupPlayer[];
  };
  substitutions: MatchEvent[];
  events: MatchEvent[];
  playerStats: PlayerStat[];
  odds: OddsQuote[];
  oddsHistory: OddsQuote[];
  analysis: AnalysisPick[];
  alerts: MatchAlert[];
};

export type AnalyzedMarket = {
  market: string;
  selection: string;
  confidence: number;
  classification: Exclude<AnalysisClassification, "VIGILAR">;
  supportingData: string[];
  risks: string[];
  invalidators: string[];
};

export type LiveTrendState = "MEJORO" | "IGUAL" | "EMPEORO" | "CAMBIO FUERTE" | "N/D";

export type MatchAnalysisContext = {
  match: MatchDetail;
  recentHome: MatchDetail[];
  recentAway: MatchDetail[];
  h2h: MatchDetail[];
  provider: string;
  generatedAt: string;
};

export type MatchAnalysisResult = MatchAnalysisContext & {
  markets: AnalyzedMarket[];
  currentRecommendation: CurrentRecommendation;
  opportunityScore: number;
  liveState: LiveTrendState;
  noOpportunityMessage?: string;
};

export type CurrentRecommendation = {
  message?: "NO HAY UNA APUESTA CON RESPALDO SUFICIENTE AHORA";
  options: CurrentRecommendationOption[];
};

export type RecommendationDecision = "CONSIDERAR" | "ESPERAR" | "DESCARTAR";

export type RecommendationState = "RESPALDO FUERTE" | "INTERESANTE" | "VIGILAR" | "DESCARTAR";

export type CurrentRecommendationOption = {
  market: string;
  selection: string;
  bookmaker: string;
  odd: number;
  confidence: number;
  state: RecommendationState;
  reasons: string[];
  risks: string[];
  decision: RecommendationDecision;
};
