import type { HistoricalOutcomeStatus } from '@prisma/client';
import type { MarketSpec, PeriodStats } from './types';
export const DEFAULT_MARKETS: MarketSpec[] = [
  ...[0.5,1.5].map(line=>({market:'TOTAL_GOALS' as const,period:'FIRST_HALF' as const,selection:'OVER' as const,line,side:'BOTH' as const,rules:'REGULATION'})),
  ...[0.5,1.5,2.5].map(line=>({market:'TOTAL_GOALS' as const,period:'FULL_TIME' as const,selection:'OVER' as const,line,side:'BOTH' as const,rules:'REGULATION'})),
  {market:'BTTS',period:'FULL_TIME',selection:'YES',line:null,side:'BOTH',rules:'REGULATION'},
  ...(['HOME','AWAY'] as const).map(side=>({market:'TEAM_GOALS' as const,period:'FULL_TIME' as const,selection:'OVER' as const,line:0.5,side,rules:'REGULATION'}))
];
export function marketKey(s: MarketSpec) { return JSON.stringify([s.market,s.period,s.selection,s.side,s.line,s.rules]); }
export function resolveHistoricalMarket(s: MarketSpec, periods: PeriodStats[]): { status: HistoricalOutcomeStatus; observedValue: number | null } {
  const unknown={status:'UNKNOWN' as const,observedValue:null};
  if(!['TOTAL_GOALS','BTTS','TEAM_GOALS','CORNERS','CARDS'].includes(s.market)||!['HOME','AWAY','BOTH'].includes(s.side)||!['OVER','UNDER','YES','NO'].includes(s.selection))return unknown;
  if (s.voided === true) return {status:'VOID',observedValue:null};
  const rows=periods.filter(p=>p.period===s.period);if(rows.length!==1)return unknown;
  const p=rows[0];
  const valid=(n: number | null): n is number => n !== null && Number.isFinite(n) && n>=0;
  if(s.market==='BTTS') {
    if(s.side!=='BOTH'||s.line!==null||!['YES','NO'].includes(s.selection)||s.rules!=='REGULATION'||!valid(p.home.goals)||!valid(p.away.goals))return unknown;
    const yes=p.home.goals>0&&p.away.goals>0;return{status:yes===(s.selection==='YES')?'WIN':'LOSS',observedValue:yes?1:0};
  }
  if(!['OVER','UNDER'].includes(s.selection)||s.line===null||!valid(s.line)||s.line*2%1!==0)return unknown; // Quarter lines need half-win/loss states, not fabricated WIN/PUSH.
  if(s.market==='TEAM_GOALS'&&s.side==='BOTH'||s.market!=='TEAM_GOALS'&&s.side!=='BOTH')return unknown;
  if(s.market!=='CARDS'&&s.rules!=='REGULATION')return unknown;
  const value=(side:'home'|'away')=>{
    const m=p[side];
    if(s.market==='CORNERS')return m.corners;
    if(s.market==='CARDS') {
      if(s.rules==='YELLOW_ONLY')return m.yellowCards;
      if(s.rules==='RED_ONLY')return m.redCards;
      if(s.rules==='YELLOW_PLUS_RED'&&valid(m.yellowCards)&&valid(m.redCards))return m.yellowCards+m.redCards;
      return null;
    }
    return m.goals;
  };
  const h=value('home'),a=value('away');
  const n=s.side==='HOME'?h:s.side==='AWAY'?a:valid(h)&&valid(a)?h+a:null;
  if(!valid(n))return unknown;
  return{status:n===s.line?'PUSH':(s.selection==='OVER'?n>s.line:n<s.line)?'WIN':'LOSS',observedValue:n};
}
