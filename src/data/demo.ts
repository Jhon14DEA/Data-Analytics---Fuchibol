import type { MatchDetail } from "@/types/domain";

const now = new Date("2026-08-18T20:00:00-05:00").toISOString();

export const demoMatches: MatchDetail[] = [
  {
    id: "demo-fenerbahce-lyon",
    demo: true,
    homeTeam: "Fenerbahce",
    awayTeam: "Lyon",
    competition: "Europa League - DEMO",
    status: "LIVE",
    minute: 64,
    score: { home: 1, away: 1 },
    stats: {
      home: {
        possession: 57,
        shots: 14,
        shotsOnTarget: 6,
        xg: 1.68,
        corners: 7,
        yellowCards: 2,
        redCards: 0,
        fouls: 10,
        dangerousAttacks: 48
      },
      away: {
        possession: 43,
        shots: 7,
        shotsOnTarget: 3,
        xg: 0.92,
        corners: 2,
        yellowCards: 3,
        redCards: 0,
        fouls: 14,
        dangerousAttacks: 25
      }
    },
    lineups: {
      home: [
        { number: 40, name: "Livakovic", position: "GK" },
        { number: 21, name: "Osayi-Samuel", position: "RB" },
        { number: 6, name: "Djiku", position: "CB" },
        { number: 53, name: "Szymanski", position: "AM" },
        { number: 9, name: "Dzeko", position: "ST" }
      ],
      away: [
        { number: 1, name: "Lopes", position: "GK" },
        { number: 22, name: "Mata", position: "RB" },
        { number: 8, name: "Tolisso", position: "CM" },
        { number: 18, name: "Cherki", position: "RW" },
        { number: 10, name: "Lacazette", position: "ST" }
      ]
    },
    substitutions: [
      {
        minute: 58,
        type: "substitution",
        team: "home",
        title: "Cambio ofensivo",
        detail: "Entra Batshuayi para atacar el area."
      }
    ],
    events: [
      { minute: 18, type: "goal", team: "away", title: "Gol Lyon", detail: "Lacazette define tras pase filtrado." },
      { minute: 37, type: "card", team: "away", title: "Amarilla", detail: "Tolisso corta una transicion." },
      { minute: 51, type: "goal", team: "home", title: "Gol Fenerbahce", detail: "Dzeko iguala de cabeza." },
      { minute: 62, type: "var", title: "Revision VAR", detail: "Posible penal revisado, sin sancion." }
    ],
    playerStats: [
      { player: "Dzeko", team: "home", position: "ST", shots: 5, shotsOnTarget: 3, xg: 0.78, keyPasses: 1, foulsCommitted: 1 },
      { player: "Szymanski", team: "home", position: "AM", shots: 3, shotsOnTarget: 1, xg: 0.31, keyPasses: 4, foulsCommitted: 0 },
      { player: "Lacazette", team: "away", position: "ST", shots: 3, shotsOnTarget: 2, xg: 0.62, keyPasses: 1, foulsCommitted: 2 }
    ],
    odds: [
      { bookmaker: "Betano", market: "Total goles", selection: "Mas de 2.5", price: 1.95, quotedAt: now, minute: 64 },
      { bookmaker: "MiCasino", market: "Corners", selection: "Fenerbahce mas de 7.5", price: 1.82, quotedAt: now, minute: 64 },
      { bookmaker: "API legal DEMO", market: "Resultado", selection: "Fenerbahce gana", price: 2.35, quotedAt: now, minute: 64 }
    ],
    oddsHistory: [
      { bookmaker: "Betano", market: "Total goles", selection: "Mas de 2.5", price: 2.18, quotedAt: "2026-08-18T19:20:00-05:00", minute: 40 },
      { bookmaker: "Betano", market: "Total goles", selection: "Mas de 2.5", price: 2.05, quotedAt: "2026-08-18T19:42:00-05:00", minute: 52 },
      { bookmaker: "Betano", market: "Total goles", selection: "Mas de 2.5", price: 1.95, quotedAt: now, minute: 64 }
    ],
    analysis: [
      {
        market: "Corners",
        selection: "Fenerbahce mas de 7.5",
        availableOdd: 1.82,
        confidence: 8,
        classification: "RESPALDO FUERTE",
        reasons: ["Volumen alto de ataques por banda", "7 corners al minuto 64", "Lyon defiende bajo desde el empate"],
        risks: ["Ritmo puede caer si hay otro gol local", "Cambios defensivos pueden reducir centros"],
        invalidators: ["Roja local", "Lesion de extremo derecho", "Cuota cae por debajo de 1.55"]
      },
      {
        market: "Total goles",
        selection: "Mas de 2.5",
        availableOdd: 1.95,
        confidence: 6,
        classification: "VIGILAR",
        reasons: ["xG combinado 2.60", "Ambos equipos llegaron al arco", "Partido abierto tras el 1-1"],
        risks: ["Lyon esta acumulando faltas y puede cortar ritmo", "Fenerbahce puede priorizar control"],
        invalidators: ["Cinco minutos sin remates", "Sustitucion de Dzeko", "Cuota menor a 1.70"]
      }
    ],
    alerts: [
      { type: "XG_SPIKE", severity: 8, title: "Incremento de xG", message: "Fenerbahce genero +0.42 xG en los ultimos 8 minutos.", minute: 64 },
      { type: "ODDS_MOVEMENT", severity: 7, title: "Movimiento fuerte de cuota", message: "Over 2.5 bajo de 2.18 a 1.95.", minute: 64 }
    ]
  },
  {
    id: "demo-dinamo-viking",
    demo: true,
    homeTeam: "Dinamo Zagreb",
    awayTeam: "Viking",
    competition: "Conference League - DEMO",
    status: "UPCOMING",
    minute: null,
    score: { home: 0, away: 0 },
    kickoffAt: "2026-08-18T22:00:00-05:00",
    stats: {
      home: { possession: 0, shots: 0, shotsOnTarget: 0, xg: 0, corners: 0, yellowCards: 0, redCards: 0, fouls: 0 },
      away: { possession: 0, shots: 0, shotsOnTarget: 0, xg: 0, corners: 0, yellowCards: 0, redCards: 0, fouls: 0 }
    },
    lineups: { home: [], away: [] },
    substitutions: [],
    events: [{ minute: 0, type: "note", title: "Prepartido DEMO", detail: "Alineaciones pendientes de confirmacion." }],
    playerStats: [],
    odds: [
      { bookmaker: "Betano", market: "Resultado", selection: "Dinamo Zagreb gana", price: 1.74, quotedAt: now, minute: null },
      { bookmaker: "MiCasino", market: "Total goles", selection: "Mas de 2.5", price: 1.88, quotedAt: now, minute: null }
    ],
    oddsHistory: [
      { bookmaker: "MiCasino", market: "Total goles", selection: "Mas de 2.5", price: 1.95, quotedAt: "2026-08-18T10:00:00-05:00", minute: null },
      { bookmaker: "MiCasino", market: "Total goles", selection: "Mas de 2.5", price: 1.88, quotedAt: now, minute: null }
    ],
    analysis: [
      {
        market: "Resultado",
        selection: "Dinamo Zagreb gana",
        availableOdd: 1.74,
        confidence: 7,
        classification: "VIGILAR",
        reasons: ["Buen rendimiento local reciente", "Viking baja mucho fuera de casa", "Plantilla local mas profunda"],
        risks: ["Alineaciones no confirmadas", "Mercado ya ajustado"],
        invalidators: ["Rotacion masiva de Dinamo", "Cuota inferior a 1.55", "Baja del delantero titular"]
      }
    ],
    alerts: []
  },
  {
    id: "demo-levski-aek",
    demo: true,
    homeTeam: "Levski Sofia",
    awayTeam: "AEK",
    competition: "Europa Conference - DEMO",
    status: "FINISHED",
    minute: 90,
    score: { home: 0, away: 2 },
    stats: {
      home: { possession: 46, shots: 9, shotsOnTarget: 2, xg: 0.74, corners: 4, yellowCards: 4, redCards: 1, fouls: 18, dangerousAttacks: 31 },
      away: { possession: 54, shots: 12, shotsOnTarget: 5, xg: 1.91, corners: 6, yellowCards: 2, redCards: 0, fouls: 12, dangerousAttacks: 43 }
    },
    lineups: {
      home: [{ number: 1, name: "Andreev", position: "GK" }, { number: 9, name: "Kolev", position: "ST" }],
      away: [{ number: 30, name: "Athanasiadis", position: "GK" }, { number: 10, name: "Zuber", position: "AM" }]
    },
    substitutions: [
      { minute: 72, type: "substitution", team: "away", title: "Refuerzo medio", detail: "AEK protege la ventaja." }
    ],
    events: [
      { minute: 33, type: "goal", team: "away", title: "Gol AEK", detail: "Remate desde el punto penal." },
      { minute: 55, type: "card", team: "home", title: "Roja Levski", detail: "Segunda amarilla por falta tactica." },
      { minute: 78, type: "goal", team: "away", title: "Gol AEK", detail: "Contraataque tras perdida local." }
    ],
    playerStats: [
      { player: "Zuber", team: "away", position: "AM", shots: 4, shotsOnTarget: 2, xg: 0.71, keyPasses: 3, foulsCommitted: 1 }
    ],
    odds: [
      { bookmaker: "API legal DEMO", market: "Resultado final", selection: "AEK gana", price: 1.01, quotedAt: now, minute: 90 }
    ],
    oddsHistory: [
      { bookmaker: "API legal DEMO", market: "Resultado", selection: "AEK gana", price: 2.1, quotedAt: "2026-08-18T13:00:00-05:00", minute: null },
      { bookmaker: "API legal DEMO", market: "Resultado", selection: "AEK gana", price: 1.42, quotedAt: "2026-08-18T15:10:00-05:00", minute: 55 },
      { bookmaker: "API legal DEMO", market: "Resultado final", selection: "AEK gana", price: 1.01, quotedAt: now, minute: 90 }
    ],
    analysis: [
      {
        market: "Cualquier mercado",
        selection: "Sin entrada",
        availableOdd: null,
        confidence: 2,
        classification: "DESCARTAR",
        reasons: ["Partido finalizado", "Mercados cerrados o sin valor operativo"],
        risks: ["No aplica"],
        invalidators: ["No aplica"]
      }
    ],
    alerts: [
      { type: "RED_CARD", severity: 9, title: "Roja determinante", message: "Levski quedo con 10 y perdio control territorial.", minute: 55 }
    ]
  }
];

export const previousDemoSnapshots = {
  "demo-fenerbahce-lyon": {
    home: {
      possession: 53,
      shots: 10,
      shotsOnTarget: 4,
      xg: 1.26,
      corners: 5,
      yellowCards: 2,
      redCards: 0,
      fouls: 8,
      dangerousAttacks: 35
    },
    away: {
      possession: 47,
      shots: 7,
      shotsOnTarget: 3,
      xg: 0.89,
      corners: 2,
      yellowCards: 2,
      redCards: 0,
      fouls: 11,
      dangerousAttacks: 24
    }
  }
} as const;
