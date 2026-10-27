const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
require.extensions['.tsx'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  });
  module._compile(result.outputText, filename);
};
const { selectReviewNow, reviewActivityLabel } = require('../src/lib/radarReviewNow.ts');
const { ReviewNowSection } = require('../src/components/LiveGoalRadarMonitor.tsx');

function candidate(id, sot = 4, recent = 3, minute = 25, market = 'OVER05_FT') {
  return { fixtureId: id, match: `Home ${id} vs Away ${id}`, competition: 'League', minute, score: { home: 0, away: 0 }, market,
    accumulated: { shotsOnTarget: sot, xg: null }, components: { recentLiveScore: recent, accumulatedLiveScore: 6 },
    totalScore: 5.5, dataQuality: 42, decision: 'NO_ALERT', decisionReason: 'Sin producción reciente', blockers: ['Cobertura insuficiente'],
    entryDecision: 'NO_ENTRY', betScore: 5.5 };
}
const match = c => ({ fixtureId: c.fixtureId, status: 'LIVE', candidates: [c] });
const select = (...c) => selectReviewNow(c.map(match));
const render = matches => renderToStaticMarkup(React.createElement(ReviewNowSection, { matches }));
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('3 SOT is excluded', () => assert.equal(select(candidate('a', 3)).length, 0));
test('4 SOT is included without any minute, xG or quality gate', () => {
  const c = candidate('a', 4, 0, 1); c.dataQuality = 0;
  assert.equal(select(c)[0].combinedSot, 4);
});
test('N/D, null, undefined and invalid SOT are excluded without coercion', () => {
  for (const value of [null, undefined, 'N/D', '4', NaN, Infinity]) {
    const c = candidate('a'); c.accumulated.shotsOnTarget = value;
    assert.equal(select(c).length, 0); assert.ok(Object.is(c.accumulated.shotsOnTarget, value));
  }
});
test('only confirmed LIVE 0-0 candidates are shown', () => {
  for (const status of ['FT', 'HT', undefined]) assert.equal(selectReviewNow([{ ...match(candidate('a')), status }]).length, 0);
  for (const score of [{ home: 1, away: 0 }, { home: null, away: 0 }, { home: 0, away: undefined }]) {
    assert.equal(select({ ...candidate('a'), score }).length, 0);
  }
});
test('1H and FT deduplicate by fixture ID and preserve both original markets', () => {
  const one = candidate('a', 4, 3, 25, 'OVER05_1H'), full = candidate('a');
  const result = selectReviewNow([{ ...match(one), candidates: [one, full, one] }]);
  assert.equal(result.length, 1); assert.deepEqual(result[0].markets, [one, full]);
});
test('different fixtures do not merge even with identical team labels', () => {
  const a = candidate('a'), b = { ...candidate('b'), match: a.match };
  assert.equal(select(a, b).length, 2);
});
test('sorts first by combined SOT descending', () => {
  assert.deepEqual(select(candidate('a', 4, 10), candidate('b', 8, 0), candidate('c', 6)).map(x => x.fixtureId), ['b', 'c', 'a']);
});
test('SOT tie uses Recent Live descending', () => {
  assert.deepEqual(select(candidate('a', 4, 2, 80), candidate('b', 4, 8, 10)).map(x => x.fixtureId), ['b', 'a']);
});
test('Recent Live tie uses minute descending and missing minute last', () => {
  assert.deepEqual(select(candidate('a', 4, 2, null), candidate('b', 4, 2, 20), candidate('c', 4, 2, 70)).map(x => x.fixtureId), ['c', 'b', 'a']);
});
test('visual labels have the requested 4, 6 and 8 boundaries', () => {
  assert.deepEqual([4, 5, 6, 7, 8, 12].map(reviewActivityLabel), ['REVISAR', 'REVISAR', 'PRIORIDAD', 'PRIORIDAD', 'ALTA ACTIVIDAD', 'ALTA ACTIVIDAD']);
});
test('selection and rendering preserve BET_SCORE, ENTRY/NO_ENTRY and original decisions', () => {
  for (const decision of ['NO_ALERT', 'WATCH', 'STRONG_ALERT', 'PRIORITY_ALERT']) {
    const c = { ...candidate('a', 8), decision }, input = freeze([match(c)]), before = JSON.stringify(input);
    assert.equal(selectReviewNow(input)[0].markets[0], c); render(input);
    assert.equal(JSON.stringify(input), before);
  }
});
test('renders one card with both markets, their actual decisions, scores and main blockers', () => {
  const one = candidate('a', 4, 3, 25, 'OVER05_1H');
  const full = { ...candidate('a'), decision: 'STRONG_ALERT', decisionReason: 'Actividad confirmada' };
  const html = render([{ ...match(one), candidates: [one, full] }]);
  assert.equal((html.match(/<article/g) || []).length, 1);
  for (const text of ['REVISAR AHORA (1)', 'OVER05_1H', 'OVER05_FT', 'NO ALERT', 'STRONG ALERT', 'Cobertura insuficiente',
    'Actividad confirmada', 'Recent Live score', 'Acumulado score', 'Data Quality', 'SOT acum. combinado', 'League', 'Home a vs Away a']) assert.ok(html.includes(text), text);
});
test('renders a counted empty state for missing SOT', () => {
  const html = render([match(candidate('a', null))]); assert.ok(html.includes('REVISAR AHORA (0)')); assert.ok(!html.includes('<article'));
});
test('presentation executes no HTTP, imports no provider/budget/processor and creates no hybrid candidates', () => {
  const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = () => { requests++; throw Error('Unexpected network'); };
  try {
    const c = candidate('a', 8), input = freeze([match(c)]);
    render(input); selectReviewNow(input); assert.equal(requests, 0);
    assert.equal(input[0].candidates.length, 1);
    const loaded = Object.keys(require.cache).map(p => p.replaceAll('\\', '/'));
    assert.equal(loaded.some(p => /\/src\/(providers\/|services\/training\/|lib\/prisma\.)/.test(p)), false);
  } finally { globalThis.fetch = original; }
});
