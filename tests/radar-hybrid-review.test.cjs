const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
}).outputText, filename);
const { classifyHybridEligibility: classify, listRadarCompetitions, filterRadarMatches, radarCompetition, hybridReviewLabels } = require('../src/lib/radarHybridReview.ts');
const { selectReviewNow } = require('../src/lib/radarReviewNow.ts');
const { notifyHybridEligible: notify, requestReviewNotificationPermission: requestPermission, browserReviewNotificationPort, reviewFixtureAnchor } = require('../src/lib/radarReviewNotifications.ts');
const { ReviewNowSection, LiveGoalRadarMonitor, RadarCompetitionFilters } = require('../src/components/LiveGoalRadarMonitor.tsx');

function candidate(patch = {}) {
  return { fixtureId: 'a', match: 'Home vs Away', competition: 'Serie A', market: 'OVER05_1H', minute: 25,
    score: { home: 0, away: 0 }, accumulated: { shotsOnTarget: 4, xg: null, bigChances: null, shotsInsideBox: null },
    components: { recentLiveScore: 0, accumulatedLiveScore: 6, historicalScore: 2, contextPlayersScore: 0, h2hScore: 0 },
    recentDataStatus: 'INSUFFICIENT_RECENT_DATA', totalScore: 4.5, betScore: 4.5, entryDecision: 'NO_ENTRY', dataQuality: 35,
    decision: 'NO_ALERT', decisionReason: 'Cobertura insuficiente', blockers: ['Cobertura insuficiente'], reasons: [], dataWarnings: [], ndFields: [],
    windows: Object.fromEntries(['five','ten','fifteen'].map(k => [k, { dataState: 'INSUFFICIENT_DATA', coveragePercentage: 0 }])),
    historical: { summary: [], samples: {}, currentPeriod: '1H' }, ...patch };
}
function complete(patch = {}) { return candidate({ accumulated: { shotsOnTarget: 4, xg: 0, bigChances: 0, shotsInsideBox: 0 }, recentDataStatus: 'VALID_RECENT_DATA', ...patch }); }
const match = (c = candidate(), patch = {}) => ({ fixtureId: c.fixtureId, competition: c.competition, status: 'LIVE', candidates: [c], ...patch });
const state = c => classify(c).state;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
function port(permission = 'granted') { const messages = []; return { permission, messages, show(message) { messages.push(message); } }; }

