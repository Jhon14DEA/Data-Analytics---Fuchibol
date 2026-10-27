# HIGH_GOAL_PRESSURE: detector informativo

Fecha: 2026-10-16. No es un predictor calibrado ni una recomendación de apuesta.

## Arquitectura y archivos

- `src/services/analysis/highGoalPressure.ts`: función pura `detectHighGoalPressure(context, historicalContext)`. Solo imports de tipos, sin DB, HTTP, timers ni dependencias del presupuesto.
- `src/app/api/debug/live-goal-radar/route.ts`: añade `goalPressure` después de evaluar los candidatos actuales. Reutiliza el mismo contexto histórico ya consultado, sin repetir consultas ni modificar candidatos.
- `src/components/GoalPressureSection.tsx`: sección PRESIÓN DE GOL; muestra nivel, evidencia, bloqueadores, cobertura, soporte histórico y mercados a revisar.
- `src/components/LiveGoalRadarMonitor.tsx`: inserta la sección usando la respuesta y el refresco existentes. Respeta filtro de competición; deliberadamente no limita esta sección a candidatos híbridos o al 0-0. No genera notificaciones ni alertas nuevas.
- `tests/high-goal-pressure.test.cjs`: 13 pruebas nuevas.

Sin schema ni migraciones. Los thresholds del motor existente no se modifican.

## Política informativa versión inicial

Todos los pares requieren valores conocidos de ambos equipos. Missing, NaN, negativos y datos ausentes permanecen NULL. Un cero explícito se conserva.

Señales acumuladas: SOT >=6, tiros >=12, xG >=1.2, grandes ocasiones >=2, tiros en área >=8, corners >=4, ataques peligrosos >=30. Las dos últimas aportan razones, no habilitan HIGH por sí mismas.

Volumen fuerte: SOT >=6 más al menos una de xG >=1.2, grandes ocasiones >=2 o tiros en área >=8. Ni el nombre del equipo ni la cantidad de goles habilitan HIGH.

Ventanas 5/10/15: se utiliza la más corta con isComplete, cobertura >=75%, estado VALID_DATA/OBSERVED_ZERO y tiros/SOT conocidos. Nunca se suman ventanas solapadas. Presión reciente alta requiere respectivamente SOT >=2/3/4 y tiros >=3/5/7 o xG >=0.3/0.5/0.7. Cero SOT y <=1 tiro observado bloquean HIGH y producen LOW.

HIGH: volumen fuerte y presión reciente alta. Hasta minuto 35 puede ser HIGH provisional por acumulados fuertes sin ventana disponible, con RECENT_ACTIVITY_MISSING y confianza reducida. Después de 35 exige evidencia reciente. Alternativamente, presión reciente alta más perdedor con >=2 SOT en ventana de cinco o >=3 en otras, y >=3 tiros. El marcador identifica al perdedor, pero no presupone motivación o necesidad táctica.

MEDIUM: sin inactividad reciente confirmada y SOT acumulado >=4 o presión reciente alta, sin alcanzar HIGH. LOW: datos suficientes sin esas condiciones. INSUFFICIENT_DATA: faltan minuto/marcador/SOT y dos métricas adicionales de tiros/xG/ocasiones/área, el partido no es LIVE real, hay datos explícitamente obsoletos o advertencias de integridad del momentum.

MATCH_EXPLOSION: HIGH, >=2 goles, minuto <=35 y actividad reciente alta; un VAR/penal registrado en los últimos tres minutos impide este estado hasta revisión. Muchos goles sin presión nunca bastan.

Roja conocida genera RED_CARD_DISTORTION y resta confianza; nunca cuenta como evidencia positiva de gol. VAR/penal reciente genera RECENT_VAR_OR_PENALTY_VERIFY: no se interpreta automáticamente como pendiente, resuelto o gol. Tendencia existente se expone sin recalcularla.

## Histórico

Reutiliza Historical Feature Builder mediante el contexto con mapping confiable. Expone perfiles HOME/AWAY 5/10/20 y todas sus features, cobertura y fechas: scored/conceded, promedios goles, O0.5/O1.5 1H, O0.5/O1.5/O2.5 FT, BTTS, tiros/SOT/corners y rachas.

BOTH_STRONG requiere, para cada equipo, al menos dos ventanas completas con scoredRate >=0.7, avgGoalsFor >=1.4 y avgSOT >=4. Último partido debe ser anterior al kickoff y no más antiguo de 180 días. Los perfiles antiguos se exponen con aviso, pero no refuerzan la confianza. Features restantes producen señales descriptivas de entorno de goles, concesión, volumen y rachas; no sustituyen LIVE.

Sin mapping/contexto: historicalStrength=NULL, HISTORICAL_CONTEXT_MISSING; HIGH sigue siendo posible con LIVE suficiente. El histórico nunca eleva por sí solo el nivel de presión.

Cobertura: porcentaje de ocho métricas combinadas conocidas. Confianza de evidencia: 60% de cobertura +20 por presión reciente alta (o +10 por ventana válida) +15 por BOTH_STRONG, -15 por roja, -15 por evento VAR/penal reciente; limitada a 0–100. INSUFFICIENT_DATA devuelve confidence=NULL. No representa probabilidad de gol ni valor de una cuota.

## UI y mercados

HIGH: REVISAR URGENTE — ALTA PRESIÓN DE GOL. MATCH_EXPLOSION: REVISAR URGENTE — PARTIDO ABIERTO. Una tarjeta por fixture, incluso con candidatos vacíos por marcador distinto de 0-0.

Solo HIGH/MEDIUM enumeran mercados para inspección. Antes del minuto 40, líneas 0.5/1.5 1T todavía no cumplidas se etiquetan expresamente «confirmar periodo»: el reloj no confirma 1H. Antes del 85 se muestran líneas FT 0.5–4.5 por encima del marcador, con máximo dos goles adicionales cuando se eleva a 3.5/4.5, y siguiente gol. No se verifica disponibilidad ni cuota, ni se recomienda ENTRAR.

## Validación

63/63 pruebas: 13 nuevas del detector/UI más radar-review-now, radar-hybrid-review, live-context y live-context-ui. Casos A/B y restantes pedidos, ausencia de mapping, rojo/VAR, missing, histórico obsoleto, LIVE obsoleto, idempotencia, no mutación y comparación completa de mercados del motor y candidatos antes/después. Tests ejecutados con guardia no-provider-http.

Ejemplos son simulaciones de tests, no capturas reales:

| Caso | Resultado |
|---|---|
| 0-0, 25', 9 SOT, xG 1.95, grandes ocasiones 3, área 11 | HIGH; sin ventana, confianza reducida |
| 0-0, 4 SOT, ventana reciente 0 SOT/1 tiro | LOW |
| 3-1, 30', calidad alta y ventana activa | MATCH_EXPLOSION |
| 3-1 con baja producción reciente | No HIGH |
| 1-0, 60', visitante perdedor presiona | HIGH, sin explosión temprana |
| Histórico fuerte con ventana LIVE inactiva | LOW |

Build: `npx next build` OK, exit 0 (compilación, tipos y páginas). Evidencias en `reports/high-pressure-tests.log` y `reports/high-pressure-build.log`.

No se ejecutaron HTTP reales para probar el detector ni se consumió presupuesto híbrido. BET_SCORE, ENTRY/NO_ENTRY, ALERT, thresholds actuales y budgets permanecen separados del detector. No hay scoring histórico de apuestas, ML ni backtesting.
