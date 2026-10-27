const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
require.extensions['.tsx']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);
const {HistoricalContextPanel}=require('../../src/components/HistoricalContextPanel.tsx');
const {unavailableHistoricalContext}=require('../../src/services/historical/liveContext.ts');
const {calculateTeamHistoricalProfile}=require('../../src/services/historical/teamProfile.ts');
test('UI shows N/D for unavailable mapping without implying neutral evidence',()=>{
 const html=renderToStaticMarkup(React.createElement(HistoricalContextPanel,{name:'A vs B',context:unavailableHistoricalContext('NO_MAPPING'),liveSot:null}));
 assert.match(html,/HISTORICAL_CONTEXT = N\/D/);assert.doesNotMatch(html,/HISTÓRICO NEUTRO/);assert.match(html,/No altera LIVE/);
});
test('UI exposes windows, separate venue profiles, missing stats and sample coverage',()=>{
 const p=calculateTeamHistoricalProfile('a',new Date('2025-01-01'),{window:10},[]);
 const ctx={status:'AVAILABLE',before:p.before,home:[p,{...p,venue:'HOME'}],away:[p,{...p,venue:'AWAY'}],comparison:{OVER05_1H:null,OVER05_FT:null}};
 const html=renderToStaticMarkup(React.createElement(HistoricalContextPanel,{name:'A vs B',context:ctx,liveSot:null}));
 for(const text of ['Últimos 5','Últimos 10','Últimos 20','Local HOME','Visitante AWAY','Cobertura','SOT acumulado N/D'])assert.ok(html.includes(text));
 assert.doesNotMatch(html,/SOT acumulado 0/);
});
test('route adds a sibling field only after existing evaluator; decisions are not enriched',()=>{
 const source=fs.readFileSync('src/app/api/debug/live-goal-radar/route.ts','utf8');
 assert.ok(source.indexOf('evaluateLiveGoalRadar(context)')<source.indexOf('historicalContext: await getLiveHistoricalContext(context.match)'));
 assert.match(source,/historicalContext: await getLiveHistoricalContext\(context.match\),\s*candidates/);
});
