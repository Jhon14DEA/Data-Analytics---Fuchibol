export type MatchStatus = "LIVE" | "UPCOMING" | "FINISHED";

export type TeamSide = "home" | "away";

export type MatchSummary = {
  id: string;
  source?: "allsports" | "api-football" | "demo";
  leagueExternalId?: string | number | null;
  homeTeamExternalId?: string | number | null;
  awayTeamExternalId?: string | number | null;
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

export type MatchSearchDiagnostics = {
  term: string;
  provider: string;
  searchedRanges: string[];
  apiResults: number;
  filteredOut: number;
  filterReasons: string[];
  cacheHits: number;
  cacheMisses: number;
  endpoints: string[];
};

export type MatchSearchResult = {
  matches: MatchSummary[];
  diagnostics: MatchSearchDiagnostics;
};

export type TeamStats = {
  bigChances?: number | null;
  shotsInsideBox?: number | null;
  possession: number | null;
  shots: number | null;
  shotsOffTarget?: number | null;
  shotsOnTarget: number | null;
  xg: number | null;
  corners: number | null;
  yellowCards: number | null;
  redCards: number | null;
  fouls: number | null;
  attacks?: number | null;
  dangerousAttacks?: number | null;
};

export type PlayerStat = {
  player: string;
  team: TeamSide;
  position: string;
  minutes?: number | null;
  goals?: number | null;
  assists?: number | null;
  shots: number | null;
  shotsOnTarget: number | null;
  xg: number | null;
  xa?: number | null;
  keyPasses: number | null;
  foulsCommitted: number | null;
  foulsReceived?: number | null;
  yellowCards?: number | null;
  redCards?: number | null;
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
  | "RESPALDO MUY FUERTE"
  | "RESPALDO FUERTE"
  | "INTERESANTE"
  | "VIGILAR"
  | "RIESGO ALTO"
  | "DESCARTAR";

export type BetDecisionState =
  | "APUESTA RECOMENDADA"
  | "VENTANA TEMPRANA DE VALOR"
  | "INTERESANTE"
  | "ESPERAR"
  | "DESCARTAR"
  | "SIN APUESTA";

export type MarketStatus = "OPEN" | "PENDING" | "WON" | "LOST" | "VOID" | "UNRESOLVED";
export type EntryState = "ENTER_NOW" | "WATCH_ENTRY" | "HOLD" | "WATCH" | "EXIT" | "NO_ENTRY";

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
  fingerprint?: string;
  type: string;
  severity: number;
  activityScore?: number;
  title: string;
  message: string;
  minute: number | null;
};

export type MatchAlertRuleType =
  | "GOAL"
  | "SHOTS_ON_TARGET"
  | "XG"
  | "CORNERS"
  | "CARDS"
  | "SUBSTITUTIONS"
  | "ODDS"
  | "RECOMMENDATION_CHANGE";

export type MatchAlertConfiguration = {
  matchId: string;
  enabled: boolean;
  rules: Record<MatchAlertRuleType, boolean>;
  updatedAt: string;
};

export type MatchDetail = MatchSummary & {
  trainingObservation?: import("@/services/training/observation").TrainingObservation;
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

export type LiveDataFreshness = {
  providerFetchedAt: string | null;
  lastScoreChangeAt: string | null;
  lastEventAt: string | null;
  statsUpdatedAt: string | null;
  oddsUpdatedAt: string | null;
  providerAgeSeconds: number | null;
  scoreAgeSeconds: number | null;
  eventAgeSeconds: number | null;
  statsAgeSeconds: number | null;
  oddsAgeSeconds: number | null;
  liveDataStale: boolean;
  staleReasons: string[];
};

export type DecisionBlocker = {
  rule: string;
  value: string | number | null;
  threshold: string | number;
  effect: string;
};

export type BetScoreTraceStep = {
  rule: string;
  before: number;
  delta: number;
  after: number;
  reason: string;
};

export type MarketDataQualityBreakdown = {
  score: number;
  sampleSize: number;
  missing: string[];
  components: Record<string, boolean>;
  historicalDataQuality?: number;
  liveExecutionQuality?: number | null;
  dataFreshness?: LiveDataFreshness | null;
};

export type AnalyzedMarket = {
  market: string;
  selection: string;
  marketPeriod?: "FULL_MATCH" | "FIRST_HALF";
  remainingMarketMinutes?: number | null;
  confidence: number;
  marketStatus?: MarketStatus;
  statisticalScore?: number;
  betScore?: number | null;
  probabilityNote?: string;
  probabilityModel?: string;
  sampleSize?: number;
  rawRate?: number | null;
  adjustedRate?: number | null;
  uncertainty?: number | null;
  liveProbability?: number | null;
  prematchWeight?: number | null;
  liveWeight?: number | null;
  concordanceScore?: number | null;
  evidenceCoverage?: number | null;
  liveAttackScore?: number | null;
  cumulativeAttackScore?: number | null;
  recentMomentumScore?: number | null;
  matchTrendScore?: number | null;
  matchTrendState?: LiveMomentumTrendState | null;
  trendDirection?: LiveMomentumTrendState | null;
  pressureStrength?: PressureStrength | null;
  goalPressureSignal?: GoalPressureSignal | null;
  entryState?: EntryState | null;
  entryStateDebug?: {
    probabilityDelta: number | null;
    pressureDelta: number | null;
    timeDelta: number | null;
    scoreDelta: number | null;
    criticalEventsSinceLastAnalysis: string[];
  };
  statisticalOutlook?: "FUERTE" | "INTERESANTE" | "DÉBIL";
  lambdaRemaining?: number | null;
  remainingGoalProbabilities?: Record<string, number> | null;
  rawEdge?: number | null;
  uncertaintyAdjustedEdge?: number | null;
  discardReason?: string | null;
  decisionBlockers?: DecisionBlocker[];
  betScoreTrace?: BetScoreTraceStep[];
  finalTimeDebug?: {
    minute: number | null;
    stoppageTime: number | null;
    remainingMinutes: number | null;
    goalsNeeded: number | null;
    confidenceBase?: number | null;
    confidenceBeforeCap: number | null;
    timeCap: number | null;
    confidenceAfterTimeCap?: number | null;
    confidenceAfterCap: number | null;
    confidenceFinal?: number | null;
    betScoreFinal?: number | null;
    estimatedProbabilityBase?: number | null;
    estimatedProbabilityFinal?: number | null;
    estimatedProbabilityBeforeCap: number | null;
    estimatedProbabilityAfterCap: number | null;
    confidenceRendered: number | null;
  };
  marketDataQuality?: MarketDataQualityBreakdown;
  oddsMovement?: {
    openingOdds: number | null;
    previousOdds: number | null;
    currentOdds: number | null;
    movementPercent: number | null;
    warning?: string;
  };
  classification: AnalysisClassification;
  decision?: BetDecisionState;
  bookmaker?: string | null;
  odd?: number | null;
  line?: number | null;
  impliedProbability?: number | null;
  estimatedProbability?: number | null;
  edge?: number | null;
  missingRequirements?: string[];
  dataQuality?: number;
  risk?: "bajo" | "medio" | "alto";
  improvements?: string[];
  supportingData: string[];
  risks: string[];
  invalidators: string[];
};

export type LiveTrendState = "MEJORO" | "IGUAL" | "EMPEORO" | "CAMBIO FUERTE" | "N/D";
export type LiveMomentumTrendState = "SUBIENDO" | "ESTABLE" | "CAYENDO";
export type GoalPressureSignal = "SIN SEÑAL" | "VIGILAR" | "FUERTE";
export type PressureStrength = "N/D" | "MUY_BAJA" | "BAJA" | "MEDIA" | "ALTA" | "MUY_ALTA";
export type TacticalState = "NEEDS_GOAL" | "ATTACKING" | "BALANCED" | "PROTECTING" | "CLOSING";
export type SubstitutionIntent = "OFFENSIVE" | "DEFENSIVE" | "LIKE_FOR_LIKE" | "UNKNOWN";

export type MatchAnalysisContext = {
  match: MatchDetail;
  recentHome: MatchDetail[];
  recentAway: MatchDetail[];
  h2h: MatchDetail[];
  liveSnapshotTrend?: LiveSnapshotTrend | null;
  liveMomentum?: LiveMomentumAnalysis | null;
  dataFreshness?: LiveDataFreshness | null;
  provider: string;
  generatedAt: string;
};

export type LiveSnapshotDelta = {
  minutes: 5 | 10 | 15;
  requestedMinutes: 5 | 10 | 15;
  observedMinutes: number | null;
  coveragePercentage: number;
  isComplete: boolean;
  dataState?: "VALID_DATA" | "OBSERVED_ZERO" | "INSUFFICIENT_DATA" | "INVALID_DATA";
  startSnapshotMinute?: number | null;
  endSnapshotMinute?: number | null;
  shots: number | null;
  shotsOffTarget?: number | null;
  shotsOnTarget: number | null;
  xg: number | null;
  corners: number | null;
  attacks?: number | null;
  dangerousAttacks: number | null;
  goals: number | null;
  cards: number | null;
  substitutions?: number | null;
};

export type TeamLiveSnapshotDelta = LiveSnapshotDelta & {
  home: LiveWindowTeamStats;
  away: LiveWindowTeamStats;
};

export type LiveSnapshotTrend = {
  available: boolean;
  five: LiveSnapshotDelta;
  ten: LiveSnapshotDelta;
  fifteen: LiveSnapshotDelta;
};

export type LiveWindowTeamStats = {
  shots: number | null;
  shotsOffTarget?: number | null;
  shotsOnTarget: number | null;
  xgDelta: number | null;
  corners: number | null;
  attacks?: number | null;
  dangerousAttacks: number | null;
  yellowCards: number | null;
  redCards: number | null;
  goals: number | null;
  substitutions: number | null;
  possessionAvg?: number | null;
};

export type LivePeriodLabel = "0-15" | "16-30" | "31-45+" | "46-60" | "61-75" | "76-90+";

export type LivePeriodStats = {
  period: LivePeriodLabel;
  home: LiveWindowTeamStats;
  away: LiveWindowTeamStats;
  available: boolean;
};

export type LiveAccumulatedStats = {
  totalShots: number | null;
  totalShotsOffTarget?: number | null;
  totalShotsOnTarget: number | null;
  totalXg: number | null;
  totalCorners: number | null;
  totalAttacks?: number | null;
  totalDangerousAttacks: number | null;
  totalCards: number | null;
  totalGoals: number;
};

export type SubstitutionMomentumImpact = {
  minute: number;
  team?: TeamSide;
  detail: string;
  substitutionIntent: SubstitutionIntent;
  before10: LiveWindowTeamStats;
  after5: LiveWindowTeamStats;
  after10: LiveWindowTeamStats;
  observedImpact: "POSITIVO" | "NEUTRO" | "NEGATIVO" | "INSUFFICIENT_DATA" | "N/D";
  impact: "POSITIVO" | "NEUTRO" | "NEGATIVO" | "INSUFFICIENT_DATA" | "N/D";
  note: string;
};

export type CriticalEventMomentumSplit = {
  minute: number;
  type: MatchEvent["type"];
  team?: TeamSide;
  title: string;
  before: LiveWindowTeamStats;
  after: LiveWindowTeamStats;
  trend: LiveMomentumTrendState | "N/D";
};

export type LiveMomentumAnalysis = {
  available: boolean;
  periods: LivePeriodStats[];
  accumulated: LiveAccumulatedStats;
  recent: {
    five: TeamLiveSnapshotDelta;
    ten: TeamLiveSnapshotDelta;
    fifteen: TeamLiveSnapshotDelta;
  };
  cumulativeAttackScore: number;
  recentMomentumScore: number;
  matchTrendScore: number;
  matchTrendState: LiveMomentumTrendState;
  trendDirection: LiveMomentumTrendState;
  pressureStrength: PressureStrength;
  strongerPressure: TeamSide | "balanced" | "N/D";
  goalPressureSignal: GoalPressureSignal;
  favoriteReactionSignal?: {
    team: TeamSide;
    label: "FAVORITO EN REACCIÓN";
    reasons: string[];
  } | null;
  tacticalState: Record<TeamSide, TacticalState>;
  substitutions: SubstitutionMomentumImpact[];
  criticalSplits: CriticalEventMomentumSplit[];
  notes: string[];
};

export type MatchAnalysisResult = MatchAnalysisContext & {
  markets: AnalyzedMarket[];
  allMarkets?: AnalyzedMarket[];
  currentRecommendation: CurrentRecommendation;
  opportunityScore: number;
  liveState: LiveTrendState;
  dataUpdatedAt: string;
  statusIndicator: "LIVE" | "UPCOMING" | "FINAL";
  analysisCacheKey: string;
  dataFreshness?: LiveDataFreshness | null;
  noOpportunityMessage?: string;
};

export type CurrentRecommendation = {
  message?: string;
  options: CurrentRecommendationOption[];
  dataFreshness?: LiveDataFreshness | null;
  mainReason?: string;
};

export type RecommendationDecision = "CONSIDERAR" | "ESPERAR" | "DESCARTAR";

export type RecommendationState = BetDecisionState;

export type CurrentRecommendationOption = {
  market: string;
  selection: string;
  bookmaker: string;
  odd: number;
  line?: number | null;
  impliedProbability?: number | null;
  estimatedProbability?: number | null;
  edge?: number | null;
  rawEdge?: number | null;
  uncertaintyAdjustedEdge?: number | null;
  betScore?: number | null;
  goalsNeeded?: number | null;
  eventNeeded?: number | null;
  dataFreshness?: LiveDataFreshness | null;
  decisionBlockers?: DecisionBlocker[];
  entryState?: EntryState | null;
  action?: string;
  confidence: number;
  state: RecommendationState;
  reasons: string[];
  risks: string[];
  decision: RecommendationDecision;
};

export type DeepDataQuality = {
  score: number;
  missing: string[];
  components: {
    historical: boolean;
    liveStats: boolean;
    lineups: boolean;
    players: boolean;
    referee: boolean;
    odds: boolean;
  };
};

export type DeepMetricSummary = {
  matches: number;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  goalsForAvg: number | null;
  goalsAgainstAvg: number | null;
  shotsAvg: number | null;
  shotsOnTargetAvg: number | null;
  xgAvg: number | null;
  cornersAvg: number | null;
  cardsAvg: number | null;
  bttsRate: number | null;
  over15Rate: number | null;
  over25Rate: number | null;
  cleanSheetRate: number | null;
};

export type DeepSuggestion = {
  market: string;
  selection: string;
  bookmaker: string;
  odd: number | null;
  confidence: number;
  dataQuality: number;
  evidenceScore: number;
  goalsNeeded?: number;
  timeRemaining?: string;
  finalTimeDebug?: AnalyzedMarket["finalTimeDebug"];
  state: RecommendationState;
  supportingData: string[];
  risks: string[];
  invalidators: string[];
};

export type DeepMatchAnalysis = {
  fixtureId: string;
  provider: string;
  capabilities?: Record<string, boolean>;
  generatedAt: string;
  apiRequestsUsed: number;
  cache: {
    hits: number;
    misses: number;
    processes: string[];
  };
  match: MatchDetail;
  dataQuality: DeepDataQuality;
  importance: {
    summary: string;
    homeIncentives: string[];
    awayIncentives: string[];
    unavailable: string[];
  };
  h2h: {
    last5: DeepMetricSummary;
    last10: DeepMetricSummary;
    notes: string[];
  };
  form: {
    homeLast5: DeepMetricSummary;
    homeLast10: DeepMetricSummary;
    awayLast5: DeepMetricSummary;
    awayLast10: DeepMetricSummary;
  };
  coaches: {
    home: string[];
    away: string[];
    unavailable: string[];
  };
  lineups: {
    classification: "NORMAL" | "CAMBIO MENOR" | "IMPORTANTE" | "CAMBIA" | "N/D";
    summary: string;
    expectedVsConfirmed: string;
    unavailable: string[];
  };
  players: {
    items: PlayerStat[];
    unavailable: string[];
  };
  playerMarkets: DeepSuggestion[];
  referee: {
    summary: string;
    unavailable: string[];
  };
  live: {
    summary: string;
    unavailable: string[];
  };
  liveMomentum?: LiveMomentumAnalysis | null;
  substitutions: {
    minute: number;
    team?: TeamSide;
    detail: string;
    impact: string;
  }[];
  odds: {
    bookmaker: string;
    market: string;
    selection: string;
    currentOdd: number;
    previousOdd: number | null;
    variation: number | null;
    explanation: string;
  }[];
  suggestions: DeepSuggestion[];
  noBetMessage?: "NO HAY UNA APUESTA CON RESPALDO SUFICIENTE EN ESTE MOMENTO";
};