test('1H minute 19 SOT 6 is OUTSIDE_TIME_WINDOW', () => assert.equal(state(candidate({ minute: 19, accumulated: { shotsOnTarget: 6 } })), 'OUTSIDE_TIME_WINDOW'));
test('1H minute 25 SOT 4 with missing critical data is HYBRID_ELIGIBLE', () => assert.equal(state(candidate()), 'HYBRID_ELIGIBLE'));
test('1H complete critical data is HYBRID_NOT_NEEDED, including observed zero', () => assert.equal(state(complete()), 'HYBRID_NOT_NEEDED'));
test('FT minute 50 SOT 4 with missing critical data is HYBRID_ELIGIBLE', () => assert.equal(state(candidate({ market: 'OVER05_FT', minute: 50 })), 'HYBRID_ELIGIBLE'));
test('FT minute 76 is OUTSIDE_TIME_WINDOW', () => assert.equal(state(candidate({ market: 'OVER05_FT', minute: 76 })), 'OUTSIDE_TIME_WINDOW'));
test('SOT 3 is INSUFFICIENT_SOT', () => assert.equal(state(candidate({ accumulated: { shotsOnTarget: 3 } })), 'INSUFFICIENT_SOT'));
test('SOT null, undefined, N/D and non-finite values stay missing and insufficient', () => {
  for (const shotsOnTarget of [null, undefined, 'N/D', '4', NaN, Infinity]) {
    const c = candidate({ accumulated: { shotsOnTarget } });
    assert.equal(state(c), 'INSUFFICIENT_SOT'); assert.ok(Object.is(c.accumulated.shotsOnTarget, shotsOnTarget));
  }
});
test('both inclusive time boundaries and adjacent exclusions are respected', () => {
  for (const [market, low, high] of [['OVER05_1H', 20, 40], ['OVER05_FT', 45, 75]]) {
    for (const minute of [low, high]) assert.equal(state(candidate({ market, minute })), 'HYBRID_ELIGIBLE');
    for (const minute of [low - 1, high + 1, null, NaN]) assert.equal(state(candidate({ market, minute })), 'OUTSIDE_TIME_WINDOW');
  }
});
test('each missing critical statistic individually makes enrichment eligible', () => {
  for (const field of ['xg', 'bigChances', 'shotsInsideBox']) {
    for (const value of [null, undefined, 'N/D']) {
      const c = complete(); c.accumulated[field] = value; assert.equal(state(c), 'HYBRID_ELIGIBLE');
    }
  }
});
test('recent coverage uses existing recentDataStatus and distinguishes observed inactivity from missing', () => {
  assert.equal(state(complete({ recentDataStatus: 'RECENT_DEAD' })), 'HYBRID_NOT_NEEDED');
  for (const recentDataStatus of [undefined, null, 'INSUFFICIENT_RECENT_DATA']) assert.equal(state(complete({ recentDataStatus })), 'HYBRID_ELIGIBLE');
  assert.equal(state(complete({ components: { recentLiveScore: null } })), 'HYBRID_ELIGIBLE');
});
test('non-live, unknown or non-zero score, and unsupported market remain REVIEW_ONLY', () => {
  assert.equal(classify(candidate(), false).state, 'REVIEW_ONLY');
  for (const score of [{ home: null, away: 0 }, { home: 1, away: 0 }]) assert.equal(state(candidate({ score })), 'REVIEW_ONLY');
  assert.equal(state(candidate({ market: 'OTHER' })), 'REVIEW_ONLY');
});
test('all competitions retains the source fixtures and filtering selects the exact competition', () => {
  const a = match(), b = match(candidate({ fixtureId: 'b', competition: 'Liga B' }));
  assert.deepEqual(filterRadarMatches([a, b]), [a, b]); assert.deepEqual(filterRadarMatches([a, b], 'Liga B'), [b]);
});
test('competition options are unique, alphabetical and only from current LIVE fixtures', () => {
  const items = [match(), match(), match(candidate({ competition: 'Argentina' })), match(candidate({ competition: 'Zambia' })), match(candidate({ competition: 'Finished league' }), { status: 'FINISHED' })];
  assert.deepEqual(listRadarCompetitions(items), ['Argentina', 'Serie A', 'Zambia']);
  assert.equal(radarCompetition({ competition: '', candidates: [{ competition: 'Fallback' }] }), 'Fallback');
  assert.equal(radarCompetition({ candidates: [] }), 'N/D');
});
test('eligible-only filters markets and competitions together without mutating input', () => {
  const c = candidate(), ft = candidate({ market: 'OVER05_FT' });
  const input = freeze([match(c, { candidates: [c, ft] }), match(candidate({ fixtureId: 'b', competition: 'Liga B', minute: 19 }))]);
  const before = JSON.stringify(input), filtered = filterRadarMatches(input, 'Serie A', true);
  assert.equal(filtered.length, 1); assert.deepEqual(filtered[0].candidates.map(c => c.market), ['OVER05_1H']);
  assert.equal(JSON.stringify(input), before); assert.equal(selectReviewNow(filtered).length, 1);
});
test('competition controls retain a disappeared selection and emit only local state changes', () => {
  let selection = '', only = false;
  const props = { competitions: ['Serie A'], competition: 'Liga B', eligibleOnly: true, onCompetitionChange: v => selection = v, onEligibleOnlyChange: v => only = v };
  const html = render(RadarCompetitionFilters, props);
  assert.ok(html.includes('Liga B (sin partidos LIVE)')); assert.ok(html.includes('Todas las competiciones'));
  const tree = RadarCompetitionFilters(props), controls = [];
  function visit(node) { if (!node || typeof node !== 'object') return; if (node.type === 'select' || node.type === 'input') controls.push(node); React.Children.forEach(node.props?.children, visit); }
  visit(tree); controls.find(n => n.type === 'select').props.onChange({ target: { value: 'Serie A' } });
  controls.find(n => n.type === 'input').props.onChange({ target: { checked: true } });
  assert.equal(selection, 'Serie A'); assert.equal(only, true);
});
test('mounted monitor projection synchronizes REVISAR AHORA and the complete lower radar', () => {
  const source = [match(candidate({ fixtureId: 'a', match: 'Alpha vs Beta' })), match(candidate({ fixtureId: 'b', match: 'Gamma vs Delta', competition: 'Liga B' }))];
  const payload = { matches: source, scannedLiveMatches: 2, candidatesCount: 2, summary: {} };
  const useState = React.useState; let index = 0;
  // SSR harness sets only initial component state; effects (HTTP/interval/notifications) do not run.
  React.useState = initial => { index++; return useState(index === 1 ? payload : index === 9 ? 'Liga B' : initial); };
  try {
    const html = render(LiveGoalRadarMonitor, {});
    assert.ok(html.includes('REVISAR AHORA (1)')); assert.ok(!html.includes('Alpha vs Beta'));
    assert.equal((html.match(/Gamma vs Delta/g) || []).length, 2);
  } finally { React.useState = useState; }
});
test('denied permission produces no notification and does not consume the dedup key', () => {
  const p = port('denied'), sent = new Set(); assert.equal(notify([match()], sent, p), 0); assert.equal(sent.size, 0); assert.equal(p.messages.length, 0);
});
test('default permission never notifies or requests permission automatically', () => {
  const p = port('default'); assert.equal(notify([match()], new Set(), p), 0); assert.equal(p.messages.length, 0);
});
test('a new eligible fixture notifies once across repeated payloads', () => {
  const p = port(), sent = new Set(); assert.equal(notify([match()], sent, p), 1);
  assert.equal(notify(structuredClone([match()]), sent, p), 0); assert.equal(p.messages.length, 1);
});
test('ineligible fixture never generates a review notification', () => {
  const p = port(); assert.equal(notify([match(candidate({ minute: 19 })), match(complete())], new Set(), p), 0);
});
test('dedup policy survives eligibility exit and re-entry during the same mount', () => {
  const p = port(), sent = new Set(); notify([match()], sent, p); notify([], sent, p); notify([match(candidate({ minute: 19 }))], sent, p);
  notify([match()], sent, p); assert.equal(p.messages.length, 1);
});
test('same fixture later eligible for FT gets its own single notification', () => {
  const p = port(), sent = new Set(); notify([match()], sent, p);
  const ft = match(candidate({ market: 'OVER05_FT', minute: 50 })); notify([ft], sent, p); notify([ft], sent, p);
  assert.equal(p.messages.length, 2); assert.notEqual(p.messages[0].tag, p.messages[1].tag);
});
test('granting permission notifies current eligible fixtures; notification content is review-only', () => {
  const sent = new Set(); notify([match()], sent, port('default')); const p = port(); notify([match()], sent, p);
  assert.equal(p.messages[0].title, 'FUT Analytics — Revisar partido');
  assert.equal(p.messages[0].body, "Serie A · Home vs Away · 25' · SOT 4 · OVER05_1H");
  assert.ok(!/APOSTAR|ENTRAR|SEGURO|FIJA/.test(p.messages[0].title + p.messages[0].body));
});
test('notification construction errors cannot interrupt radar and do not mark delivery', () => {
  const sent = new Set(); assert.equal(notify([match()], sent, { permission: 'granted', show() { throw Error('OS unavailable'); } }), 0);
  assert.equal(sent.size, 0);
});
test('explicit permission helper asks only for default, never denied/granted/unsupported', async () => {
  const original = globalThis.Notification; let requests = 0;
  try {
    for (const permission of ['denied', 'granted']) {
      globalThis.Notification = { permission, requestPermission() { requests++; throw Error('Do not prompt'); } };
      assert.equal(await requestPermission(), permission);
    }
    globalThis.Notification = { permission: 'default', async requestPermission() { requests++; return 'granted'; } };
    assert.equal(await requestPermission(), 'granted'); assert.equal(requests, 1);
    delete globalThis.Notification; assert.equal(await requestPermission(), 'unsupported');
  } finally { if (original === undefined) delete globalThis.Notification; else globalThis.Notification = original; }
});
test('native notification click focuses this radar and scrolls without navigation or HTTP', () => {
  const originals = [globalThis.Notification, globalThis.window, globalThis.document]; let instance, focused = 0, scrolled = 0, closed = 0, lookup;
  try {
    globalThis.Notification = class { static permission = 'granted'; constructor(title, options) { instance = this; this.title = title; this.options = options; } close() { closed++; } };
    globalThis.window = { focus() { focused++; } };
    globalThis.document = { getElementById(id) { lookup = id; return { scrollIntoView() { scrolled++; }, focus() { focused++; } }; } };
    notify([match()], new Set(), browserReviewNotificationPort()); instance.onclick();
    assert.equal(lookup, reviewFixtureAnchor('a')); assert.equal(focused, 2); assert.equal(scrolled, 1); assert.equal(closed, 1);
  } finally { for (const [i,k] of ['Notification','window','document'].entries()) { if (originals[i] === undefined) delete globalThis[k]; else globalThis[k] = originals[i]; } }
});
test('hybrid badges show the state without changing ALERT, ENTRY, BET_SCORE or source nulls', () => {
  for (const decision of ['NO_ALERT', 'WATCH', 'STRONG_ALERT', 'PRIORITY_ALERT']) {
    const c = candidate({ decision }), input = freeze([match(c)]), before = JSON.stringify(input);
    const html = render(ReviewNowSection, { matches: input }); assert.ok(html.includes(hybridReviewLabels.HYBRID_ELIGIBLE));
    assert.equal(JSON.stringify(input), before); assert.ok(html.includes(decision.replaceAll('_', ' ')));
  }
});
test('classification, filtering, notification delivery and render add no HTTP, timers, budget or queue dependencies', () => {
  const oldFetch = globalThis.fetch, oldInterval = globalThis.setInterval; let requests = 0, timers = 0;
  globalThis.fetch = () => { requests++; throw Error('Unexpected HTTP'); }; globalThis.setInterval = () => { timers++; throw Error('Unexpected polling'); };
  try {
    const input = freeze([match()]); classify(input[0].candidates[0]); filterRadarMatches(input, '', true); listRadarCompetitions(input);
    notify(input, new Set(), port()); render(ReviewNowSection, { matches: input });
    assert.equal(requests, 0); assert.equal(timers, 0);
    const loaded = Object.keys(require.cache).map(p => p.replaceAll('\\', '/'));
    assert.equal(loaded.some(p => /\/src\/(providers\/|services\/training\/|lib\/prisma\.)/.test(p)), false);
  } finally { globalThis.fetch = oldFetch; globalThis.setInterval = oldInterval; }
});
