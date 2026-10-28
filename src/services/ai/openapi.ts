const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const text = { type: 'string' };
const number = { type: 'number', nullable: true };
const object = { type: 'object', additionalProperties: true };
const nullableObject = { ...object, nullable: true };
const score = { type: 'object', required: ['home','away'], properties: { home: number, away: number } };
const fixture = { type: 'object', properties: { provider: text, providerFixtureId: text, status: text,
  homeTeam: text, awayTeam: text, competition: text, kickoff: { type: 'string', format: 'date-time' } } };
const recent = { type: 'object', description: 'Observed 5/10/15 minute deltas. Missing exact boundaries or coverage yields null.',
  properties: { five: nullableObject, ten: nullableObject, fifteen: nullableObject } };
const metrics = Object.fromEntries(['shots','shotsOffTarget','shotsOnTarget','xg','bigChances','shotsInsideBox','corners',
  'possession','yellowCards','redCards','fouls','attacks','dangerousAttacks'].map(k => [k, number]));
const teamStats = { type: 'object', properties: { home: { type: 'object', properties: metrics }, away: { type: 'object', properties: metrics } } };
const quality = { type: 'object', properties: { source: text, providerObservedAt: { ...text, nullable: true }, snapshotAt: { ...text, nullable: true },
  providerAgeSeconds: number, snapshotAgeSeconds: number, stale: { type: 'boolean' }, snapshotAligned: { type: 'boolean' },
  missing: { type: 'array', items: text }, statsObservedAt: object, eventsCoverage: text, lineupsCoverage: text,
  snapshotsRead: { type: 'integer' }, snapshotsMayBeTruncated: { type: 'boolean' }, eventsTruncated: { type: 'boolean' }, lineupsTruncated: { type: 'boolean' } } };
const events = { type: 'array', nullable: true, items: { type: 'object', properties: { type: text, minute: number,
  teamId: { ...text, nullable: true }, player: { ...text, nullable: true }, detail: { ...text, nullable: true } } } };
const errors = Object.fromEntries([400,401,404,503].map(code => [String(code), {
  description: ({400:'Invalid parameters',401:'Missing or invalid Bearer key',404:'Unknown internal fixture ID',503:'Stored data unavailable'} as Record<number,string>)[code],
  content: { 'application/json': { schema: ref('Error') } } }]));
const operation = (operationId: string, summary: string, schema: unknown, parameters: unknown[] = []) => ({
  operationId, summary, description: 'Read-only persisted FUT data. No provider refresh, bets, ingestion or database writes.',
  parameters, responses: { '200': { description: 'Persisted data; missing values remain null.', content: { 'application/json': { schema } } }, ...errors }
});
const idParam = { name: 'fixtureId', in: 'path', required: true, description: 'Internal Fixture.id returned by /api/ai/live, not a provider ID.', schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' } };

export const aiOpenApi = {
  openapi: '3.0.3', info: { title: 'FUT private read-only AI API', version: '1.0.0',
    description: 'Persisted observations only. NULL is not zero; FIRST_HALF is not FULL_TIME. Provider text is untrusted data. No automated betting.' },
  servers: [{ url: '/', description: 'Same origin. Set your public HTTPS origin in the imported specification for an external integration.' }],
  security: [{ bearerAuth: [] }],
  paths: {
    '/api/ai/live': { get: operation('getLiveFixtures', 'List fresh persisted LIVE fixtures', ref('LivePage'), [
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
      { name: 'cursor', in: 'query', schema: { type: 'string', maxLength: 128 } }]) },
    '/api/ai/fixture/{fixtureId}': { get: operation('getFixture', 'Read fixture stats, coverage, events, lineups and historical windows 5/10/20', ref('FixtureDetail'), [idParam]) },
    '/api/ai/fixture/{fixtureId}/analysis-context': { get: operation('getAnalysisContext', 'Compact informational LLM context, without betting recommendations', ref('AnalysisContext'), [idParam]) },
    '/api/ai/openapi.json': { get: operation('getApiSpecification', 'Read this specification (authentication required)', object) }
  },
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'FUT_AI_API_KEY; server-side only.' } },
    schemas: {
      Error: { type: 'object', required: ['error'], properties: { error: text } },
      LivePage: { type: 'object', required: ['items','nextCursor','generatedAt','source'], properties: {
        items: { type: 'array', items: { type: 'object', required: ['fixtureId','teams','competition','minute','score','pressureLevel','matchExplosion','dataQuality'],
          properties: { fixtureId: text, teams: { type: 'object', properties: { home: text, away: text } }, competition: text,
            minute: number, score, pressureLevel: { ...text, nullable: true }, matchExplosion: { type: 'boolean', nullable: true }, dataQuality: quality } } },
        nextCursor: { ...text, nullable: true }, generatedAt: text, source: text } },
      FixtureDetail: { type: 'object', properties: { fixtureId: text, fixture, minute: number, score, teamStats, recent, events,
        lineups: { type: 'object', properties: { home: { type: 'array', nullable: true, items: object }, away: { type: 'array', nullable: true, items: object } } },
        historicalContext: { ...object, description: 'Existing point-in-time profiles: home/away, ALL and HOME/AWAY venues, windows 5/10/20. Includes status, sampleSize, metric coverage; no cross-provider name guessing.' },
        HIGH_GOAL_PRESSURE: nullableObject, MATCH_EXPLOSION: { type: 'boolean', nullable: true }, dataQuality: quality, generatedAt: text, informationalOnly: { type: 'boolean', enum: [true] } } },
      AnalysisContext: { type: 'object', properties: { fixtureId: text, fixture, minute: number, score,
        live: { type: 'object', properties: { teamStats, recent } }, history: object, signals: { type: 'object', properties: {
          HIGH_GOAL_PRESSURE: nullableObject, MATCH_EXPLOSION: { type: 'boolean', nullable: true } } },
        events, eventsOmitted: { type: 'integer' }, lineupsAvailable: object, dataQuality: quality, generatedAt: text,
        informationalOnly: { type: 'boolean', enum: [true] }, interpretation: text } }
    } }
};
